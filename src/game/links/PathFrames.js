import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3( 0, 1, 0 );

/**
 * The section frames a link's cross section is swept through, one per point of
 * its centerline. A frame at a bend sits on the bisector of its two segments,
 * so a swept corner is one point rather than two and the sweep has no crack in
 * it. `right` is horizontal and `up` is square to the axis, which is the frame
 * the connections box carved its apertures with.
 *
 * The two end frames carry the plane of the aperture they land on, because a
 * link that meets its wall at an angle is sliced by the wall rather than cut
 * square: cut square it either pokes through the facade or leaves a gap around
 * the opening.
 *
 * @param points the link's `path`, world [ x, y, z ]
 * @param ends { first, last } plane normals of the two apertures, or nothing
 * @returns [ { position, right, up, axis, plane, station } ]
 */
export function framesAlong( points, ends = {} ) {

	const path = points.map( ( point ) => new THREE.Vector3( ...point ) );
	const steps = [];

	for ( let i = 0; i < path.length - 1; i ++ ) {

		steps.push( new THREE.Vector3().subVectors( path[ i + 1 ], path[ i ] ) );

	}

	const frames = [];
	let station = 0;

	for ( let i = 0; i < path.length; i ++ ) {

		if ( i > 0 ) station += steps[ i - 1 ].length();

		const axis = new THREE.Vector3();

		if ( i > 0 ) axis.addScaledVector( steps[ i - 1 ], 1 / steps[ i - 1 ].length() );
		if ( i < steps.length ) axis.addScaledVector( steps[ i ], 1 / steps[ i ].length() );

		axis.normalize();

		const right = new THREE.Vector3().crossVectors( axis, UP ).normalize();

		frames.push( {
			position: path[ i ],
			right,
			up: new THREE.Vector3().crossVectors( right, axis ),
			axis,
			plane: i === 0 ? ends.first ?? null : i === path.length - 1 ? ends.last ?? null : null,
			station
		} );

	}

	return frames;

}

/**
 * One corner of the section at a frame, offset in metres across and up. At the
 * two ends it slides along the axis onto the aperture's plane, which is what
 * lands the end face exactly on the hole the facade was cut with. `station`
 * follows it, so the world-metre UV stays true across the mitre.
 * @returns { point: Vector3, station }
 */
export function corner( frame, across, upward ) {

	const point = frame.position.clone()
		.addScaledVector( frame.right, across )
		.addScaledVector( frame.up, upward );

	if ( ! frame.plane ) return { point, station: frame.station };

	const slide = frame.position.clone().sub( point ).dot( frame.plane ) / frame.axis.dot( frame.plane );

	return { point: point.addScaledVector( frame.axis, slide ), station: frame.station + slide };

}
