import * as THREE from 'three/webgpu';
import { fog, uniform, exponentialHeightFogFactor, densityFogFactor } from 'three/tsl';
import { luminance } from '../light/Color.js';

/** Where the street's haze thins out. Above it a tower stands clear of it. */
const HEIGHT = 80;
/**
 * Radiance of the night sky over a city, in the same cd/m2 the rest of the
 * scene is in: moonlight plus the skyglow a lit city throws back down, which
 * in a dense one is the larger of the two by far.
 */
const SKY_RADIANCE = 0.32;
/**
 * The fraction of the illuminance falling on the air that comes back to the
 * eye. Thin outdoor haze returns very little, which is why a lit street's air
 * sits well under the road it lights.
 */
const SCATTER = 0.006;
/** A room's air is thick over metres where the street's is thin over blocks. */
const INDOOR_DENSITY = 0.12;
/** Seconds to cross from one medium to the other, walking through a door. */
const ADAPT = 0.6;

/**
 * The air the city stands in, and the reason its shadows are not black.
 *
 * Every reference frame bottoms out on a coloured floor, never on zero and
 * never on grey, and what fills it is lit air: the street reads cyan because
 * the neon lighting it is cyan, the bar warm because its tubes are. So the fog
 * colour is not an art choice here, it is read back from the fixtures around
 * the player, and it carries a radiance rather than a swatch: air on a lit
 * street is a real surface brightness in the same units as everything else, so
 * it lifts the darks by the right amount at any exposure.
 *
 * Two media in series. Height fog pools in the street and thins over the roofs,
 * which is what separates a skyline into planes; a thin uniform medium comes in
 * indoors, where a room is hazy over a few metres and a tower's twenty-fifth
 * floor is above the street's haze entirely. Colour and both densities are
 * uniforms, so tuning them never rebuilds a shader.
 */
export class NightFog {

	constructor( scene, { density, color, indoorDensity = INDOOR_DENSITY } ) {

		this.indoorDensity = indoorDensity;

		this.sky = new THREE.Color( color );
		this.sky.multiplyScalar( SKY_RADIANCE / Math.max( 1e-4, luminance( this.sky ) ) );

		this.color = uniform( this.sky.clone() );
		this.density = uniform( density );
		this.height = uniform( HEIGHT );
		this.base = uniform( 0 );
		this.scatter = uniform( SCATTER );
		this.indoor = 0;

		const outside = exponentialHeightFogFactor( this.density, this.height );
		const inside = densityFogFactor( this.base );

		// The environment probe bakes at street range, where the sky dome is
		// past the far plane, so the background is what stands in for the sky
		// glow in every reflection. It carries the same radiance as the air.
		scene.fogNode = fog( this.color, outside.oneMinus().mul( inside.oneMinus() ).oneMinus() );
		scene.background = this.sky.clone();
		this.scene = scene;

	}

	/**
	 * @param air { color, lux } the light filling the air where the player is
	 * @param indoor whether that air is a room's rather than the street's
	 */
	update( air, indoor, delta = 0 ) {

		const step = delta > 0 ? delta / ADAPT : 1;
		const target = indoor ? 1 : 0;

		this.indoor = Math.abs( target - this.indoor ) <= step
			? target
			: this.indoor + Math.sign( target - this.indoor ) * step;

		this.base.value = this.indoorDensity * this.indoor;

		const lit = this.scatter.value * air.lux;
		const hue = luminance( air.color );
		// Indoors the sky is behind a slab, so the air is the room's own light.
		const floor = 1 - this.indoor;

		this.color.value.setRGB(
			this.sky.r * floor + ( hue > 0 ? air.color.r / hue * lit : 0 ),
			this.sky.g * floor + ( hue > 0 ? air.color.g / hue * lit : 0 ),
			this.sky.b * floor + ( hue > 0 ? air.color.b / hue * lit : 0 ),
			THREE.LinearSRGBColorSpace
		);

	}

}
