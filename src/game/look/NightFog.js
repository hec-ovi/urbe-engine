import * as THREE from 'three/webgpu';
import { fog, uniform, renderGroup, exponentialHeightFogFactor, densityFogFactor } from 'three/tsl';
import { luminance } from '../light/Color.js';

/** Where the street's haze thins out. Above it a tower stands clear of it. */
const HEIGHT = 80;
/**
 * Radiance of the night sky over a city, in the same cd/m2 the rest of the
 * scene is in: moonlight plus the skyglow a lit city throws back down, which
 * in a dense one is the larger of the two by far.
 */
const SKY_RADIANCE = 0.12;
/**
 * The fraction of the illuminance falling on the air that comes back to the
 * eye. Thin outdoor haze returns very little, which is why a lit street's air
 * sits well under the road it lights.
 */
const SCATTER = 0;
/**
 * What a room returns per lux of its fixtures' mean illuminance, in cd/m2.
 *
 * A room's medium is its own walls seen through its own air, so its far end
 * settles on their radiance rather than on the sky behind a slab. A surface
 * under illuminance E returns E p / pi, and interreflection carries E to
 * E / (1 - p), so the room's mean radiance is p / ((1 - p) pi) per lux. That
 * is taken at the dark end of interior reflectance, p = 0.25, so the air stays
 * under the surfaces it hides in every room rather than over them in the dark
 * ones, which is what turns a room past five metres into flat fog.
 */
const ROOM_RETURN = 0.1;
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
 * Height fog pools in the street and thins over the roofs. Enclosed rooms have
 * clear air by default: crossing a doorway fades the street medium away rather
 * than covering the room in its fixtures' colour. An explicit indoorDensity
 * can add a uniform medium where one is wanted. The transition uses uniforms,
 * so crossing the threshold never rebuilds a shader.
 */
export class NightFog {

	constructor( scene, { density, color, indoorDensity = 0 } ) {

		this.indoorDensity = indoorDensity;

		this.sky = new THREE.Color( color );
		this.sky.multiplyScalar( SKY_RADIANCE / Math.max( 1e-4, luminance( this.sky ) ) );

		// Fog belongs to the scene pass, not each material's object buffer.
		// Static standard meshes can share an unchanged-material observer, so
		// only the first would refresh an object-local fog buffer after a door
		// crossing. A shared render group keeps every facade on the same air.
		this.color = uniform( this.sky.clone() ).setGroup( renderGroup );
		this.density = uniform( density ).setGroup( renderGroup );
		this.height = uniform( HEIGHT ).setGroup( renderGroup );
		this.base = uniform( 0 ).setGroup( renderGroup );
		this.outdoor = uniform( 1 ).setGroup( renderGroup );
		this.indoor = 0;

		const outside = exponentialHeightFogFactor( this.density, this.height ).mul( this.outdoor );
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
		this.outdoor.value = 1 - this.indoor;

		// Clear interiors must not retint the fading street medium with room
		// light: doing so briefly fills the doorway with a bright veil.
		const roomShare = this.indoorDensity > 0 ? this.indoor : 0;
		const lit = air.lux * ( indoor ? ROOM_RETURN * roomShare : SCATTER );
		const hue = luminance( air.color );
		const floor = 1 - roomShare;

		this.color.value.setRGB(
			this.sky.r * floor + ( hue > 0 ? air.color.r / hue * lit : 0 ),
			this.sky.g * floor + ( hue > 0 ? air.color.g / hue * lit : 0 ),
			this.sky.b * floor + ( hue > 0 ? air.color.b / hue * lit : 0 ),
			THREE.LinearSRGBColorSpace
		);

	}

}
