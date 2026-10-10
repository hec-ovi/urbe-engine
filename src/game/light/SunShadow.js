import * as THREE from 'three/webgpu';
import { getShadowMaterial } from 'three/tsl';

/** How deep the map reaches along the light, either side of the ground it is fitted to, in metres. */
const DEPTH = 600;
/** The share of the fitted square that lies ahead of the camera rather than behind it. */
const AHEAD = 0.3;
/** Metres a receiver is pulled towards the sun before it tests the map. */
const BIAS = 0.05;
/** Daylight below which the sun casts nothing worth a map: the key is the moon by then. */
const DUSK = 0.02;
const UP = new THREE.Vector3( 0, 1, 0 );

/**
 * The sun's shadows: the key light's one map, fitted to the ground the camera
 * looks over and moved with it.
 *
 * A city at street level is all near ground: the kerb at the player's feet,
 * the facade across the road, the shadow a lamp post throws twenty metres on.
 * So one square map covers the tier's reach around a point a little ahead of
 * the camera, and follows the camera in whole texels, which keeps a standing
 * shadow's edge from crawling as the player walks. Past the square nothing is
 * shadowed, and by then the haze has the distance anyway.
 *
 * Whether the key casts is decided once for the run: `castShadow` is part of
 * every lit material's program, so turning it on at dawn would compile the
 * city again. At night the key is the moon and casts nothing: the map stops
 * rendering and its weight goes to zero, which is a uniform, and the frame
 * pays for the lookup alone. Between the two the shadow fades in with the
 * daylight, as the sky does.
 *
 * The map is drawn by its own pass, whose programs a warm-up has to build
 * as it builds the frame's: `pass()` is what it compiles a caster against.
 */
export class SunShadow {

	/** Before any material compiles: whether the renderer draws shadow maps at all this run. */
	static prepare( renderer, tier ) {

		if ( ! renderer.shadowMap ) return;
		renderer.shadowMap.enabled = ( tier.sunShadow ?? 0 ) > 0;
		// Five rotated taps a fragment: every lit surface pays for them all
		// day and all night, since the lookup is in its program for the run.
		renderer.shadowMap.type = THREE.PCFShadowMap;

	}

	/**
	 * @param key the sky's DirectionalLight (NightSky.key)
	 * @param tier { sunShadow: map size, 0 for none; sunShadowReach: metres the map spans }
	 */
	constructor( key, tier ) {

		this.key = key;
		this.size = tier.sunShadow ?? 0;
		this.reach = tier.sunShadowReach ?? 0;
		this.enabled = this.size > 0 && this.reach > 0;
		this.focus = new THREE.Vector3();
		this.weight = 0;
		/** Whether `focus` is a map that has already been drawn. */
		this.placed = false;
		this.direction = new THREE.Vector3();
		this.scratch = new THREE.Vector3();
		if ( ! this.enabled ) return;

		const { shadow } = key;
		key.castShadow = true;
		shadow.mapSize.setScalar( this.size );
		// Drawn when the day asks for it, never on its own.
		shadow.autoUpdate = false;
		shadow.needsUpdate = false;
		shadow.intensity = 0;
		// A texel is several centimetres across. The bias is in the map's depth,
		// which spans the whole 1200 m along the rays: five centimetres of it.
		// The normal offset, most of a texel, carries the rest off a facade lit
		// at a grazing sun.
		shadow.bias = - BIAS / ( DEPTH * 2 );
		shadow.radius = 2;
		shadow.normalBias = 0.6 * this.reach / this.size;
		// The light's shadow node is this one rather than one three makes on
		// the first build, so the pass a warm-up compiles against is reachable.
		this.node = new THREE.ShadowNode( key, shadow );
		shadow.shadowNode = this.node;
		const camera = shadow.camera;
		camera.left = camera.bottom = - this.reach / 2;
		camera.right = camera.top = this.reach / 2;
		camera.near = 1;
		camera.far = DEPTH * 2;
		camera.updateProjectionMatrix();

	}

	/**
	 * Fits the map to the camera and lights it with the day.
	 *
	 * @param camera the frame's camera
	 * @param direction unit vector towards the key light (NightSky.direction)
	 * @param daylight 0 at night, 1 in full day (time/DayCycle.js)
	 */
	update( camera, direction, daylight ) {

		if ( ! this.enabled ) return;

		const { shadow } = this.key;
		this.weight = daylight > DUSK ? THREE.MathUtils.smoothstep( daylight, DUSK, 0.5 ) : 0;
		shadow.intensity = this.weight;

		if ( this.weight <= 0 ) {

			shadow.needsUpdate = false;
			return;

		}

		// The map is a second draw of the near city. Standing still, and a look
		// that stays inside the same texel, have nothing new to draw: asking for
		// the pass anyway is a freeze on every quiet frame.
		const next = fit( this.scratch, camera, this.reach, this.size, direction );
		if ( this.placed && next.distanceToSquared( this.focus ) < 1e-8 && this.direction.distanceToSquared( direction ) < 1e-12 ) {

			shadow.needsUpdate = false;
			return;

		}

		this.placed = true;
		this.focus.copy( next );
		this.direction.copy( direction );
		this.key.target.position.copy( this.focus );
		this.key.position.copy( this.focus ).addScaledVector( direction, DEPTH );
		this.key.target.updateMatrixWorld();
		this.key.updateMatrixWorld();
		shadow.needsUpdate = true;

	}

	/**
	 * What a warm-up compiles a caster against: the pass's camera, the one
	 * material the pass draws every caster with, and a map to draw into. The
	 * light's own map is made with the first material that receives the
	 * shadow, so the warm-up draws into a stand-in made the way the shadow node
	 * makes its own (ShadowNode.setupRenderTarget): a graph does not depend on
	 * the target, and a pipeline only on its formats, so what the stand-in
	 * builds is what the real pass asks for.
	 */
	pass() {

		if ( ! this.enabled ) return null;

		this.standIn ??= standIn( this.key.shadow );

		return { camera: this.key.shadow.camera, target: this.standIn, material: getShadowMaterial( this.key ), shadow: this.key.shadow };

	}

}

/** A small target with the formats of a shadow node's own map. */
function standIn( shadow ) {

	const depthTexture = new THREE.DepthTexture( STAND_IN, STAND_IN );
	depthTexture.name = 'ShadowDepthTexture';
	depthTexture.compareFunction = THREE.LessEqualCompare;
	const target = new THREE.RenderTarget( STAND_IN, STAND_IN );
	target.texture.name = 'ShadowMap';
	target.texture.type = shadow.mapType;
	target.depthTexture = depthTexture;

	return target;

}

const STAND_IN = 16;
const _forward = new THREE.Vector3();
const _light = new THREE.Matrix4();
const _local = new THREE.Vector3();

/**
 * The centre of the map: on the ground a little ahead of the camera, snapped
 * to the map's own texel grid as the light sees it, so the shadow camera moves
 * in whole texels and a standing edge rasterizes the same every frame.
 */
export function fit( target, camera, reach, size, direction ) {

	camera.getWorldDirection( _forward );
	_forward.y = 0;
	if ( _forward.lengthSq() < 1e-6 ) _forward.set( 0, 0, - 1 );
	_forward.normalize();

	target.copy( camera.position ).addScaledVector( _forward, reach * AHEAD );
	target.y = 0;

	// The light's own axes: x and y across the map, z along the rays.
	_light.lookAt( direction, ZERO, Math.abs( direction.y ) > 0.999 ? _forward : UP );
	_local.copy( target ).applyMatrix4( _inverse.copy( _light ).transpose() );
	const texel = reach / size;
	_local.x = Math.round( _local.x / texel ) * texel;
	_local.y = Math.round( _local.y / texel ) * texel;

	return target.copy( _local ).applyMatrix4( _light );

}

const ZERO = new THREE.Vector3();
const _inverse = new THREE.Matrix4();
