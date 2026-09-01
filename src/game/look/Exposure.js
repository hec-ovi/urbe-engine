import * as THREE from 'three/webgpu';

/**
 * Where the camera is standing, in stops relative to the base exposure. The
 * lights are in real photometric units, so relative brightness is already
 * correct everywhere and these only model the eye: stepping out of a lit room
 * into the street is a drop the player should feel.
 *
 * An interior keeps its offset at every hour: a lit room at noon is still
 * darker than the street outside it, by the same amount.
 */
const VOLUMES = {
	exterior: 0,
	interior: - 1.6
};

/** Eye adaptation, in seconds, for the whole cross-fade. */
const ADAPT = 0.6;

/**
 * AgX tone response plus one authored exposure.
 *
 * AgX is the operator that both shapes the darks and holds a saturated neon in
 * hue all the way up its shoulder, which is what the reference frames do: cyan
 * stays cyan until the last sliver of its core. Its fixed -12.47 to +4.03 EV
 * window makes exposure a pure translation along a curve whose shape never
 * changes, so one number moves the whole frame predictably.
 *
 * There is no auto-exposure and there will not be one: a sign filling the frame
 * must not dim the world.
 */
export class Exposure {

	/**
	 * @param renderer WebGPURenderer
	 * @param base absolute exposure for the exterior night volume
	 */
	constructor( renderer, base ) {

		this.renderer = renderer;
		this.base = base;
		this.stops = 0;
		this.volume = 0;
		this.daylight = 0;

		renderer.toneMapping = THREE.AgXToneMapping;
		renderer.toneMappingExposure = base;

	}

	/** @param volume one of VOLUMES */
	enter( volume ) {

		this.volume = VOLUMES[ volume ] ?? 0;

	}

	/**
	 * @param stops the hour's own offset (time/DayCycle.js). It moves with the
	 * sun rather than adapting, so it is followed exactly and the eye's own
	 * adaptation is left to model the doorway.
	 */
	setDaylight( stops ) {

		this.daylight = stops;

	}

	update( delta ) {

		const target = this.volume + this.daylight;
		const step = delta / ADAPT;
		const gap = target - this.stops;

		if ( gap !== 0 ) this.stops = Math.abs( gap ) <= step ? target : this.stops + Math.sign( gap ) * step;

		this.renderer.toneMappingExposure = this.base * Math.pow( 2, this.stops );

	}

}
