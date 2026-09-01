import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

const SKY_SCALE = 45000;
const FOG_COLOR = 0x0b141d;
const FOG_DENSITY = 0.0135;
const STAR_COUNT = 2200;

/**
 * Night over the city: the TSL sky with the sun dropped below the horizon,
 * exponential fog in the same colour so the skyline dissolves into haze, a
 * cold moon key, a star field, and the sky baked once into scene.environment
 * so wet asphalt and glass have something to reflect.
 */
export class NightSky {

	constructor( renderer, scene ) {

		this.renderer = renderer;
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
		this.sky = sky;
		this.scene.add( sky );

		this.scene.fog = new THREE.FogExp2( FOG_COLOR, FOG_DENSITY );
		this.scene.background = new THREE.Color( FOG_COLOR );

		this.moon = new THREE.DirectionalLight( 0x8fb4ff, 0.35 );
		this.scene.add( this.moon );

		this.ambient = new THREE.HemisphereLight( 0x2b3d55, 0x0a0c10, 0.55 );
		this.scene.add( this.ambient );

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

	/**
	 * One PMREM bake of the sky into scene.environment. Never per frame: it is
	 * a full cubemap render plus mip convolution.
	 */
	bakeEnvironment() {

		const pmrem = new THREE.PMREMGenerator( this.renderer );
		const target = pmrem.fromScene( new THREE.Scene().add( this.sky.clone() ), 0, 1, 2000 );
		this.scene.environment = target.texture;
		this.scene.environmentIntensity = 1.1;
		pmrem.dispose();

	}

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

	const points = new THREE.Points( geometry, new THREE.PointsMaterial( {
		color: 0xdfe8ff,
		size: 2,
		sizeAttenuation: false,
		transparent: true,
		opacity: 0.8,
		depthWrite: false,
		fog: false,
		toneMapped: false
	} ) );
	points.frustumCulled = false;
	points.name = 'stars';

	return points;

}
