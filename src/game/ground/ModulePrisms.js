import * as THREE from 'three/webgpu';
import { PavingMesh } from './PavingMesh.js';
import { PavingFrame } from './PavingFrame.js';
import { signedArea } from './Polygons.js';

const FRAME = new PavingFrame( { origin: [ 0, 0 ], u: [ 1, 0 ], gridStep: 0.001 } );

/** One closed, indexed geometry per module role, in the authored local metres. */
export class ModulePrisms extends PavingMesh {

	add( { polygon, top, bottom } ) {

		const ring = signedArea( polygon ) > 0 ? polygon : [ ...polygon ].reverse();
		this.polygon( ring, top, FRAME );
		if ( top === bottom ) return;
		const first = this.indices.length;
		const vertex = this.positions.length / 3;
		this.polygon( ring, bottom, FRAME );
		for ( let i = first; i < this.indices.length; i += 3 ) [ this.indices[ i ], this.indices[ i + 1 ] ] = [ this.indices[ i + 1 ], this.indices[ i ] ];
		for ( let i = vertex; i < this.positions.length / 3; i ++ ) this.normals[ i * 3 + 1 ] = - 1;
		for ( let i = 0; i < ring.length; i ++ ) this.face( ring[ i ], ring[ ( i + 1 ) % ring.length ], top, bottom, FRAME );

	}

}

/** Indexed world collision expands each shared template directly into one buffer. */
export function moduleCollision( batches ) {

	let vertexCount = 0, indexCount = 0;
	for ( const { geometry, transforms } of batches ) {

		vertexCount += geometry.getAttribute( 'position' ).count * transforms.length;
		indexCount += geometry.index.count * transforms.length;

	}
	if ( ! indexCount ) return null;
	const positions = new Float32Array( vertexCount * 3 );
	const indices = new Uint32Array( indexCount );
	let vertexOffset = 0, indexOffset = 0;
	for ( const { geometry, transforms } of batches ) {

		const source = geometry.getAttribute( 'position' );
		for ( const matrix of transforms ) {

			const m = matrix.elements;
			for ( let i = 0; i < source.count; i ++ ) {

				const x = source.getX( i ), y = source.getY( i ), z = source.getZ( i );
				const offset = ( vertexOffset + i ) * 3;
				positions[ offset ] = m[ 0 ] * x + m[ 8 ] * z + m[ 12 ];
				positions[ offset + 1 ] = y;
				positions[ offset + 2 ] = m[ 2 ] * x + m[ 10 ] * z + m[ 14 ];

			}
			for ( const index of geometry.index.array ) indices[ indexOffset ++ ] = vertexOffset + index;
			vertexOffset += source.count;

		}

	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setIndex( new THREE.BufferAttribute( indices, 1 ) );
	return geometry;

}
