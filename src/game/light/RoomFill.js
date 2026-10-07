import * as THREE from 'three/webgpu';
import { luminance } from './Color.js';

/**
 * Diffuse reflectance per material kind, used to weight a room's own surfaces.
 * These are the standard interior-design figures for the surface each key
 * stands for, not measurements of the maps: what the formula needs is the
 * fraction of light a wall returns, and that is a property of the surface.
 * A composed kind (`interior-luxury-ceiling`) is the surface its last word
 * names.
 */
const ALBEDO = {
	ceiling: 0.7,
	plaster: 0.55,
	wall: 0.5,
	// a coat of colour (the poor buildings' teal, olive and mauve, a smoke-stained ceiling) returns
	// less than bare plaster: the paints the worn interiors wear are dark ones
	paint: 0.25,
	tile: 0.4,
	concrete: 0.35,
	metal: 0.35,
	floor: 0.35,
	wood: 0.3,
	timber: 0.3,
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

	const kind = key.split( '/' )[ 1 ] ?? '';

	return ALBEDO[ kind ] ?? ALBEDO[ kind.split( '-' ).pop() ] ?? DEFAULT_ALBEDO;

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
	 * The fill as one copy of a draw carries it: the irradiance on a surface
	 * facing up, and the share of it a surface facing down takes. A surface
	 * facing down reads different from one facing up, which is what makes the
	 * gradient up a wall look like bounce instead of ambient.
	 *
	 * The interreflected light reaches every surface alike, the ceiling as much
	 * as the floor: solved as a box of floor, walls and ceiling exchanging
	 * light, a ceiling over downlights takes about the room's mean bounce
	 * whatever its own colour. Then the fixtures no light is drawn for
	 * (`unseen`, from RoomLights.unseen): the pool draws a handful per room and
	 * a sales floor hangs forty downlights, so without this their flux would
	 * light the room only by its bounce and the floor between the drawn ones
	 * would sit at a third of its level. Their first bounce is not lost: what
	 * faces down lands on the floor, what faces up on the ceiling, each spread
	 * over that surface and the half of the walls standing nearest it, which is
	 * what a wall reads between the two halves of the node. That is the pooled
	 * floor under a grid of downlights and the washed ceiling over a cove, at
	 * the room's own flux.
	 *
	 * @param room { area, albedo }
	 * @param unseen { down, up, downColor, upColor }: lumens no light is drawn for, and their colours
	 */
	static perCopy( room, flux, color, unseen = NONE, target = new THREE.Vector4() ) {

		const { up, down } = RoomFill.parts( room, flux, color, unseen );

		return RoomFill.pack( up, down, target );

	}

	/**
	 * The two halves before they are packed: irradiance in lux on a surface
	 * facing up and on one facing down, colours that add.
	 */
	static parts( room, flux, color, unseen = NONE, into = { up: new THREE.Color(), down: new THREE.Color() } ) {

		const bounce = RoomFill.irradiance( room, flux, color, _bounce );
		const landing = RoomFill.landing( room );

		into.up.copy( bounce ).add( _direct.copy( unseen.downColor ?? WHITE ).multiplyScalar( ( unseen.down ?? 0 ) / landing ) );
		into.down.copy( bounce ).add( _direct.copy( unseen.upColor ?? WHITE ).multiplyScalar( ( unseen.up ?? 0 ) / landing ) );

		return into;

	}

	/** The halves as a copy carries them: the upper's colour and the lower's share of it. */
	static pack( up, down, target = new THREE.Vector4() ) {

		const lit = luminance( up );

		return target.set( up.r, up.g, up.b, lit > 0 ? luminance( down ) / lit : 1 );

	}

	/**
	 * The surface a fixture's first bounce lands on: the floor or the ceiling
	 * it faces, and half the walls. A room's enclosure is its floor, its
	 * ceiling and its walls, so that comes to half of it whatever its plan.
	 */
	static landing( room ) {

		return Math.max( 1, room.area / 2 );

	}

}

const NONE = Object.freeze( { down: 0, up: 0 } );
const WHITE = new THREE.Color( 1, 1, 1 );
const _bounce = new THREE.Color();
const _direct = new THREE.Color();
