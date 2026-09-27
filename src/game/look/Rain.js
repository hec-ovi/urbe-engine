import * as THREE from 'three/webgpu';
import { attribute, positionLocal, positionView, smoothstep, uniform, varying, vec3 } from 'three/tsl';
import { luminance } from '../light/Color.js';

/** Metres of rain kept around the eye: wide enough for a street, tall enough to fall past a first-floor window. */
export const RAIN_BOX = Object.freeze( { width: 36, height: 16 } );
/** How far above the eye the box is centred: what falls below the pavement is never seen. */
const LIFT = 4;
/** Terminal speed of a heavy raindrop, metres per second. */
export const FALL = 9;
/** One drop's streak over a 1/25 s exposure at that speed, slanted by a light wind. */
const STREAK = [ 0.03, - 0.36, 0.012 ];
/**
 * What a streak returns, in the scene's cd/m2. A drop is a small lens that
 * gathers the light around it, so it sits near black in a dark lane and shows
 * under a lamp: skyglow plus a share of each lux of street light it falls through.
 */
export const RAIN_LIGHT = Object.freeze( { base: 0.8, perLux: 0.25 } );
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
 * Falling streaks around the camera in one draw. Every drop keeps its place
 * in the world while the eye moves through the field: its position wraps into
 * the box centred on the eye, so walking passes drops by instead of carrying
 * them along. Drops fade near the eye, where a streak would cross the whole
 * view, and at the box's edge, where they wrap.
 */
export class Rain {

	constructor( count ) {

		const { width, height } = RAIN_BOX;
		const positions = new Float32Array( count * 6 );
		const origins = new Float32Array( count * 6 );
		for ( let index = 0; index < count; index ++ ) {

			const x = random( index * 3 ) * width;
			const y = random( index * 3 + 1 ) * height;
			const z = random( index * 3 + 2 ) * width;
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

		const size = vec3( width, height, width );
		const half = size.mul( 0.5 );
		const origin = attribute( 'rainOrigin', 'vec3' );
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
		this.fallen.value = ( this.fallen.value + FALL * delta ) % RAIN_BOX.height;
		const hue = luminance( air.color );
		const radiance = RAIN_LIGHT.base + RAIN_LIGHT.perLux * air.lux;
		this.light.value.copy( COOL );
		if ( hue > 0 ) this.light.value.lerp( _tint.copy( air.color ).multiplyScalar( 1 / hue ), TINT );
		this.light.value.multiplyScalar( radiance / luminance( this.light.value ) );

	}

}

const _tint = new THREE.Color();

function random( index ) {

	let hash = Math.imul( index + 1, 0x45d9f3b );
	hash = Math.imul( hash ^ hash >>> 16, 0x45d9f3b );
	return ( ( hash ^ hash >>> 16 ) >>> 0 ) / 4294967296;

}
