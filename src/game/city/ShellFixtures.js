import * as THREE from 'three/webgpu';
import { Rng } from '../../city/Rng.js';
import { kelvinColor } from '../light/Color.js';
import { scenicLights } from './ScenicLights.js';

// Colours only ever drive the point lights that spill onto the street; the
// panels themselves are lit by their own emission maps from the materials
// database, so the signage never turns into flat coloured cards.
export const GLOW = [ 0xff2fb0, 0x24e0ff, 0xffa42b, 0x9b5cff, 0x2bff9e ];
// Flux in lumens, as the materials the fixture is made of would really emit: a
// neon sign is a small source (100-400 lm), a shop entrance carries about one
// bare bulb.
const SIGN_LUMENS = [ 140, 420 ];
const SIGN_RANGE = 14;
const DOOR_KELVIN = 2700;
const DOOR_LUMENS = 800;
const DOOR_RANGE = 12;

/**
 * Every light a building carries itself, in the lumens the fixture would
 * really emit: the rooms behind its windows, the sign on its face and the
 * lights over its doors. Exterior publishes all three, so the city and a
 * preview of one building light it from the same list.
 *
 * @param rng the parcel's seeded stream, shared with whatever else that parcel
 * draws from it, so a rebuild repeats its signs
 * @returns [{ position, color, lumens, range, ... }] for light/CityLights.js
 */
export function shellGlows( { parcelId, blueprint, hasInterior, rng = new Rng( parcelSeed( parcelId ) ) } ) {

	const glows = scenicLights( { parcelId, blueprint, hasInterior } );

	// The parcel's own lettered sign, standing just off its face.
	for ( const sign of blueprint.signage ?? [] ) {

		const [ nx, nz ] = sign.normal;
		const reach = ( sign.depth ?? 0 ) + 0.4;

		glows.push( {
			position: new THREE.Vector3(
				sign.center[ 0 ] + nx * reach,
				sign.center[ 1 ],
				sign.center[ 2 ] + nz * reach
			),
			color: new THREE.Color( GLOW[ Math.floor( rng.next() * GLOW.length ) ] ),
			lumens: rng.range( SIGN_LUMENS[ 0 ], SIGN_LUMENS[ 1 ] ) * Math.max( 1, sign.width / 2 ),
			range: SIGN_RANGE,
			// Whose sign this is, so it can go dark when the place shuts.
			parcelId,
			kind: 'sign'
		} );

	}

	// The fixtures exterior put over the entrance: the light on the pavement.
	for ( const light of blueprint.lights ?? [] ) {

		if ( light.kind !== 'entrance' && light.lumens === undefined ) continue;

		const [ nx, nz ] = light.normal;

		glows.push( {
			position: new THREE.Vector3(
				light.position[ 0 ] + nx * 0.4,
				light.position[ 1 ],
				light.position[ 2 ] + nz * 0.4
			),
			color: light.color ? new THREE.Color( light.color ) : kelvinColor( DOOR_KELVIN ),
			lumens: light.lumens ?? DOOR_LUMENS,
			range: light.range ?? DOOR_RANGE,
			parcelId,
			kind: light.kind === 'entrance' ? 'entrance' : 'facade'
		} );

	}

	return glows;

}

/** The seed a parcel's own randomness runs from. */
export function parcelSeed( parcelId ) {

	let h = 2166136261;

	for ( let i = 0; i < parcelId.length; i ++ ) {

		h = Math.imul( h ^ parcelId.charCodeAt( i ), 16777619 );

	}

	return h >>> 0;

}
