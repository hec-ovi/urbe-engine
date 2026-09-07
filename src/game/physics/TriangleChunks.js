import { BufferAttribute, BufferGeometry } from 'three/webgpu';

const BAND_CHUNK_TRIANGLES = 2048;

/** Exact triangle order and winding, with one bounded allocation per cook. */
export function* triangleChunks( source ) {

	for ( const part of source?.isBufferGeometry ? [ source ] : source ?? [] ) {

		const position = part.isBufferGeometry ? part.getAttribute( 'position' ) : null;
		const indices = part.index;
		const count = position ? indices?.count ?? position.count : part.length / 3;
		if ( ! Number.isInteger( count ) || count % 3 ) throw new Error( 'E_PHYSICS_BAND: complete triangles are required' );
		for ( let start = 0; start < count; start += BAND_CHUNK_TRIANGLES * 3 ) {

			const size = Math.min( count - start, BAND_CHUNK_TRIANGLES * 3 );
			const vertices = new Float32Array( size * 3 );
			if ( ! position ) vertices.set( part.subarray( start * 3, ( start + size ) * 3 ) );
			else for ( let i = 0; i < size; i ++ ) {

				const index = indices ? indices.getX( start + i ) : start + i;
				vertices[ i * 3 ] = position.getX( index );
				vertices[ i * 3 + 1 ] = position.getY( index );
				vertices[ i * 3 + 2 ] = position.getZ( index );

			}
			if ( ! vertices.every( Number.isFinite ) ) throw new Error( 'E_PHYSICS_BAND: finite positions are required' );
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new BufferAttribute( vertices, 3 ) );
			yield geometry;

		}

	}

}
