import * as THREE from 'three/webgpu';

/**
 * Where the camera is standing, in stops relative to the base exposure. The
 * lights are in real photometric units, so relative brightness is already
 * correct everywhere; a room and the street outside it are graded the same,
 * and what the room's own fixtures do to it is the whole difference the eye
 * sees on walking in. The day cycle moves the stops with the sun.
 *
 * Indoors it moves them only so far: a room is lit by its own fixtures at
 * noon as at midnight, and the eye that walks in out of the sun opens back up
 * to them. What the day still takes off is the daylight a window lets in and
 * an eye never fully adapted to the dimmer room, `daylight` stops at most;
 * graded at the street's full day exposure a lit room is black.
 *
 * The environment probe is baked from the street, and every surface takes
 * its share of it, a room's walls included: by day that is the daylit city
 * as if no wall stood between. So whatever the eye opens up past the street's
 * grade, the environment is turned down by (`environment`): the probe reads at
 * the street's exposure wherever the camera stands, and only the light a room
 * makes itself gains what the open eye gives it.
 */
const VOLUMES = {
	exterior: { stops: 0, daylight: - Infinity },
	interior: { stops: 0, daylight: - 1.5 }
};
/** Eye adaptation, in seconds, for the whole cross-fade. */
const ADAPT = 0.6;
/** Seconds after a cut during which the eye follows the volume at once. */
const SETTLE = 0.5;

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
		this.volume = VOLUMES.exterior;
		this.daylight = 0;
		/** What carries the environment's weight, the scene (`environmentIntensity`), once there is one. */
		this.environment = null;

		renderer.toneMapping = THREE.AgXToneMapping;
		renderer.toneMappingExposure = base;

	}

	/** @param volume one of VOLUMES */
	enter( volume ) {

		this.volume = VOLUMES[ volume ] ?? VOLUMES.exterior;

	}

	/**
	 * @param stops the hour's own offset (time/DayCycle.js). It moves with the
	 * sun rather than adapting, so it is followed exactly and the eye's own
	 * adaptation is left to model the doorway.
	 */
	setDaylight( stops ) {

		// The first hour a run is lit at is where its eye starts: a city opened by
		// day is not adapted up from night, which a held world would never finish.
		const first = ! this.lit;
		this.lit = true;
		this.daylight = stops;
		if ( first ) {
			this.stops = this.#target();
			this.#apply();
		}

	}

	/**
	 * The eye arrives where it would settle, as after a cut rather than a walk,
	 * for this long: long enough for the rooms in view to say which volume the
	 * camera was put in (RoomView sorts them every 0.2 s).
	 */
	settle( seconds = SETTLE ) {

		this.settling = seconds;

	}

	/** The stops the eye settles at in the volume it stands in, at this hour. */
	#target() {

		return this.volume.stops + Math.max( this.volume.daylight, this.daylight );

	}

	update( delta ) {

		const target = this.#target();
		const step = this.settling > 0 ? Infinity : delta / ADAPT;
		this.settling = Math.max( 0, ( this.settling ?? 0 ) - delta );
		const gap = target - this.stops;

		if ( gap !== 0 ) this.stops = Math.abs( gap ) <= step ? target : this.stops + Math.sign( gap ) * step;

		this.#apply();

	}

	#apply() {

		this.renderer.toneMappingExposure = this.base * Math.pow( 2, this.stops );
		// The probe at the street's own grade: down by what the eye opened past it.
		if ( this.environment ) this.environment.environmentIntensity = Math.min( 1, Math.pow( 2, this.daylight - this.stops ) );

	}

}
