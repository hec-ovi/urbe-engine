import * as THREE from 'three/webgpu';
import { corner } from './PathFrames.js';

/**
 * A link swept along its centerline: quad strips between consecutive section
 * rings, one strip per edge of the section, grouped by the material role that
 * edge carries. The two end faces are left open so each aperture stays a real
 * hole rather than a capped stub.
 *
 * The shell carries no wall thickness. The aperture's cut is this exact
 * surface, and the floor you walk on is the section's own bottom, level with
 * the floor plate the exterior box aligns to the aperture's `base`: a
 * thickness would lift the walking surface a step above the building's floor
 * and double the geometry to hide the gap it left at the opening.
 *
 * UVs are world metres both ways, `station` along the link and the section
 * perimeter across it, because every material a link wears tiles over
 * world-metre UVs and a 0..1 unwrap would stretch one tile over the whole span.
 *
 * @param frames section frames from `framesAlong`
 * @param section `{ corners, roles }` from Sections.js
 * @returns Map<role, BufferGeometry>
 */
export function sweep( frames, { corners, roles } ) {

	const rings = frames.map( ( frame ) => corners.map(
		( [ across, up ] ) => corner( frame, across, up )
	) );
	const strips = new Map();
	let across = 0;

	for ( let edge = 0; edge < corners.length; edge ++ ) {

		const next = ( edge + 1 ) % corners.length;
		const span = Math.hypot(
			corners[ next ][ 0 ] - corners[ edge ][ 0 ],
			corners[ next ][ 1 ] - corners[ edge ][ 1 ]
		);

		if ( ! strips.has( roles[ edge ] ) ) strips.set( roles[ edge ], { positions: [], uvs: [] } );

		const strip = strips.get( roles[ edge ] );

		for ( let i = 0; i < rings.length - 1; i ++ ) {

			quad(
				strip,
				rings[ i ][ edge ], rings[ i ][ next ], rings[ i + 1 ][ edge ], rings[ i + 1 ][ next ],
				across, across + span
			);

		}

		across += span;

	}

	return new Map( [ ...strips ].map( ( [ role, strip ] ) => [ role, geometryOf( strip ) ] ) );

}

function geometryOf( { positions, uvs } ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	// Non-indexed, so this writes the face normal onto all three vertices.
	// These are flat panels; a smoothed corner would light them as a curve.
	geometry.computeVertexNormals();

	return geometry;

}

/** One face of one segment, wound so its normal points out of the section. */
function quad( strip, a0, a1, b0, b1, v0, v1 ) {

	for ( const [ c, v ] of [ [ a0, v0 ], [ b0, v0 ], [ a1, v1 ], [ a1, v1 ], [ b0, v0 ], [ b1, v1 ] ] ) {

		strip.positions.push( c.point.x, c.point.y, c.point.z );
		strip.uvs.push( c.station, v );

	}

}
