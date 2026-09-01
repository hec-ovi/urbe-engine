import * as THREE from 'three/webgpu';

const NEAR = 1;
const FAR = 320;
/** Milliseconds between bakes, whatever asks for one. */
const COOLDOWN = 2000;

/**
 * What the shiny things in the world reflect.
 *
 * Wet asphalt and glass carry the street's neon down the road as long smears,
 * and a probe baked from the sky alone has none of that in it. So the probe is
 * baked from the scene itself at the point the player is standing, and rebaked
 * once they have walked far enough for the neighbourhood to have changed. It
 * is also the second half of the shadow floor: an environment probe lifts the
 * darks the way air does, view-dependently, where a flat ambient reads as a
 * wash immediately.
 *
 * The bake is rate limited: however often the world asks for one, six cube
 * renders never land in consecutive frames.
 */
export class EnvironmentProbe {

	/** @param tier quality descriptor (probeSize, probeInterval in metres) */
	constructor( renderer, scene, tier ) {

		this.renderer = renderer;
		this.scene = scene;
		this.size = tier.probeSize;
		this.interval = tier.probeInterval;
		this.at = null;
		this.target = null;
		this.last = - Infinity;
		this.pending = false;

	}

	/** One bake. Never per frame: six cube faces plus a mip convolution. */
	bake( position, now = performance.now() ) {

		this.last = now;

		const pmrem = new THREE.PMREMGenerator( this.renderer );
		const previous = this.target;

		this.target = pmrem.fromScene( this.scene, 0, NEAR, FAR, { size: this.size, position } );


		this.scene.environment = this.target.texture;
		this.at = position.clone();

		pmrem.dispose();
		previous?.dispose();

	}

	/**
	 * @param moved true when the player has crossed between the street and a
	 * room, which changes what is around them completely and cannot wait for
	 * the distance threshold.
	 */
	update( position, moved = false ) {

		if ( ! this.at ) return;

		if ( moved || this.at.distanceTo( position ) > this.interval ) this.pending = true;

		if ( ! this.pending ) return;

		// However often the world asks, six cube renders never belong in
		// consecutive frames. A rebake that arrives too soon waits its turn
		// rather than being dropped.
		const now = performance.now();

		if ( now - this.last < COOLDOWN ) return;

		this.pending = false;
		this.bake( position, now );

	}

}
