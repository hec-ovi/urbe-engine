import * as THREE from 'three/webgpu';
import { color, uniform, vec3 } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { luminance, kelvinColor } from '../light/Color.js';
import { dayCycle, SUN_KELVIN } from '../time/DayCycle.js';

const SKY_SCALE = 45000;
/** The colour the air takes where no fixture reaches it: moonlit, cold. */
export const SKY_COLOR = 0x0b141d;
const STAR_COUNT = 2200;
const STAR_COLOR = 0xdfe8ff;
/** Stars are point sources: they sit above the frame's exposure or they vanish. */
const STAR_LEVEL = 6;
/** Radiance of the lit air over the city, in the cd/m2 everything else is in. */
const SKYGLOW = 0.32;
/** Full moon at ground level, in lux. The one honest number for a night key. */
const MOON_LUX = 0.25;
const MOON_COLOR = 0x8fb4ff;
const MOON = new THREE.Color( MOON_COLOR );

/**
 * The sky over the city at any hour: the TSL sky driven by the real sun arc, a
 * key light that crosses from a cold moon at the illuminance a full moon gives
 * to direct sun at 100000 lux, and a star field that fades out at twilight.
 *
 * The analytic sky returns radiance in its own scale, so it is scaled onto the
 * cd/m2 the rest of the world is measured in: the authored night skyglow, which
 * is what stops a window being a hole cut out of a night frame, up to real
 * daytime sky luminance. That is what lets one exposure ladder cover both.
 *
 * There is no ambient light here and there will not be one. A flat fill is the
 * most recognisable artificial-lighting tell there is, and the references never
 * bottom out on a grey: what lifts their shadows is lit air and an environment
 * probe, both of which are distance- and view-dependent. Those live in the look
 * box; this only says what is in the sky.
 */
export class NightSky {

	constructor( scene ) {

		this.scene = scene;

	}

	/** @param hour 0..24, fractional. */
	build( hour ) {

		const sky = new SkyMesh();
		sky.scale.setScalar( SKY_SCALE );
		sky.turbidity.value = 7;
		sky.rayleigh.value = 0.6;
		sky.mieCoefficient.value = 0.02;
		sky.mieDirectionalG.value = 0.86;
		sky.cloudCoverage.value = 0.72;
		sky.cloudDensity.value = 0.55;
		sky.cloudScale.value = 0.00035;
		sky.cloudSpeed.value = 0.00004;
		sky.showSunDisc.value = 0;
		// The sky is the far field itself, not something seen through the air.
		sky.material.fog = false;
		// With the sun under the horizon the analytic sky returns almost
		// nothing, and a night sky is never black: a city throws enough light
		// back off the air to be the brightest thing above the roofline.
		// Without this every window in the city is a hole cut out of the frame.
		this.glow = uniform( skyglow() );
		this.scale = uniform( 1 );
		sky.material.colorNode = sky.material.colorNode.mul( this.scale ).add( this.glow );
		this.sky = sky;
		this.scene.add( sky );

		// One key light, crossing from the moon to the sun as the sun rises:
		// two directional lights in one sky would cast two shadows.
		this.key = new THREE.DirectionalLight( MOON_COLOR, MOON_LUX );
		this.scene.add( this.key );

		this.stars = buildStars();
		this.scene.add( this.stars );

		this.setHour( hour );

		return this;

	}

	/** Sun elevation drives the sky, the key light and the star opacity. */
	setHour( hour ) {

		const day = dayCycle( hour );
		const phi = THREE.MathUtils.degToRad( 90 - day.elevation );
		const theta = THREE.MathUtils.degToRad( day.azimuth );

		const sun = new THREE.Vector3().setFromSphericalCoords( 1, phi, theta );
		this.sky.sunPosition.value.copy( sun );
		this.sky.showSunDisc.value = day.daylight > 0.5 ? 1 : 0;
		this.scale.value = 1 + day.skyLuminance;

		// Above the horizon the key is the sun and stands where it does; below
		// it, it is the moon, opposite the sun.
		this.key.position.copy( sun ).multiplyScalar( day.daylight > 0 ? 400 : - 400 );
		this.key.intensity = Math.max( MOON_LUX, day.sunLux );
		this.key.color.copy( day.daylight > 0 ? kelvinColor( SUN_KELVIN ) : MOON );

		this.stars.material.opacity = THREE.MathUtils.clamp( - day.elevation / 8, 0, 0.9 );
		this.stars.visible = this.stars.material.opacity > 0;
		this.hour = hour;
		this.day = day;

		return day;

	}

}

/** The sky colour at the radiance the air over the city actually has. */
function skyglow() {

	const glow = new THREE.Color( SKY_COLOR );

	return glow.multiplyScalar( SKYGLOW / Math.max( 1e-4, luminance( glow ) ) );

}

function buildStars() {

	const positions = new Float32Array( STAR_COUNT * 3 );

	for ( let i = 0; i < STAR_COUNT; i ++ ) {

		const v = new THREE.Vector3().randomDirection().multiplyScalar( 9000 );
		positions[ i * 3 ] = v.x;
		positions[ i * 3 + 1 ] = Math.abs( v.y );
		positions[ i * 3 + 2 ] = v.z;

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );

	const material = new THREE.PointsNodeMaterial( {
		size: 2,
		sizeAttenuation: false,
		transparent: true,
		opacity: 0.8,
		depthWrite: false,
		fog: false
	} );
	material.colorNode = vec3( 0 );
	material.emissiveNode = color( STAR_COLOR ).mul( STAR_LEVEL );

	const points = new THREE.Points( geometry, material );
	points.frustumCulled = false;
	points.name = 'stars';

	return points;

}
