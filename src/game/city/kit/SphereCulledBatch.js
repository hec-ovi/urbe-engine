import { BatchedMesh, Box3, Frustum, Matrix4, Sphere, Vector3 } from 'three/webgpu';

/** A copy that draws its own geometry at every distance. */
export const NEAR_ONLY = - 1;
/** A copy that draws nothing past the far distance. */
export const HIDDEN_FAR = - 2;

const _frustum = new Frustum();
const _matrix = new Matrix4();
const _inverse = new Matrix4();
const _sphere = new Sphere();
const _point = new Vector3();
const _vertex = new Vector3();
/**
 * How far, in metres, a pass's camera may stand from the last one's and still
 * keep its list: a player standing still is never quite still, the body
 * settling a tenth of a millimetre each frame.
 */
const SAME_VIEW = 5e-4;

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
 * A geometry's own sphere is worked out once, the first time a copy of it is
 * placed, over its run of the batch's vertices. Three reads the same points
 * through the index, twice over for the shared ones; every geometry a city
 * batch holds draws every vertex it carries ([BatchGeometry.js](BatchGeometry.js)),
 * so the run is exactly the points the index reaches.
 *
 * The same pass picks each copy's level: a copy of a geometry that has a far
 * geometry (`setFarOf`) draws that one instead once its sphere lies wholly past
 * `lod.distance` from `lod.point`, or nothing for HIDDEN_FAR. The far geometry
 * belongs to the geometry, so copies placed before it arrived draw it too. Every
 * pass measures from the one point, so a shadow and a probe face draw what the
 * view does.
 *
 * A pass seen from where the last one was, with nothing edited since, keeps
 * the last list as it stands: a player standing still re-culls nothing, the
 * settling of their body included (SAME_VIEW). And
 * the list reaches the GPU only when it differs from the one already there,
 * because the indirect texture is uploaded whole every time it is flagged.
 */
export class SphereCulledBatch extends BatchedMesh {

	#adding = false;
	/** Whether a copy, a geometry or the far table changed since the last pass culled. */
	#edited = true;
	/** What the last pass culled for: its camera, clip matrix, far point and distance. */
	#camera = null;
	#view = new Float64Array( 45 );
	#lodAt = new Vector3();
	#lod = false;
	/** The indirect texture the current draw list was last uploaded into. */
	#uploaded = null;

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
			this.#edited = true;

			return geometryId;

		} finally {

			this.#adding = false;

		}

	}

	addInstance( geometryId ) {

		const instanceId = super.addInstance( geometryId );
		this.#keep( instanceId );
		this.#edited = true;

		return instanceId;

	}

	getBoundingSphereAt( geometryId, target ) {

		const info = this._geometryInfo[ geometryId ];
		if ( info && info.boundingSphere === null ) {

			const position = this.geometry.getAttribute( 'position' );
			const end = info.vertexStart + info.vertexCount;
			if ( info.boundingBox === null ) {

				info.boundingBox = new Box3();
				for ( let vertex = info.vertexStart; vertex < end; vertex ++ ) info.boundingBox.expandByPoint( _vertex.fromBufferAttribute( position, vertex ) );

			}
			const sphere = info.boundingSphere = new Sphere();
			info.boundingBox.getCenter( sphere.center );
			let reach = 0;
			for ( let vertex = info.vertexStart; vertex < end; vertex ++ ) reach = Math.max( reach, sphere.center.distanceToSquared( _vertex.fromBufferAttribute( position, vertex ) ) );
			sphere.radius = Math.sqrt( reach );

		}

		return super.getBoundingSphereAt( geometryId, target );

	}

	/** The geometry every copy of this one draws past the far distance, NEAR_ONLY or HIDDEN_FAR. */
	setFarOf( geometryId, far ) {

		this.validateGeometryId( geometryId );
		if ( far >= 0 ) this.validateGeometryId( far );
		this.farOf[ geometryId ] = far;
		this.#edited = true;

		return this;

	}

	setMatrixAt( instanceId, matrix ) {

		super.setMatrixAt( instanceId, matrix );
		this.#keep( instanceId );
		this.#edited = true;

		return this;

	}

	setGeometryIdAt( instanceId, geometryId ) {

		super.setGeometryIdAt( instanceId, geometryId );
		this.#keep( instanceId );
		this.#edited = true;

		return this;

	}

	setGeometryAt( geometryId, geometry ) {

		super.setGeometryAt( geometryId, geometry );
		if ( ! this.#adding ) this._instanceInfo.forEach( ( instance, instanceId ) => {

			if ( instance.active && instance.geometryIndex === geometryId ) this.#keep( instanceId );

		} );
		this.#edited = true;

		return geometryId;

	}

	/**
	 * Whether a pass can cull this batch ahead of drawing it (EmptyDraws.js):
	 * calling onBeforeRender twice for one pass culls once.
	 */
	get cullsBeforeDraw() {

		return this.perObjectFrustumCulled && ! this.sortObjects;

	}

	setInstanceCount( maxInstanceCount ) {

		super.setInstanceCount( maxInstanceCount );
		const spheres = new Float32Array( maxInstanceCount * 4 );
		spheres.set( this.spheres.subarray( 0, Math.min( this.spheres.length, spheres.length ) ) );
		this.spheres = spheres;
		this.#edited = true;

	}

	setGeometrySize( maxVertexCount, maxIndexCount ) {

		super.setGeometrySize( maxVertexCount, maxIndexCount );
		this.#edited = true;

	}

	deleteInstance( instanceId ) {

		super.deleteInstance( instanceId );
		this.#edited = true;

		return this;

	}

	setVisibleAt( instanceId, visible ) {

		super.setVisibleAt( instanceId, visible );
		this.#edited = true;

		return this;

	}

	onBeforeRender( renderer, scene, camera, geometry, material, group ) {

		if ( ! this.perObjectFrustumCulled || this.sortObjects || camera.isArrayCamera || material.wireframe ) {

			// Three writes the lists itself, so the next pass of ours starts over.
			this.#camera = null;
			super.onBeforeRender( renderer, scene, camera, geometry, material, group );
			return;

		}

		_matrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ).multiply( this.matrixWorld );
		const point = this.lod?.point ? _point.copy( this.lod.point ).applyMatrix4( _inverse.copy( this.matrixWorld ).invert() ) : null;
		const distance = this.lod?.distance ?? 0;

		if ( ! this.#edited && ! this._visibilityChanged && camera === this.#camera && this.#same( camera, point, distance ) ) return;

		this.#camera = camera;
		this.#keepView( camera, point, distance );
		this.#edited = false;

		const index = geometry.getIndex();
		const bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
		_frustum.setFromProjectionMatrix( _matrix, camera.coordinateSystem, camera.reversedDepth );

		const planes = _frustum.planes;
		const spheres = this.spheres;
		const farOf = this.farOf;
		const instances = this._instanceInfo;
		const geometries = this._geometryInfo;
		const starts = this._multiDrawStarts;
		const counts = this._multiDrawCounts;
		const indirect = this._indirectTexture.image.data;
		let drawn = 0;
		let changed = this._indirectTexture !== this.#uploaded;

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
			const start = range.start * bytesPerElement;
			if ( indirect[ drawn ] !== instanceId || starts[ drawn ] !== start || counts[ drawn ] !== range.count ) {

				starts[ drawn ] = start;
				counts[ drawn ] = range.count;
				indirect[ drawn ] = instanceId;
				changed = true;

			}
			drawn ++;

		}

		if ( changed || drawn !== this._multiDrawCount ) {

			this._indirectTexture.needsUpdate = true;
			this.#uploaded = this._indirectTexture;

		}
		this._multiDrawCount = drawn;
		this._visibilityChanged = false;

	}

	/**
	 * What a pass culls for: the camera's projection and turn exactly, its
	 * position, the batch's own placement, the far point and distance.
	 */
	#keepView( camera, point, distance ) {

		const view = this.#view;
		const world = camera.matrixWorld.elements;
		view.set( camera.projectionMatrix.elements, 0 );
		view.set( this.matrixWorld.elements, 16 );
		for ( let i = 0; i < 3; i ++ ) for ( let j = 0; j < 3; j ++ ) view[ 32 + i * 3 + j ] = world[ i * 4 + j ];
		view[ 41 ] = world[ 12 ]; view[ 42 ] = world[ 13 ]; view[ 43 ] = world[ 14 ];
		view[ 44 ] = distance;
		this.#lod = point !== null;
		if ( point ) this.#lodAt.copy( point );

	}

	/** Whether this pass culls for what the last one did, the camera within SAME_VIEW of where it stood. */
	#same( camera, point, distance ) {

		const view = this.#view;
		const projection = camera.projectionMatrix.elements, placement = this.matrixWorld.elements, world = camera.matrixWorld.elements;
		for ( let i = 0; i < 16; i ++ ) if ( view[ i ] !== projection[ i ] || view[ 16 + i ] !== placement[ i ] ) return false;
		for ( let i = 0; i < 3; i ++ ) for ( let j = 0; j < 3; j ++ ) if ( view[ 32 + i * 3 + j ] !== world[ i * 4 + j ] ) return false;
		if ( Math.abs( view[ 41 ] - world[ 12 ] ) > SAME_VIEW || Math.abs( view[ 42 ] - world[ 13 ] ) > SAME_VIEW || Math.abs( view[ 43 ] - world[ 14 ] ) > SAME_VIEW ) return false;
		if ( view[ 44 ] !== distance || ( point !== null ) !== this.#lod ) return false;

		return point === null || point.distanceTo( this.#lodAt ) <= SAME_VIEW;

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
