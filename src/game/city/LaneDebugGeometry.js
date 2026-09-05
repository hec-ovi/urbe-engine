import * as THREE from 'three/webgpu';

/** A diagnostic ribbon centered on an authoritative 3D path. */
export function stripe( path, { width, y } ) {

	const positions = [];
	for ( let i = 1; i < path.length; i ++ ) {

		const [ ax, ay, az ] = path[ i - 1 ];
		const [ bx, by, bz ] = path[ i ];
		const length = Math.hypot( bx - ax, bz - az );
		if ( length === 0 ) continue;
		const nx = - ( bz - az ) / length * width / 2;
		const nz = ( bx - ax ) / length * width / 2;
		positions.push(
			ax + nx, ay + y, az + nz, bx - nx, by + y, bz - nz, ax - nx, ay + y, az - nz,
			ax + nx, ay + y, az + nz, bx + nx, by + y, bz + nz, bx - nx, by + y, bz - nz
		);

	}
	if ( ! positions.length ) return null;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();
	return geometry;

}
