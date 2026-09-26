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
 * The same pass picks each copy's level: a copy with a far geometry
 * (`setFarAt`) whose sphere lies wholly past `lod.distance` from `lod.point`
 * draws that geometry instead, or nothing for HIDDEN_FAR. Every pass measures
 * from the one point, so a shadow and a probe face draw what the view does.
 */
export class SphereCulledBatch extends BatchedMesh {

	constructor( maxInstanceCount, maxVertexCount, maxIndexCount, material ) {

		super( maxInstanceCount, maxVertexCount, maxIndexCount, material );
		/** Per copy: centre x, y, z and radius, in the batch's own frame. */
		this.spheres = new Float32Array( maxInstanceCount * 4 );
		/** Per copy: the geometry it draws far away, NEAR_ONLY or HIDDEN_FAR. */
		this.far = new Int32Array( maxInstanceCount ).fill( NEAR_ONLY );
		/** `{ point: Vector3 | null, distance }`, or null for a batch with no far geometry. */
		this.lod = null;

	}

	addInstance( geometryId ) {

		const instanceId = super.addInstance( geometryId );
		this.far[ instanceId ] = NEAR_ONLY;
		this.#keep( instanceId );

		return instanceId;

	}

	/** The geometry this copy draws past the far distance, NEAR_ONLY or HIDDEN_FAR. */
	setFarAt( instanceId, far ) {

		this.validateInstanceId( instanceId );
		if ( far >= 0 ) this.validateGeometryId( far );
		this.far[ instanceId ] = far;

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
		this._instanceInfo.forEach( ( instance, instanceId ) => {

			if ( instance.active && instance.geometryIndex === geometryId ) this.#keep( instanceId );

		} );

		return geometryId;

	}

	setInstanceCount( maxInstanceCount ) {

		super.setInstanceCount( maxInstanceCount );
		const spheres = new Float32Array( maxInstanceCount * 4 );
		spheres.set( this.spheres.subarray( 0, Math.min( this.spheres.length, spheres.length ) ) );
		this.spheres = spheres;
		const far = new Int32Array( maxInstanceCount ).fill( NEAR_ONLY );
		far.set( this.far.subarray( 0, Math.min( this.far.length, far.length ) ) );
		this.far = far;

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
		const farIds = this.far;
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
			const far = farIds[ instanceId ];
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
