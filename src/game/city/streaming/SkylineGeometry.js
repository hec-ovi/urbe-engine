import * as THREE from 'three/webgpu';

/** Distant geometry from authored Exterior massing and material bindings. */
export class SkylineGeometry {

	constructor( factory ) {

		this.factory = factory;
		this.buckets = new Map();

	}

	add( record ) {

		for ( const band of record.bands ) {

			this.walls( band.outline, band.bottom, band.top, band.material );
			if ( band.top !== record.roof.elevation ) this.cap( band.outline, band.top, record.roof.material );

		}
		const roof = record.roof;
		this.cap( roof.outline, roof.elevation, roof.material );
		if ( roof.parapetHeight > 0 ) this.walls( roof.outline, roof.elevation,
			roof.elevation + roof.parapetHeight, roof.parapetMaterial );

	}

	walls( outline, bottom, top, material ) {

		const bucket = this.bucket( material );
		for ( let i = 0; i < outline.length; i ++ ) {

			const a = outline[ i ], b = outline[ ( i + 1 ) % outline.length ];
			const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
			const normal = [ ( b[ 1 ] - a[ 1 ] ) / length, 0, ( a[ 0 ] - b[ 0 ] ) / length ];
			const vertices = [ [ a[ 0 ], bottom, a[ 1 ] ], [ a[ 0 ], top, a[ 1 ] ],
				[ b[ 0 ], top, b[ 1 ] ], [ b[ 0 ], bottom, b[ 1 ] ] ];
			const uv = [ [ 0, bottom ], [ 0, top ], [ length, top ], [ length, bottom ] ];
			for ( const vertex of [ 0, 1, 2, 0, 2, 3 ] ) {

				bucket.position.push( ...vertices[ vertex ] );
				bucket.normal.push( ...normal );
				bucket.uv.push( ...uv[ vertex ] );

			}

		}

	}

	cap( outline, elevation, material ) {

		const bucket = this.bucket( material );
		const contour = outline.map( point => new THREE.Vector2( ...point ) );
		for ( const triangle of THREE.ShapeUtils.triangulateShape( contour, [] ) ) {

			for ( const vertex of [ triangle[ 2 ], triangle[ 1 ], triangle[ 0 ] ] ) {

				const [ x, z ] = outline[ vertex ];
				bucket.position.push( x, elevation, z );
				bucket.normal.push( 0, 1, 0 );
				bucket.uv.push( x, z );

			}

		}

	}

	bucket( material ) {

		const key = JSON.stringify( material );
		if ( ! this.buckets.has( key ) ) this.buckets.set( key, { material, position: [], normal: [], uv: [] } );
		return this.buckets.get( key );

	}

	async finish( yieldTask ) {

		const group = new THREE.Group();
		group.name = 'distant-shells';
		for ( const { material, position, normal, uv } of this.buckets.values() ) {

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( position, 3 ) );
			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normal, 3 ) );
			geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
			geometry.computeBoundingSphere();
			const mesh = new THREE.Mesh( geometry, this.factory.build( material.key, material.variantId ) );
			mesh.receiveShadow = true;
			group.add( mesh );
			await yieldTask();

		}
		this.buckets.clear();
		return group;

	}

}
