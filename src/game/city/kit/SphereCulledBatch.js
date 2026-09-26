import { BatchedMesh, Frustum, Matrix4, Sphere, Vector3 } from 'three/webgpu';

/** A copy that draws its own geometry at every distance. */
export const NEAR_ONLY = - 1;
/** A copy that draws nothing past the far distance. */
export const HIDDEN_FAR = - 2;

const _frustum = new Frustum();
const _matrix = new Matrix4();
const _sphere = new Sphere();
const _point = new Vector3();

/**
 * A BatchedMesh whose copies stand still, so each copy's bounding sphere is
 * worked out once, where it is placed, and kept.
 *
 * Three's own per-copy culling reads every copy's matrix back and transforms
 * its geometry's sphere again in every pass of every frame: the colour pass,
 * the shadow pass and each probe face. A city holds tens of thousands of copies
 * across its batches and none of them moves after it is admitted, so a pass
 * here is six plane tests per copy against the sphere kept for it. The draw
 * list it writes is exactly the one three writes for an opaque batch; a batch
 * that sorts, or a camera three culls differently, takes three's own path.
 *
 * The same pass picks each copy's level: a copy of a geometry that has a far
 * geometry (`setFarOf`) draws that one instead once its sphere lies wholly past
 * `lod.distance` from `lod.point`, or nothing for HIDDEN_FAR. The far geometry
 * belongs to the geometry, so copies placed before it arrived draw it too. Every
 * pass measures from the one point, so a shadow and a probe face draw what the
 * view does.
 */
export class SphereCulledBatch extends BatchedMesh {

	#adding = false;

	constructor( maxInstanceCount, maxVertexCount, maxIndexCount, material ) {

		super( maxInstanceCount, maxVertexCount, maxIndexCount, material );
		/** Per copy: centre x, y, z and radius, in the batch's own frame. */
		this.spheres = new Float32Array( maxInstanceCount * 4 );
		/** Per geometry: the geometry its copies draw far away, NEAR_ONLY or HIDDEN_FAR. */
		this.farOf = [];
		/** `{ point: Vector3 | null, distance }`, or null for a batch with no far geometry. */
		this.lod = null;

	}

	addGeometry( geometry, reservedVertexCount, reservedIndexCount ) {

		// A geometry being added has no copies yet, so its write keeps no sphere.
		this.#adding = true;
		try {

			const geometryId = super.addGeometry( geometry, reservedVertexCount, reservedIndexCount );
			this.farOf[ geometryId ] = NEAR_ONLY;

			return geometryId;

		} finally {

			this.#adding = false;

		}

	}

	addInstance( geometryId ) {

		const instanceId = super.addInstance( geometryId );
		this.#keep( instanceId );

		return instanceId;

	}

	/** The geometry every copy of this one draws past the far distance, NEAR_ONLY or HIDDEN_FAR. */
	setFarOf( geometryId, far ) {

		this.validateGeometryId( geometryId );
		if ( far >= 0 ) this.validateGeometryId( far );
		this.farOf[ geometryId ] = far;

		return this;

	}

	setMatrixAt( instanceId, matrix ) {

		super.setMatrixAt( instanceId, matrix );
		this.#keep( instanceId );

		return this;

	}

	setGeometryIdAt( instanceId, geometryId ) {

		super.setGeometryIdAt( instanceId, geometryId );
		this.#keep( instanceId );

		return this;

	}

	setGeometryAt( geometryId, geometry ) {

		super.setGeometryAt( geometryId, geometry );
		if ( ! this.#adding ) this._instanceInfo.forEach( ( instance, instanceId ) => {

			if ( instance.active && instance.geometryIndex === geometryId ) this.#keep( instanceId );

		} );

		return geometryId;

	}

	setInstanceCount( maxInstanceCount ) {

		super.setInstanceCount( maxInstanceCount );
		const spheres = new Float32Array( maxInstanceCount * 4 );
		spheres.set( this.spheres.subarray( 0, Math.min( this.spheres.length, spheres.length ) ) );
		this.spheres = spheres;

	}

	onBeforeRender( renderer, scene, camera, geometry, material, group ) {

		if ( ! this.perObjectFrustumCulled || this.sortObjects || camera.isArrayCamera || material.wireframe ) {

			super.onBeforeRender( renderer, scene, camera, geometry, material, group );
			return;

		}

		const index = geometry.getIndex();
		const bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
		_matrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ).multiply( this.matrixWorld );
		_frustum.setFromProjectionMatrix( _matrix, camera.coordinateSystem, camera.reversedDepth );

		const planes = _frustum.planes;
		const spheres = this.spheres;
		const farOf = this.farOf;
		const point = this.lod?.point ? _point.copy( this.lod.point ).applyMatrix4( _matrix.copy( this.matrixWorld ).invert() ) : null;
		const distance = this.lod?.distance ?? 0;
		const instances = this._instanceInfo;
		const geometries = this._geometryInfo;
		const starts = this._multiDrawStarts;
		const counts = this._multiDrawCounts;
		const indirect = this._indirectTexture.image.data;
		let drawn = 0;

		for ( let instanceId = 0, l = instances.length; instanceId < l; instanceId ++ ) {

			const instance = instances[ instanceId ];
			if ( ! instance.visible || ! instance.active || ! inside( planes, spheres, instanceId * 4 ) ) continue;

			let geometryIndex = instance.geometryIndex;
			const far = farOf[ geometryIndex ];
			if ( far !== NEAR_ONLY && point !== null && beyond( spheres, instanceId * 4, point, distance ) ) {

				if ( far === HIDDEN_FAR ) continue;
				geometryIndex = far;

			}

			const range = geometries[ geometryIndex ];
			starts[ drawn ] = range.start * bytesPerElement;
			counts[ drawn ] = range.count;
			indirect[ drawn ] = instanceId;
			drawn ++;

		}

		this._indirectTexture.needsUpdate = true;
		this._multiDrawCount = drawn;
		this._visibilityChanged = false;

	}

	/** The sphere of one copy, from its geometry and the matrix it stands at. */
	#keep( instanceId ) {

		const instance = this._instanceInfo[ instanceId ];
		this.getBoundingSphereAt( instance.geometryIndex, _sphere ).applyMatrix4( this.getMatrixAt( instanceId, _matrix ) );
		_sphere.center.toArray( this.spheres, instanceId * 4 );
		this.spheres[ instanceId * 4 + 3 ] = _sphere.radius;

	}

}

/** Whether a kept sphere lies wholly farther than `distance` from the point. */
function beyond( spheres, at, point, distance ) {

	const x = spheres[ at ] - point.x, y = spheres[ at + 1 ] - point.y, z = spheres[ at + 2 ] - point.z;
	const reach = distance + spheres[ at + 3 ];

	return x * x + y * y + z * z > reach * reach;

}

/** Whether a kept sphere reaches inside all six planes, as Frustum.intersectsSphere answers it. */
function inside( planes, spheres, at ) {

	const x = spheres[ at ], y = spheres[ at + 1 ], z = spheres[ at + 2 ], reach = - spheres[ at + 3 ];

	for ( let p = 0; p < 6; p ++ ) {

		const { normal, constant } = planes[ p ];
		if ( normal.x * x + normal.y * y + normal.z * z + constant < reach ) return false;

	}

	return true;

}
