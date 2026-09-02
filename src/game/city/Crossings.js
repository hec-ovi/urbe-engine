import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { paintMaterial, stripe } from './RoadPaint.js';

/** How wide the walking corridor of a crossing is, across the road axis. */
const CORRIDOR = 3.6;
/** Continental bars: equal paint and gap, so the pitch is twice the bar. */
const BAR = 0.45;
const PITCH = BAR * 2;
/** Paint stops this short of each kerb, so no bar climbs the curb stone. */
const KERB_CLEARANCE = 0.3;

/**
 * The painted crossings at every junction the blueprint marks
 * (`streets.crossings`, ../../../../atlas/CONTRACT.md). Each crossing names a
 * node and the segments across it, one per approach, each running kerb to kerb.
 *
 * A segment is drawn continental: bars along the walking direction, repeated
 * across the corridor, which is the pattern a driver reads earliest and the one
 * in the user's street references. The whole city merges into one mesh, so a
 * junction costs nothing per crossing, and the paint wears the same material as
 * the lane markings: lit by the street's own lamps, dark between them, never
 * emissive.
 */
export class Crossings {

	/** @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md */
	constructor( atlas ) {

		this.atlas = atlas;

	}

	/** @returns a THREE.Group named `crossings`, empty when the blueprint marks none */
	build() {

		const group = new THREE.Group();
		group.name = 'crossings';
		const bars = [];

		for ( const crossing of this.atlas.streets?.crossings ?? [] ) {

			for ( const segment of crossing.segments ?? [] ) bars.push( ...barsOf( segment ) );

		}

		if ( bars.length ) group.add( new THREE.Mesh( BufferGeometryUtils.mergeGeometries( bars, false ), paintMaterial() ) );

		return group;

	}

}

/** One segment's bars, centred on its line and inset from both kerbs. */
function barsOf( { from, to } ) {

	const dx = to[ 0 ] - from[ 0 ];
	const dz = to[ 1 ] - from[ 1 ];
	const length = Math.hypot( dx, dz );

	if ( length <= KERB_CLEARANCE * 2 ) return [];

	const ux = dx / length;
	const uz = dz / length;
	const path = [
		[ from[ 0 ] + ux * KERB_CLEARANCE, from[ 1 ] + uz * KERB_CLEARANCE ],
		[ to[ 0 ] - ux * KERB_CLEARANCE, to[ 1 ] - uz * KERB_CLEARANCE ]
	];

	return offsets().map( ( offset ) => stripe( path, { offset, width: BAR } ) ).filter( Boolean );

}

/** Where each bar sits across the corridor, symmetric about the segment line. */
function offsets() {

	const count = Math.max( 2, Math.round( CORRIDOR / PITCH ) );
	const first = - ( count - 1 ) * PITCH / 2;

	return Array.from( { length: count }, ( _, i ) => first + i * PITCH );

}
