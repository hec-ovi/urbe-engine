import * as THREE from 'three/webgpu';
import { openingRect } from './Openings.js';

const LEAF_DEPTH = 0.25;
const LEAF_MARGIN = 0.06;

/**
 * The one ground-floor entrance of a building, read off its exterior blueprint
 * (floor 0, opening kind `door`). Everything the game needs to stand in front
 * of it, prompt for it and swing it: the opening's first jamb (the hinge of a
 * shell that merged its leaf into the wall), the direction the opening runs,
 * the world box its leaves occupy, the outward facing and the walk-in target.
 */
export function doorFrame( blueprint ) {

	const floor = blueprint.floors.find( ( f ) => f.index === 0 );
	const opening = floor?.openings.find( ( o ) => o.kind === 'door' );

	if ( ! opening ) return null;

	const rect = openingRect( floor, opening );

	if ( ! rect ) return null;

	const mid = rect.start.clone().add( rect.end ).multiplyScalar( 0.5 );

	return {
		parcelId: blueprint.buildingId,
		hinge: rect.start.clone(),
		along: rect.end.clone().sub( rect.start ).normalize(),
		normal: rect.normal,
		width: rect.width,
		height: rect.height,
		// Where the prompt fires and where the player ends up walking in.
		center: new THREE.Vector3( mid.x, rect.y0, mid.z ),
		outside: mid.clone().addScaledVector( rect.normal, 1.4 ),
		inside: mid.clone().addScaledVector( rect.normal, - 1.8 ),
		box: leafBox( rect ),
		open: 0,
		wanted: 0,
		pivots: []
	};

}

/** A thin slab around the leaf: wide and tall enough to hold it, too shallow to catch wall. */
function leafBox( rect ) {

	const box = new THREE.Box3();
	const corner = new THREE.Vector3();

	for ( const base of [ rect.start, rect.end ] ) {

		for ( const depth of [ LEAF_DEPTH, - LEAF_DEPTH ] ) {

			for ( const y of [ rect.y0 - LEAF_MARGIN, rect.y1 + LEAF_MARGIN ] ) {

				corner.copy( base ).addScaledVector( rect.normal, depth );
				corner.y = y;
				box.expandByPoint( corner );

			}

		}

	}

	return box.expandByScalar( LEAF_MARGIN );

}
