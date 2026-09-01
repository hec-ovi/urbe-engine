import * as THREE from 'three/webgpu';

/**
 * The plane each aperture's cut polygon lies in, by aperture id. A link's end
 * has to be sliced by that plane and no other: the cut is the exact hole the
 * facade was carved with, and a link meeting its wall at an angle only closes
 * on that hole when its end face is the wall's own plane.
 *
 * @param apertures the connections document's `apertures`
 * @returns Map<apertureId, Vector3> the plane normal
 */
export function cutPlanes( apertures ) {

	return new Map( apertures.map( ( aperture ) => [ aperture.id, normalOf( aperture.cut.polygon ) ] ) );

}

/**
 * Newell's normal: exact for the quad a rect link cuts, and stable for the
 * sampled ellipse a round one leaves, where any single vertex triple can be
 * near collinear and a cross product would come out as noise.
 */
function normalOf( polygon ) {

	const normal = new THREE.Vector3();

	for ( let i = 0; i < polygon.length; i ++ ) {

		const a = polygon[ i ];
		const b = polygon[ ( i + 1 ) % polygon.length ];

		normal.x += ( a[ 1 ] - b[ 1 ] ) * ( a[ 2 ] + b[ 2 ] );
		normal.y += ( a[ 2 ] - b[ 2 ] ) * ( a[ 0 ] + b[ 0 ] );
		normal.z += ( a[ 0 ] - b[ 0 ] ) * ( a[ 1 ] + b[ 1 ] );

	}

	return normal.normalize();

}
