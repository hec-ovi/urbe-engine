import * as THREE from 'three/webgpu';
import { fog, uniform, exponentialHeightFogFactor } from 'three/tsl';

/** Where the haze thins out. Above it a tower stands clear of the street's air. */
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
 * Height fog rather than plain distance fog, because haze pools in the street
 * and thins over the roofs, which is what separates a skyline into planes.
 * Colour, density and height are uniforms, so tuning them never rebuilds a
 * shader.
 */
export class NightFog {

	constructor( scene, { density, color } ) {

		this.sky = new THREE.Color( color );
		this.sky.multiplyScalar( SKY_RADIANCE / Math.max( 1e-4, luminance( this.sky ) ) );

		this.color = uniform( this.sky.clone() );
		this.density = uniform( density );
		this.height = uniform( HEIGHT );
		this.scatter = uniform( SCATTER );

		// The environment probe bakes at street range, where the sky dome is
		// past the far plane, so the background is what stands in for the sky
		// glow in every reflection. It carries the same radiance as the air.
		scene.fogNode = fog( this.color, exponentialHeightFogFactor( this.density, this.height ) );
		scene.background = this.sky.clone();
		this.scene = scene;

	}

	/** @param air { color, lux } from CityLights.airColor */
	update( air ) {

		const lit = this.scatter.value * air.lux;
		const hue = luminance( air.color );

		this.color.value.setRGB(
			this.sky.r + ( hue > 0 ? air.color.r / hue * lit : 0 ),
			this.sky.g + ( hue > 0 ? air.color.g / hue * lit : 0 ),
			this.sky.b + ( hue > 0 ? air.color.b / hue * lit : 0 ),
			THREE.LinearSRGBColorSpace
		);

	}

}

function luminance( color ) {

	return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

}
