import * as THREE from 'three/webgpu';
import { color, uniform, vec3 } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { luminance } from '../light/Color.js';

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

/**
 * Night over the city: the TSL sky with the sun dropped below the horizon, a
 * cold moon key at the illuminance a full moon really gives, and a star field.
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
		// With the sun this far under the horizon the analytic sky returns
		// almost nothing, and a night sky is never black: a city throws enough
		// light back off the air to be the brightest thing above the roofline.
		// Without this every window in the city is a hole cut out of the frame.
		this.glow = uniform( skyglow() );
		sky.material.colorNode = sky.material.colorNode.add( this.glow );
		this.sky = sky;
		this.scene.add( sky );

		this.moon = new THREE.DirectionalLight( MOON_COLOR, MOON_LUX );
		this.scene.add( this.moon );

		this.stars = buildStars();
		this.scene.add( this.stars );

		this.setHour( hour );

		return this;

	}

	/** Sun elevation drives the sky, the key light and the star opacity. */
	setHour( hour ) {

		const elevation = - 14 + 10 * Math.cos( ( hour - 13 ) / 12 * Math.PI );
		const azimuth = 200 + hour * 4;
		const phi = THREE.MathUtils.degToRad( 90 - elevation );
		const theta = THREE.MathUtils.degToRad( azimuth );

		const sun = new THREE.Vector3().setFromSphericalCoords( 1, phi, theta );
		this.sky.sunPosition.value.copy( sun );
		this.moon.position.copy( sun ).negate().multiplyScalar( 400 );
		this.stars.material.opacity = THREE.MathUtils.clamp( - elevation / 8, 0, 0.9 );
		this.hour = hour;

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
