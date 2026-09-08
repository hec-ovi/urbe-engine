import { Vector3 } from 'three/webgpu';

/** Exact published collider triangles transformed only for the selected owner. */
export function * propTriangles( entries, models ) {
	const vertex = new Vector3();
	let chunk = new Float32Array( 2048 * 9 ), count = 0;
	for ( const { item } of entries ) {
		const geometry = models.get( item.model ).collider;
		if ( ! geometry ) continue;
		const positions = geometry.attributes.position, indices = geometry.index;
		for ( let i = 0; i < ( indices?.count ?? positions.count ); i ++ ) {
			vertex.fromBufferAttribute( positions, indices ? indices.getX( i ) : i ).applyMatrix4( item.matrix );
			chunk[ count ++ ] = vertex.x; chunk[ count ++ ] = vertex.y; chunk[ count ++ ] = vertex.z;
			if ( count === chunk.length ) { yield chunk; chunk = new Float32Array( 2048 * 9 ); count = 0; }
		}
	}
	if ( count ) yield chunk.subarray( 0, count );
}
