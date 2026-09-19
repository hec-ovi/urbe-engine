import * as THREE from 'three/webgpu';
import { moduleError } from './InteriorModules.js';

/**
 * What a furnished floor is, to the player's body.
 *
 * Every interior module is built from axis-aligned boxes, so a floor is a
 * compound of cuboids: no cooking, no trimesh, and one broad-phase entry for
 * the whole floor however many walls it holds. A module that is not solid all
 * the way through says so here, because `modules.json` publishes one bounding
 * box per module and a door frame's bounding box is a sealed doorway. Which
 * modules are solid at all is read off the id prefixes Interior publishes.
 *
 * Parts are in the module's own metres around its authored zero, the frame
 * `modules.json` measures `size` and `origin` in. A placement scales them,
 * turns them about +Y and puts them on the floor's elevation.
 */

/**
 * Modules nothing stands on: the lifts move their own copies, and lit
 * fixtures, exposed services and what hangs on a wall carry no collision.
 * Everything else, wall frames and fields, slabs, ceiling bands and fields,
 * the fitted furniture, is solid to its published bounds.
 */
const UNCOLLIDED = /^(lift-car|lift-doors|ceiling-spot|ceiling-cove-|ceiling-led-strip|ceiling-services|wall-screen|wall-art|wall-shelf)/;
/** How thick Interior authors a door frame's jambs and lintel. */
const FRAME_MEMBER = 0.08;
/** And a window return's reveals, sill and head. */
const RETURN_MEMBER = 0.02;
/** A stair tread's slab and the step it rises over the one below. */
const TREAD_THICKNESS = 0.15;
const RISE = 0.17;

/**
 * The cuboids one floor's modules stand as.
 *
 * @param placements the layout's placements, module ones only
 * @param elevation the floor's own elevation
 * @param bounds (moduleId) => { size, origin } from the module catalog
 * @returns [{ center: [x,y,z], halfExtents: [hx,hy,hz], rotationY }]
 */
export function floorBoxes( placements, elevation, bounds ) {

	const boxes = [];

	for ( const placement of placements ) {

		if ( ! placement.module ) continue;

		const published = bounds( placement.module );
		if ( ! published ) continue;

		for ( const part of partsOf( placement.module, published ) ) {

			boxes.push( placed( part, placement, elevation ) );

		}

	}

	return boxes.filter( ( one ) => one.halfExtents.every( ( half ) => half > 1e-4 ) );

}

/**
 * One module's solid parts, in its own frame; none for a module nothing
 * stands on.
 *
 * Every part is cut out of the bounds `modules.json` publishes, so a module
 * Interior re-authors wider, taller or deeper carries its parts with it. What
 * stays authored here is how thick a frame member is and how far a tread
 * rises, and a part that escapes the published bounds is a desync, not a
 * collider: it fails the floor with a closed error.
 */
export function partsOf( id, published ) {

	if ( UNCOLLIDED.test( id ) ) return [];

	const [ low, high ] = extent( id, published );
	const parts = cut( id, low, high );

	for ( const part of parts ) for ( let axis = 0; axis < 3; axis ++ ) {

		if ( part[ axis ] < low[ axis ] - EPSILON || part[ axis + 3 ] > high[ axis ] + EPSILON ) {

			throw moduleError( `${id} parts fall outside the bounds the catalog publishes` );

		}

	}

	return parts;

}

/** The published bounds as the two opposite corners of the module's own box. */
function extent( id, { size, origin } ) {

	const low = [ 0, 1, 2 ].map( ( axis ) => - origin[ axis ] );
	const high = [ 0, 1, 2 ].map( ( axis ) => size[ axis ] - origin[ axis ] );

	if ( high.some( ( value, axis ) => ! ( value > low[ axis ] ) ) ) throw moduleError( `${id} publishes empty bounds` );

	return [ low, high ];

}

function cut( id, [ x0, y0, z0 ], [ x1, y1, z1 ] ) {

	// Two jambs and a lintel: the passage between them is the doorway.
	if ( id === 'door-frame' ) {

		if ( x1 - x0 <= 2 * FRAME_MEMBER || y1 - y0 <= FRAME_MEMBER ) throw moduleError( `${id} leaves no doorway between its jambs` );

		return [
			box( x0, y0, z0, x0 + FRAME_MEMBER, y1 - FRAME_MEMBER, z1 ),
			box( x1 - FRAME_MEMBER, y0, z0, x1, y1 - FRAME_MEMBER, z1 ),
			box( x0, y1 - FRAME_MEMBER, z0, x1, y1, z1 )
		];

	}

	// A window reveal: four returns around an opening that stays glazed.
	if ( id === 'window-return' ) {

		if ( x1 - x0 <= 2 * RETURN_MEMBER || y1 - y0 <= 2 * RETURN_MEMBER ) throw moduleError( `${id} leaves no opening between its reveals` );

		return [
			box( x0, y0, z0, x0 + RETURN_MEMBER, y1, z1 ),
			box( x1 - RETURN_MEMBER, y0, z0, x1, y1, z1 ),
			box( x0 + RETURN_MEMBER, y0, z0, x1 - RETURN_MEMBER, y0 + RETURN_MEMBER, z1 ),
			box( x0 + RETURN_MEMBER, y1 - RETURN_MEMBER, z0, x1 - RETURN_MEMBER, y1, z1 )
		];

	}

	const treads = Number( /^stair-flight-(\d+)$/.exec( id )?.[ 1 ] );
	if ( treads ) return stairTreads( treads, [ x0, y0, z0 ], [ x1, z1 ] );

	// Everything else is solid to its published bounds: a wall piece, a slab,
	// a ceiling field, a fitted desk.
	return [ box( x0, y0, z0, x1, y1, z1 ) ];

}

/**
 * A flight as the run of steps it is. A sloped slab would need a pitch, and a
 * cuboid compound only carries yaw, so each tread is its own box, which is
 * also what the body climbs. The treads share the flight's published width and
 * divide its published depth; the first one's underside is the flight's floor,
 * and the published height also covers the handrail above the top step.
 */
function stairTreads( treads, [ x0, y0, z0 ], [ x1, z1 ] ) {

	const depth = ( z1 - z0 ) / treads;
	const parts = [];

	for ( let step = 0; step < treads; step ++ ) {

		const base = y0 + step * RISE;
		parts.push( box( x0, base, z0 + step * depth, x1, base + TREAD_THICKNESS, z0 + ( step + 1 ) * depth ) );

	}

	return parts;

}

/** One module-local part under a placement, in world metres. */
function placed( part, { position, rotationY, scale }, elevation ) {

	const centre = _centre
		.set(
			( part[ 0 ] + part[ 3 ] ) / 2 * scale[ 0 ],
			( part[ 1 ] + part[ 4 ] ) / 2 * scale[ 1 ],
			( part[ 2 ] + part[ 5 ] ) / 2 * scale[ 2 ]
		)
		.applyAxisAngle( UP, rotationY );

	return {
		center: [
			position[ 0 ] + centre.x,
			position[ 1 ] + centre.y + elevation,
			position[ 2 ] + centre.z
		],
		halfExtents: [
			Math.abs( part[ 3 ] - part[ 0 ] ) / 2 * scale[ 0 ],
			Math.abs( part[ 4 ] - part[ 1 ] ) / 2 * scale[ 1 ],
			Math.abs( part[ 5 ] - part[ 2 ] ) / 2 * scale[ 2 ]
		],
		rotationY
	};

}

function box( x0, y0, z0, x1, y1, z1 ) {

	return [ x0, y0, z0, x1, y1, z1 ];

}

const EPSILON = 1e-6;
const UP = new THREE.Vector3( 0, 1, 0 );
const _centre = new THREE.Vector3();
