import * as THREE from 'three/webgpu';

/** Exact resident render triangles, expanded only as Physics requests each bounded piece. */
export function* groundTriangles( group ) {

	const meshes = [];
	group.updateMatrixWorld( true );
	group.traverse( mesh => { if ( mesh.isMesh && mesh.userData.groundModule?.role !== 'marking' ) meshes.push( mesh ); } );
	let data = new Float32Array( 2048 * 9 ), used = 0;
	const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4(), point = new THREE.Vector3();
	for ( const mesh of meshes ) {

		const positions = mesh.geometry.getAttribute( 'position' ), indices = mesh.geometry.index;
		for ( let copy = 0; copy < ( mesh.isInstancedMesh ? mesh.count : 1 ); copy ++ ) {

			matrix.copy( mesh.matrixWorld );
			if ( mesh.isInstancedMesh ) { mesh.getMatrixAt( copy, instance ); matrix.multiply( instance ); }
			for ( let i = 0; i < ( indices?.count ?? positions.count ); i ++ ) {

				point.fromBufferAttribute( positions, indices ? indices.getX( i ) : i ).applyMatrix4( matrix );
				data[ used ++ ] = point.x; data[ used ++ ] = point.y; data[ used ++ ] = point.z;
				if ( used === data.length ) { yield data; data = new Float32Array( 2048 * 9 ); used = 0; }

			}

		}

	}
	if ( used ) yield data.subarray( 0, used );

}
