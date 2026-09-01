import * as THREE from 'three/webgpu';

/**
 * The sun's arc over the city. Noon puts it 52 degrees up and midnight 68
 * degrees under, so it rises around 07:30 and sets around 18:30, which is the
 * shape of a temperate year's average day.
 */
const NOON_ELEVATION = 60;
const AXIS_TILT = 8;
/** Civil twilight: below this the street needs its lamps, above it does not. */
const TWILIGHT = - 6;
const FULL_DAY = 2;

/**
 * Stops off the authored night exposure, per state. Night is what the whole
 * look was graded at (docs/RESEARCH-LIGHTING.md 9); the others come from the
 * real illuminance ratio, not from taste: a sunlit street is about a thousand
 * times a lamp-lit one, which is ten stops.
 */
const STOPS = { night: 0, dawn: - 4, day: - 8.5, dusk: - 4 };

/** Direct sun at the ground, in lux. */
export const SUN_LUX = 100000;
export const SUN_KELVIN = 5600;
/** Sky luminance at midday in the cd/m2 every other surface is measured in. */
export const DAY_SKY_LUMINANCE = 9000;

/**
 * What time of day it is, as everything downstream needs it.
 *
 * One function, so the sky, the key light, the exposure and every lamp in the
 * city agree about whether it is dark. `daylight` is the single number they all
 * read: 0 through the night, 1 in full day, crossing over civil twilight. The
 * lamps are simply its inverse, which is what a real photocell does.
 */
export function dayCycle( hour ) {

	const elevation = NOON_ELEVATION * Math.cos( ( hour - 13 ) / 12 * Math.PI ) - AXIS_TILT;
	const daylight = THREE.MathUtils.smoothstep( elevation, TWILIGHT, FULL_DAY );
	const rising = hour < 13;

	return {
		hour,
		elevation,
		azimuth: 200 + hour * 4,
		daylight,
		lampsOn: 1 - daylight,
		state: elevation < TWILIGHT ? 'night'
			: elevation > FULL_DAY ? 'day'
				: rising ? 'dawn' : 'dusk',
		sunLux: daylight * SUN_LUX,
		skyLuminance: daylight * DAY_SKY_LUMINANCE
	};

}

/** The exposure offset in stops for a state, relative to the authored night. */
export function stopsFor( state ) {

	return STOPS[ state ] ?? 0;

}
