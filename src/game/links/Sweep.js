import * as THREE from 'three/webgpu';
import { corner } from './PathFrames.js';

/** Corner offsets around a rect section, in half-width and half-height. */
const RECT = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ];

/**
 * A rect link as one open shell: floor, both walls and roof swept along the
 * centerline, with the two end faces left open so each aperture stays a real
 * hole rather than a capped stub.
 *
 * The shell carries no wall thickness. The aperture's cut is this exact
 * surface, and the floor plate the exterior box aligns to the aperture's
 * `base` is the section's own bottom: a thickness would lift the walking
 * surface a step above the building's floor and double the geometry to hide
 * the gap it left at the opening.
 */
export function rectShell( frames, width, height ) {

	const rings = frames.map( ( frame ) => RECT.map(
		( [ across, up ] ) => corner( frame, across * width / 2, up * height / 2 )
	) );

	return sweep( rings, [ width, height, width, height ] );

}

/**
 * A round link as a closed tube of `sides` flats. A wire is 10 cm across and
 * read from metres away, so the flats never show and the tube costs a fraction
 * of a smooth one.
 */
export function roundTube( frames, radius, sides ) {

	const rings = frames.map( ( frame ) => {

		const ring = [];

		for ( let i = 0; i < sides; i ++ ) {

			const angle = i / sides * Math.PI * 2;

			ring.push( corner( frame, Math.cos( angle ) * radius, Math.sin( angle ) * radius ) );

		}

		return ring;

	} );

	return sweep( rings, new Array( sides ).fill( Math.PI * 2 * radius / sides ) );

}

/**
 * Quad strips between consecutive rings, one strip per edge of the section.
 * UVs are world metres both ways, `station` along the link and the section
 * perimeter across it, because every material a link wears tiles over
 * world-metre UVs and a 0..1 unwrap would stretch one tile over the whole span.
 */
function sweep( rings, spans ) {

	const positions = [];
	const uvs = [];
	let across = 0;

	for ( let edge = 0; edge < spans.length; edge ++ ) {

		const next = ( edge + 1 ) % spans.length;

		for ( let i = 0; i < rings.length - 1; i ++ ) {

			quad(
				positions, uvs,
				rings[ i ][ edge ], rings[ i ][ next ], rings[ i + 1 ][ edge ], rings[ i + 1 ][ next ],
				across, across + spans[ edge ]
			);

		}

		across += spans[ edge ];

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	// Non-indexed, so this writes the face normal onto all three vertices.
	// These are flat panels; a smoothed corner would light them as a curve.
	geometry.computeVertexNormals();

	return geometry;

}

/** One face of one segment, wound so its normal points out of the section. */
function quad( positions, uvs, a0, a1, b0, b1, v0, v1 ) {

	for ( const [ c, v ] of [ [ a0, v0 ], [ b0, v0 ], [ a1, v1 ], [ a1, v1 ], [ b0, v0 ], [ b1, v1 ] ] ) {

		positions.push( c.point.x, c.point.y, c.point.z );
		uvs.push( c.station, v );

	}

}
