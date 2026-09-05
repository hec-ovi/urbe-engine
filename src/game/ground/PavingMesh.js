import * as THREE from 'three/webgpu';
import { groundTriangles } from './GroundTriangulation.js';

/** Indexed vertex batches, with no Three.js geometry allocation per cell. */
export class PavingMesh {

	constructor() {

		this.positions = [];
		this.normals = [];
		this.uvs = [];
		this.indices = [];

	}

	polygon( polygon, height, frame ) {

		const offset = this.positions.length / 3;
		const triangles = groundTriangles( polygon ) ?? THREE.ShapeUtils.triangulateShape( polygon.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ), [] );
		for ( const point of polygon ) this.vertex( point, height, [ 0, 1, 0 ], frame.uv( point ) );
		for ( const triangle of triangles ) this.indices.push( ...triangle.map( i => offset + i ) );

	}

	quads( polygons, height, frame ) {

		const vertices = new Map();
		for ( const polygon of polygons ) {

			const indices = polygon.map( point => {

				if ( ! vertices.has( point ) ) {

					vertices.set( point, this.positions.length / 3 );
					this.vertex( point, height, [ 0, 1, 0 ], frame.uv( point ) );

				}
				return vertices.get( point );

			} );
			this.indices.push( indices[ 0 ], indices[ 2 ], indices[ 1 ], indices[ 0 ], indices[ 3 ], indices[ 2 ] );

		}

	}

	face( a, b, top, bottom, frame ) {

		const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		if ( length === 0 || top === bottom ) return;
		const normal = [ ( b[ 1 ] - a[ 1 ] ) / length, 0, - ( b[ 0 ] - a[ 0 ] ) / length ];
		const u = frame.faceU( a, b );
		const offset = this.positions.length / 3;
		this.vertex( a, top, normal, [ u[ 0 ], top ] );
		this.vertex( b, top, normal, [ u[ 1 ], top ] );
		this.vertex( a, bottom, normal, [ u[ 0 ], bottom ] );
		this.vertex( b, bottom, normal, [ u[ 1 ], bottom ] );
		this.indices.push( offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3 );

	}

	vertex( point, height, normal, uv ) {

		this.positions.push( point[ 0 ], height, point[ 1 ] );
		this.normals.push( ...normal );
		this.uvs.push( ...uv );

	}

	geometry( collision = false ) {

		if ( ! this.indices.length ) return null;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
		geometry.setIndex( this.indices );
		if ( ! collision ) {

			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.normals, 3 ) );
			geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uvs, 2 ) );

		}
		return geometry;

	}

}
