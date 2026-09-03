import { uniform } from 'three/tsl';

/**
 * How much of the night's own light is on, 0 in full day and 1 after dusk.
 * Node materials that write their own emission (the lit window panes) multiply
 * by this, so one uniform switches the whole city with no shader rebuild.
 */
export const nightLevel = uniform( 1 );

/** Below this a lamp is off rather than very dim. */
const OFF = 0.02;

/**
 * The city's own lights going on and off with the day.
 *
 * A lamp lens, a venue sign and an ad screen are all emissive surfaces the
 * world built, and in daylight they read wrong: a sign that glows at noon is
 * the oldest tell in a day-night cycle. This holds every one of those materials
 * with the emission it was authored at and scales them together, and dims the
 * real lights the same way, so what the eye sees and what the BRDF gets never
 * disagree.
 *
 * These are tuned copies shared by every mesh of their key, and this class is
 * their only writer, which is what makes editing them in place safe.
 */
export class NightSwitch {

	constructor( lights ) {

		this.lights = lights;
		this.materials = [];
		this.level = 1;

	}

	/**
	 * Every emissive material in a subtree, at the emission it was built with.
	 * Taken off the built scene rather than handed over by each builder, so a
	 * new kind of lit surface joins the switch by being added to the world.
	 */
	addGroup( root ) {

		root.traverse( ( node ) => {

			for ( const material of materialsOf( node ) ) {

				if ( ! ( material?.emissiveIntensity > 0 ) || this.materials.some( ( m ) => m.material === material ) ) continue;

				this.materials.push( { material, base: material.emissiveIntensity } );

			}

		} );

		return this;

	}

	/** @param lampsOn 1 after dusk, 0 in full day (time/DayCycle.js) */
	set( lampsOn ) {

		if ( Math.abs( lampsOn - this.level ) < 1e-3 ) return;

		this.level = lampsOn;
		nightLevel.value = lampsOn;

		for ( const entry of this.materials ) entry.material.emissiveIntensity = entry.base * lampsOn;

		this.lights.setDim( lampsOn < OFF ? 0 : lampsOn );

	}

}

function materialsOf( node ) {

	if ( ! node.material ) return [];

	return Array.isArray( node.material ) ? node.material : [ node.material ];

}
