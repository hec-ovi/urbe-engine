import { LightingSystem } from '../light/LightingSystem.js';
import { NightSky, SKY_COLOR } from '../sky/NightSky.js';
import { QualityTier } from './QualityTier.js';
import { Exposure } from './Exposure.js';
import { NightFog } from './NightFog.js';
import { EnvironmentProbe } from './EnvironmentProbe.js';
import { LookPipeline } from './LookPipeline.js';
import { LOOK } from './LookSettings.js';

/**
 * The whole night look, installed the same way wherever this world is drawn.
 *
 * Tone response, exposure, the lighting system, the sky and its key light, the
 * air, what the shiny things reflect and how the frame is composed are one
 * decision, not a list of settings: AgX at 0.024 only reads as a night over
 * lights authored in lumens and lux, and a metal only reads as metal with a
 * probe behind it. So they are installed together or not at all, and a preview
 * that wants the game's look asks for the look rather than copying its numbers.
 *
 * It installs in three steps because a played run builds its world between
 * them: the renderer's own grade first, the scene's sky and air once the scene
 * exists, the frame chain once the camera does. A path whose scene is whole
 * before the first frame calls `install` and gets all three.
 */
export class NightLook {

	/**
	 * The renderer's own grade: which tier this run pays for, which lighting
	 * system runs the fixtures, and the tone response every frame lands on.
	 *
	 * @param quality tier name, or nothing to follow the backend
	 * @param backend the actual backend, after `renderer.init()`
	 * @param bloom, haze the run's `off=` switches
	 */
	static begin( renderer, { quality = null, backend, exposure = LOOK.exposure, bloom = true, haze = true } = {} ) {

		const tier = QualityTier.describe( quality, backend );
		if ( ! bloom ) tier.bloom = { strength: 0, radius: 0 };
		if ( ! haze ) tier.haze = false;

		return new NightLook( renderer, tier, exposure );

	}

	constructor( renderer, tier, exposure ) {

		this.renderer = renderer;
		this.tier = tier;
		this.lighting = LightingSystem.install( renderer, tier );
		this.exposure = new Exposure( renderer, exposure );

	}

	/**
	 * The scene's own night: the sky and its key light at the authored hour,
	 * the air the city stands in, and the probe every reflection comes from.
	 *
	 * The probe is built, never baked here: who stands where is the caller's
	 * business, and so is which groups a bake leaves out (`probe.exclude`).
	 *
	 * @param fog { density, indoorDensity } per metre; a run with fog off passes zeros
	 */
	raise( scene, { hour = LOOK.hour, fog = {}, probe = true, hitches = null } = {} ) {

		this.scene = scene;
		this.sky = new NightSky( scene ).build( hour );
		this.fog = new NightFog( scene, {
			color: SKY_COLOR, density: fog.density ?? LOOK.fog, indoorDensity: fog.indoorDensity
		} );
		this.probe = probe && this.tier.probeSize > 0
			? new EnvironmentProbe( this.renderer, scene, this.tier, hitches )
			: null;

		return this;

	}

	/** How the frame is put together: the HDR scene pass, bloom, the output transform and dither. */
	compose( camera ) {

		this.camera = camera;
		this.pipeline = new LookPipeline( this.renderer, this.scene, camera, this.tier );

		return this;

	}

	/** One call for a path whose scene is whole before its first frame. */
	static install( renderer, scene, camera, options = {} ) {

		return NightLook.begin( renderer, options ).raise( scene, options ).compose( camera );

	}

	render() {

		this.pipeline.render();

	}

}
