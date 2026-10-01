import * as THREE from 'three/webgpu';
import { kelvinColor } from './Color.js';
import { SUN_KELVIN } from '../time/DayCycle.js';

/** The colour of the open sky's light, bluer than the sun's. */
const SKY_KELVIN = 9000;
/** Visible transmittance of the glazing. */
const GLASS = 0.6;
/** The share of its half of the sky a facade sees past the street canyon. */
const SKY_SEEN = 0.5;
/** The share of the sun's beam that gets past the neighbours to a facade turned to it. */
const SUN_REACH = 0.4;
/** Reflectance of the street the low light comes up off. */
const GROUND = 0.2;
/** A closed blind still lets this much through. */
const BLIND = 0.2;
/** Openings that are glass the day comes in through. */
const GLAZED = new Set( [ 'window', 'balconyDoor', 'openFront' ] );
/** Metres between the points a window is taken as along its width. */
const STEP = 1;
/** Metres past the wall's inner face a window's points are taken, to find the room behind it. */
const INSET = 0.4;
/** Depth into a room daylight carries, in head heights of the window that lets it in. */
const DEPTH = 1.5;
/** The most a spot by the glass takes over the room's mean. */
const PEAK = 4;
/** Points a room's plan is sampled at, at most, to find the mean of the falloff. */
const PLAN_SAMPLES = 900;

/**
 * The daylight a room takes through its own glass.
 *
 * The exterior box publishes every opening of every storey: the edge of the
 * outline it stands in, its offset, width, sill and head, its glazing and
 * whether a blind is drawn. The light on that glass is the sky's (the half a
 * facade faces, less what the street canyon hides), the sun's when the facade
 * is turned to it, and the street's own glow off the ground. Through the glass
 * it is flux like a fixture's, so a room takes it the way it takes the
 * fixtures the pool never draws (RoomFill): what comes down from the sky and
 * the sun lands on the floor, what comes up off the street on the ceiling,
 * and all of it bounces around the room. Where it lands is near the glass,
 * falling off over a head height and a half: the per-copy fill carries that,
 * so a ceiling panel by the window is brighter than one at the back.
 *
 * A storey with no glazed opening, or a night, takes nothing.
 */

/**
 * The glazed openings of one storey of a blueprint, as points along the glass
 * just inside the wall, each with its share of the glazed area.
 *
 * @param blueprint the building's exterior blueprint ({ floors, facade })
 * @param index the storey
 * @returns [{ outward: [x, z], head, area, points: [{ x, z, area }] }]
 */
export function glazingOf( blueprint, index ) {

	const floor = blueprint?.floors?.find( ( one ) => one.index === index );
	const outline = floor?.outline;
	if ( ! outline?.length ) return [];

	const depth = ( blueprint.facade?.wallDepth ?? 0.7 ) + INSET;
	const winding = Math.sign( ringArea( outline ) ) || 1;
	const windows = [];

	for ( const opening of floor.openings ?? [] ) {

		if ( ! GLAZED.has( opening.kind ) ) continue;

		const a = outline[ opening.edge ];
		const b = outline[ ( opening.edge + 1 ) % outline.length ];
		if ( ! a || ! b ) continue;

		const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		if ( length < 1e-6 ) continue;

		const along = [ ( b[ 0 ] - a[ 0 ] ) / length, ( b[ 1 ] - a[ 1 ] ) / length ];
		// The outward normal of a ring's edge turns with its winding.
		const outward = [ along[ 1 ] * winding, - along[ 0 ] * winding ];
		const glass = opening.glazing ?? opening;
		const width = glass.width ?? opening.width;
		const height = glass.height ?? opening.height;
		const sill = glass.sill ?? opening.sill ?? 0;
		const closed = Math.min( 1, Math.max( 0, ( opening.curtain?.closurePercent ?? 0 ) / 100 ) );
		const area = width * height * ( 1 - closed * ( 1 - BLIND ) );
		if ( ! ( area > 0 ) ) continue;

		const count = Math.max( 1, Math.round( width / STEP ) );
		const points = [];

		for ( let i = 0; i < count; i ++ ) {

			const offset = ( glass.offset ?? opening.offset ) + width * ( i + 0.5 ) / count;
			points.push( {
				x: a[ 0 ] + along[ 0 ] * offset - outward[ 0 ] * depth,
				z: a[ 1 ] + along[ 1 ] * offset - outward[ 1 ] * depth,
				area: area / count
			} );

		}
		windows.push( { outward, head: sill + height, area, points } );

	}

	return windows;

}

/**
 * The illuminance on the glass of a facade facing `outward`, in lux, by where
 * it comes from: what comes down from the sky and the sun, and what comes up
 * off the street.
 *
 * @param sky { daylight, sunLux, skyLuminance, direction: Vector3 towards the sun }
 */
export function facadeLight( outward, sky ) {

	if ( ! sky || ! ( sky.daylight > 0 ) ) return { sky: 0, sun: 0, ground: 0 };

	// A uniform sky of luminance L lights the ground with pi L and a wall with half of it.
	const open = Math.PI * sky.skyLuminance * SKY_SEEN;
	const sun = sky.direction;
	const across = Math.max( 0, outward[ 0 ] * sun.x + outward[ 1 ] * sun.z );
	const beam = sky.sunLux * SUN_REACH;

	return {
		sky: open / 2,
		sun: beam * across,
		ground: GROUND * ( open + beam * Math.max( 0, sun.y ) ) / 2
	};

}

/**
 * What one room takes through the glass that stands at its walls.
 *
 * @param contains ( x, z ) => whether the point is in the room
 * @param windows glazingOf's openings of the room's storey
 * @param sky see facadeLight
 * @returns null when no daylight reaches it, else { down, up, downColor,
 *   upColor, sources: [{ x, z, share, reach }] }: lumens landing on the floor
 *   and on the ceiling, their colours, and where they come in
 */
export function roomDaylight( contains, windows, sky ) {

	if ( ! sky || ! ( sky.daylight > 0 ) || ! windows?.length ) return null;

	const daylight = { down: 0, up: 0, downColor: new THREE.Color( 0, 0, 0 ), upColor: new THREE.Color( 0, 0, 0 ), sources: [] };

	for ( const window of windows ) {

		const light = facadeLight( window.outward, sky );

		for ( const point of window.points ) {

			if ( ! contains( point.x, point.z ) ) continue;

			const through = point.area * GLASS;
			const sky = light.sky * through;
			const sun = light.sun * through;
			const ground = light.ground * through;

			daylight.down += sky + sun;
			daylight.up += ground;
			daylight.downColor.add( _part.copy( SKY ).multiplyScalar( sky ) ).add( _part.copy( SUN ).multiplyScalar( sun ) );
			daylight.upColor.add( _part.copy( SUN ).multiplyScalar( ground ) );
			daylight.sources.push( { x: point.x, z: point.z, flux: sky + sun + ground, reach: DEPTH * window.head } );

		}

	}

	const total = daylight.down + daylight.up;
	if ( ! ( total > 0 ) ) return null;

	if ( daylight.down > 0 ) daylight.downColor.multiplyScalar( 1 / daylight.down );
	if ( daylight.up > 0 ) daylight.upColor.multiplyScalar( 1 / daylight.up );
	for ( const source of daylight.sources ) source.share = source.flux / total;

	return daylight;

}

/**
 * How much of a room's mean daylight lands at a point of its plan: the
 * falloff from each point of glass, over the room's own mean of it, so the
 * room as a whole still takes exactly the flux that came in.
 *
 * @param plan [[x, z]...] points sampled over the room's plan
 * @returns ( x, z ) => weight, 1 on average over the plan
 */
export function daylightSpread( sources, plan ) {

	const falloff = ( x, z ) => {

		let sum = 0;
		for ( const source of sources ) sum += source.share * Math.exp( - Math.hypot( x - source.x, z - source.z ) / source.reach );
		return sum;

	};

	let mean = 0;
	for ( const [ x, z ] of plan ) mean += falloff( x, z );
	mean /= Math.max( 1, plan.length );

	return mean > 0 ? ( x, z ) => Math.min( PEAK, falloff( x, z ) / mean ) : () => 1;

}

/**
 * Points over a room's plan, about evenly spaced, at most PLAN_SAMPLES of them.
 *
 * @param bounds { x0, z0, x1, z1 }
 * @param contains ( x, z ) => whether the point is in the room
 */
export function planSamples( bounds, area, contains ) {

	const step = Math.max( 0.5, Math.sqrt( Math.max( 1, area ) / PLAN_SAMPLES ) );
	const points = [];

	for ( let x = bounds.x0 + step / 2; x < bounds.x1; x += step ) {

		for ( let z = bounds.z0 + step / 2; z < bounds.z1; z += step ) {

			if ( contains( x, z ) ) points.push( [ x, z ] );

		}

	}

	return points;

}

function ringArea( ring ) {

	let twice = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		twice += ax * bz - bx * az;

	}

	return twice / 2;

}

const SKY = kelvinColor( SKY_KELVIN );
const SUN = kelvinColor( SUN_KELVIN );
const _part = new THREE.Color();
