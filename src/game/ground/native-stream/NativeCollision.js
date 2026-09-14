import { Vector3 } from 'three/webgpu';

/** Physical triangles only, transformed once by their original GLB node matrices. */
export function* nativeTriangles( group ) {
	group.updateMatrixWorld( true );
	const meshes = [];
	group.traverse( mesh => { if ( mesh.isMesh && mesh.userData.streetCollision === true ) meshes.push( mesh ); } );
	let batch = new Float32Array( 2048 * 9 ), used = 0;
	const point = new Vector3();
	for ( const mesh of meshes ) {
		const positions = mesh.geometry.getAttribute( 'position' ), index = mesh.geometry.index;
		for ( let i = 0; i < ( index?.count ?? positions.count ); i ++ ) {
			point.fromBufferAttribute( positions, index ? index.getX( i ) : i ).applyMatrix4( mesh.matrixWorld );
			batch[ used ++ ] = point.x; batch[ used ++ ] = point.y; batch[ used ++ ] = point.z;
			if ( used === batch.length ) { yield batch; batch = new Float32Array( 2048 * 9 ); used = 0; }
		}
	}
	if ( used ) yield batch.subarray( 0, used );
}
