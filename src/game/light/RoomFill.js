import * as THREE from 'three/webgpu';
import { luminance } from './Color.js';

/**
 * Diffuse reflectance per material kind, used to weight a room's own surfaces.
 * These are the standard interior-design figures for the surface each key
 * stands for, not measurements of the maps: what the formula needs is the
 * fraction of light a wall returns, and that is a property of the surface.
 */
const ALBEDO = {
	ceiling: 0.7,
	plaster: 0.55,
	wall: 0.5,
	tile: 0.4,
	concrete: 0.35,
	metal: 0.35,
	'floor-slab': 0.35,
	wood: 0.3,
	fabric: 0.3,
	rubber: 0.22,
	carpet: 0.2,
	'elevator_door': 0.35,
	glass: 0.1
};

const DEFAULT_ALBEDO = 0.4;
/** Nothing returns everything: without a ceiling the series would not close. */
const MAX_ALBEDO = 0.8;

/** The reflectance of one material key, from the kind in the middle of it. */
export function albedoOf( key ) {

	return ALBEDO[ key.split( '/' )[ 1 ] ] ?? DEFAULT_ALBEDO;

}

/**
 * The light a room returns to itself, computed from what the interior box
 * published rather than dialled by hand.
 *
 * For total interior surface area A, area-weighted reflectance p and total
 * fixture flux F in lumens, full interreflection settles at
 *
 *     E = (F / A) * p / (1 - p)      lux, per channel
 *
 * which for a small room lands the same order as the key light, exactly as a
 * real room does. The colour falls out for free: p is per-channel, so a room of
 * warm surfaces genuinely goes warmer with every bounce, and that is the
 * brown-green shadow a photograph of a night interior has and a flat ambient
 * never does.
 *
 * Each copy of a draw carries its room's fill (RoomFillNode), for which
 * `color * intensity` is the irradiance in lux exactly, three operations and
 * no BRDF.
 */
export class RoomFill {

	/**
	 * @param room { area, albedo: Color, floorAlbedo: Color }
	 * @param flux total lumens in the room
	 * @param color flux-weighted colour of the room's fixtures
	 */
	static irradiance( room, flux, color, target = new THREE.Color() ) {

		const perArea = flux / Math.max( 1, room.area );
		const bounce = ( p ) => Math.min( MAX_ALBEDO, p ) / ( 1 - Math.min( MAX_ALBEDO, p ) );

		return target.setRGB(
			perArea * color.r * bounce( room.albedo.r ),
			perArea * color.g * bounce( room.albedo.g ),
			perArea * color.b * bounce( room.albedo.b ),
			THREE.LinearSRGBColorSpace
		);

	}

	/**
	 * The fill as one copy of a draw carries it: the interreflected irradiance,
	 * and the floor's reflectance for the half of it that comes back up off the
	 * floor. A surface facing down reads different from one facing up, which is
	 * what makes the gradient up a wall look like bounce instead of ambient.
	 */
	static perCopy( room, flux, color, target = new THREE.Vector4() ) {

		const up = RoomFill.irradiance( room, flux, color, _up );

		return target.set( up.r, up.g, up.b, luminance( room.floorAlbedo ) );

	}

}

const _up = new THREE.Color();
