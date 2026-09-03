import * as THREE from 'three/webgpu';
import { openingRect } from './Openings.js';

const LEAF_DEPTH = 0.25;
const LEAF_MARGIN = 0.06;
const DEFAULT_FRAME_DEPTH = 0.08;

/**
 * Every moving Exterior leaf gets its own interaction frame. The stable
 * opening id is also the ownership boundary for named GLB leaf nodes, so one
 * door can never swing a different entrance, balcony or roof leaf.
 */
export function doorFrames( blueprint ) {

	const frames = [];

	for ( const floor of blueprint.floors ) {

		for ( const opening of floor.openings ) {

			if ( opening.kind !== 'door' && opening.kind !== 'balconyDoor' ) continue;

			const rect = openingRect( floor, opening );
			if ( ! rect ) continue;

			frames.push( frame( blueprint, floor, opening, rect ) );

		}

	}

	const roof = roofDoorRect( blueprint );
	if ( roof ) frames.push( frame( blueprint, { index: roof.floor }, {
		id: 'roof-bulkhead', kind: 'door', doorRole: 'roof',
		door: { frameDepth: DEFAULT_FRAME_DEPTH }
	}, roof ) );

	return frames;

}

/** Returns the exact frame named by a sanitized GLTFLoader leaf node. */
export function doorLeafOwner( name, frames ) {

	return frames.find( ( candidate ) => String( name ).startsWith( candidate.nodeStem ) ) ?? null;

}

function frame( blueprint, floor, opening, rect ) {

	const mid = rect.start.clone().add( rect.end ).multiplyScalar( 0.5 );
	const prefix = opening.kind === 'balconyDoor' ? 'balcony' : 'door';

	return {
		id: opening.id,
		parcelId: blueprint.buildingId,
		floor: floor.index,
		kind: opening.kind,
		role: opening.doorRole ?? null,
		nodeStem: sanitizeNodeName( `${prefix}:${opening.id}/leaf:` ),
		hinge: rect.start.clone(),
		along: rect.end.clone().sub( rect.start ).normalize(),
		normal: rect.normal,
		width: rect.width,
		height: rect.height,
		// The shell's fitted casing projects this far outside its wall plane.
		// Anything added around a street entrance starts beyond it.
		surfaceDepth: opening.door?.frameDepth ?? DEFAULT_FRAME_DEPTH,
		center: new THREE.Vector3( mid.x, rect.y0, mid.z ),
		outside: mid.clone().addScaledVector( rect.normal, 1.4 ),
		inside: mid.clone().addScaledVector( rect.normal, - 1.8 ),
		box: leafBox( rect ),
		open: 0,
		wanted: 0,
		pivots: []
	};

}

/** Exterior publishes the bulkhead and its roof-facing doorway together. */
function roofDoorRect( blueprint ) {

	const roof = blueprint.roof;
	const bulkhead = roof?.bulkhead;
	if ( ! bulkhead ) return null;

	const axis = new THREE.Vector3( bulkhead.axis[ 0 ], 0, bulkhead.axis[ 1 ] ).normalize();
	const normal = new THREE.Vector3( bulkhead.doorNormal[ 0 ], 0, bulkhead.doorNormal[ 1 ] ).normalize();
	const mid = new THREE.Vector3( bulkhead.center[ 0 ], roof.elevation, bulkhead.center[ 1 ] )
		.addScaledVector( normal, bulkhead.depth / 2 );
	const start = mid.clone().addScaledVector( axis, bulkhead.doorWidth / 2 );
	const end = mid.clone().addScaledVector( axis, - bulkhead.doorWidth / 2 );

	return {
		start,
		end,
		normal,
		y0: roof.elevation,
		y1: roof.elevation + bulkhead.doorHeight,
		width: bulkhead.doorWidth,
		height: bulkhead.doorHeight,
		floor: Math.max( ...blueprint.floors.map( ( floor ) => floor.index ) ) + 1
	};

}

/** Matches Three.PropertyBinding.sanitizeNodeName for Exterior's stable names. */
function sanitizeNodeName( name ) {

	return name.replace( /\s/g, '_' ).replace( /[\[\].:\/]/g, '' );

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
