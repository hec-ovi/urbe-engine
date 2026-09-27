import * as THREE from 'three/webgpu';
import { attribute, positionLocal, positionView, smoothstep, uniform, varying, vec3 } from 'three/tsl';
import { luminance } from '../light/Color.js';

/** Metres of rain kept around the eye: wide enough for a street, tall enough to fall past a first-floor window. */
export const RAIN_BOX = Object.freeze( { width: 36, height: 16 } );
const SIZE = new THREE.Vector3( RAIN_BOX.width, RAIN_BOX.height, RAIN_BOX.width );
const HALF = SIZE.clone().multiplyScalar( 0.5 );
/** How far above the eye the box is centred: what falls below the pavement is never seen. */
const LIFT = 4;
/** Terminal speed of a heavy raindrop, metres per second. */
export const FALL = 9;
/** One drop's streak over a 1/25 s exposure at that speed, slanted by a light wind. */
export const STREAK = Object.freeze( [ 0.03, - 0.36, 0.012 ] );
/**
 * What a streak returns, in the scene's cd/m2: skyglow plus a share of the
 * street light around the eye. A drop is a small lens that gathers the light
 * around it, but one value lights the whole field, so it grows with the square
 * root of the lux and eases: walking from a lamp to the dark middle of a block
 * dims the rain about twofold over a second instead of fivefold at once.
 */
export const RAIN_LIGHT = Object.freeze( { base: 0.8, perRootLux: 1, ease: 0.4 } );
/** A streak's coverage of the pixels it crosses. */
const OPACITY = 0.4;
/** How far the dry air under a canopy reaches from the eye, in metres. */
const COVER = 3;
/** Rain is nearly colourless: the light it falls through tints it only this much. */
const TINT = 0.4;
/** The neutral a streak leans to: cool, at unit luminance. */
const COOL = new THREE.Color( 0.8, 0.9, 1 );
COOL.multiplyScalar( 1 / luminance( COOL ) );
/**
 * After the world's transparent surfaces (road paint, signs, glass, shoreline
 * bands at 1): the streaks add light and test depth without writing it, so
 * drawn last they add over what stands behind them and nothing blends over
 * them. Their object sits at the origin, so distance sorting would misplace them.
 */
export const RAIN_RENDER_ORDER = 2;

/**
 * Where a drop is in the world: its place in the field, fallen and wrapped
 * into the box around `center`. The shader takes the same steps with the same
 * box, so a drop keeps its world place until it leaves the box and comes back
 * one box away on the other side.
 */
export function dropAt( origin, fallen, center, target = new THREE.Vector3() ) {

	target.set( origin.x, origin.y - fallen, origin.z ).sub( center ).add( HALF );
	target.set( floorMod( target.x, SIZE.x ), floorMod( target.y, SIZE.y ), floorMod( target.z, SIZE.z ) );
	return target.sub( HALF ).add( center );

}

/**
 * Falling streaks around the camera in one draw. Every drop keeps its place
 * in the world while the eye moves through the field: its position wraps into
 * the box centred on the eye (dropAt), so walking passes drops by instead of
 * carrying them along. Drops fade near the eye, where a streak would cross the
 * whole view, and at the box's edge, where they wrap.
 */
export class Rain {

	#shown = false;

	constructor( count ) {

		const positions = new Float32Array( count * 6 );
		const origins = new Float32Array( count * 6 );
		for ( let index = 0; index < count; index ++ ) {

			const x = random( index * 3 ) * SIZE.x;
			const y = random( index * 3 + 1 ) * SIZE.y;
			const z = random( index * 3 + 2 ) * SIZE.z;
			origins.set( [ x, y, z, x, y, z ], index * 6 );
			positions.set( [ 0, 0, 0, ...STREAK ], index * 6 );

		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'rainOrigin', new THREE.BufferAttribute( origins, 3 ) );

		/** The box's centre in the world, above the eye. */
		this.center = uniform( new THREE.Vector3() );
		/** Metres every drop has fallen, kept within one box height so precision never drifts. */
		this.fallen = uniform( 0 );
		/** Streak radiance in cd/m2, from the light around the eye. */
		this.light = uniform( new THREE.Color() );
		/** Metres of dry air kept around an eye under cover; the street beyond it still shows rain. */
		this.dry = uniform( 0 );

		const size = vec3( SIZE ), half = vec3( HALF );
		const origin = attribute( 'rainOrigin', 'vec3' );
		// dropAt, relative to the centre: both ends of a streak share it, so a streak never splits across the wrap.
		const drop = varying( origin.sub( vec3( 0, this.fallen, 0 ) ).sub( this.center ).add( half ).mod( size ).sub( half ) );
		const edge = smoothstep( 0.7, 1, drop.div( half ).length() ).oneMinus();
		const near = smoothstep( this.dry.add( 0.8 ), this.dry.add( 3 ), positionView.length() );

		const material = new THREE.LineBasicNodeMaterial( {
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
		} );
		material.positionNode = drop.add( this.center ).add( positionLocal );
		material.colorNode = this.light;
		material.opacityNode = edge.mul( near ).mul( OPACITY );
		this.mesh = new THREE.LineSegments( geometry, material );
		this.mesh.name = 'rain';
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = RAIN_RENDER_ORDER;

	}

	/**
	 * @param camera the eye the field surrounds
	 * @param cover { indoors, covered }: indoors no rain shows; under a canopy or
	 *   an overhang none falls near the eye, while the open street keeps its rain
	 * @param air { color, lux } the light around the eye, as the fog reads it
	 * @param delta seconds since the last frame; a held world holds its rain
	 */
	update( camera, { indoors = false, covered = false }, air, delta ) {

		this.mesh.visible = ! indoors;
		this.dry.value = covered ? COVER : 0;
		this.center.value.set( camera.position.x, camera.position.y + LIFT, camera.position.z );
		this.fallen.value = ( this.fallen.value + FALL * delta ) % SIZE.y;
		if ( indoors ) {

			// A room's own light says nothing about the street's; the rain takes the street's again at the door.
			this.#shown = false;
			return;

		}
		const hue = luminance( air.color );
		_target.copy( COOL );
		if ( hue > 0 ) _target.lerp( _tint.copy( air.color ).multiplyScalar( 1 / hue ), TINT );
		_target.multiplyScalar( ( RAIN_LIGHT.base + RAIN_LIGHT.perRootLux * Math.sqrt( Math.max( 0, air.lux ) ) ) / luminance( _target ) );
		this.light.value.lerp( _target, this.#shown ? 1 - Math.exp( - delta / RAIN_LIGHT.ease ) : 1 );
		this.#shown = true;

	}

}

const _tint = new THREE.Color();
const _target = new THREE.Color();

/** The remainder that keeps the divisor's sign, as the shader's mod does. */
function floorMod( value, size ) {

	return value - size * Math.floor( value / size );

}

function random( index ) {

	let hash = Math.imul( index + 1, 0x45d9f3b );
	hash = Math.imul( hash ^ hash >>> 16, 0x45d9f3b );
	return ( ( hash ^ hash >>> 16 ) >>> 0 ) / 4294967296;

}
