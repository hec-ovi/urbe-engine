import * as THREE from 'three/webgpu';
import { openingRect } from '../Openings.js';

/** Openings a person passes through. Glazing stays solid. */
const PASSABLE = new Set( [ 'door', 'balconyDoor', 'openFront', 'aperture' ] );
/** How squarely an opening has to face a lot wall before it is that wall's hole. */
const FACING = - 0.5;

/**
 * Where a kit building has to be open.
 *
 * Every opening a person passes through, the street entrance among them, is in
 * the building blueprint, which is the same document the generated shells cut
 * their geometry from. So the colliders read their holes there and a kit parcel
 * is as open as the building behind it is.
 *
 * A facade stands behind its lot line, by a metre on some families and by three
 * and a half on others, so an opening is matched to the lot wall it faces rather
 * than to the one it touches.
 *
 * @param placement KitPlacement
 * @param blueprint the parcel's blueprint document, or null
 * @returns { walls: [{ face, from, to, bottom, top }], roof: [{ u0, v0, u1, v1 }] }
 *   in the lot frame the colliders are cut in
 */
export function interiorOpenings( placement, blueprint ) {

	if ( ! blueprint ) return { walls: [], roof: [] };

	const toLot = _toLot.copy( placement.toWorld ).invert();
	const walls = [];

	for ( const floor of blueprint.floors ?? [] ) {

		for ( const opening of floor.openings ?? [] ) {

			if ( ! PASSABLE.has( opening.kind ) ) continue;

			const rect = openingRect( floor, opening );
			const cut = rect && wallCut( placement, rect, toLot );
			if ( cut ) walls.push( cut );

		}

	}

	return { walls, roof: roofCut( placement, blueprint.roof, toLot ) };

}

/** Which lot wall this opening looks out through, and the span it takes out of it. */
function wallCut( placement, rect, toLot ) {

	const start = _start.copy( rect.start ).applyMatrix4( toLot );
	const end = _end.copy( rect.end ).applyMatrix4( toLot );
	const normal = _normal.copy( rect.normal ).transformDirection( toLot );

	let chosen = null;

	for ( let face = 0; face < 4; face ++ ) {

		const edge = placement.edge( face );
		// The wall an opening faces is the one whose inward side it looks away from.
		const facing = edge.inward[ 0 ] * normal.x + edge.inward[ 1 ] * normal.z;

		if ( facing > FACING || ( chosen && facing > chosen.facing ) ) continue;

		const from = Math.max( 0, Math.min( along( edge, start ), along( edge, end ) ) );
		const to = Math.min( edge.length, Math.max( along( edge, start ), along( edge, end ) ) );

		if ( to - from < 1e-3 ) continue;

		chosen = { face, from, to, bottom: rect.y0, top: rect.y1, facing };

	}

	return chosen;

}

/**
 * The stair head's hole in the roof plate. Its housing stands on the roof and
 * its rectangle is the shaft, so the cap is cut to the rectangle's extent in
 * the lot frame.
 */
function roofCut( placement, roof, toLot ) {

	const bulkhead = roof?.bulkhead;
	if ( ! bulkhead ) return [];

	const centre = _start.set( bulkhead.center[ 0 ], 0, bulkhead.center[ 1 ] ).applyMatrix4( toLot );
	const axis = _end.set( bulkhead.axis[ 0 ], 0, bulkhead.axis[ 1 ] ).transformDirection( toLot ).setY( 0 ).normalize();
	const across = _across.set( - axis.z, 0, axis.x );
	const us = [];
	const vs = [];

	for ( const half of [ bulkhead.width / 2, - bulkhead.width / 2 ] ) {

		for ( const deep of [ bulkhead.depth / 2, - bulkhead.depth / 2 ] ) {

			const corner = _corner.copy( centre ).addScaledVector( axis, half ).addScaledVector( across, deep );
			us.push( corner.x );
			vs.push( corner.z );

		}

	}

	return [ { u0: Math.min( ...us ), v0: Math.min( ...vs ), u1: Math.max( ...us ), v1: Math.max( ...vs ) } ];

}

/** How far along its edge a lot-frame point sits. */
function along( edge, point ) {

	return ( point.x - edge.start[ 0 ] ) * edge.direction[ 0 ] + ( point.z - edge.start[ 1 ] ) * edge.direction[ 1 ];

}

const _toLot = new THREE.Matrix4();
const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _across = new THREE.Vector3();
const _corner = new THREE.Vector3();
