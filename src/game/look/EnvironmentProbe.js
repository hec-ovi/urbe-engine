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
	constructor( renderer, scene, tier, hitches = null ) {

		this.renderer = renderer;
		this.hitches = hitches;
		this.scene = scene;
		this.size = tier.probeSize;
		this.interval = tier.probeInterval;
		this.at = null;
		this.target = null;
		this.last = - Infinity;
		this.pending = false;
		this.excluded = [];

	}

	/** One bake. Never per frame: six cube faces plus a mip convolution. */
	/**
	 * Groups left out of the six probe renders: what a rough wall reflects is
	 * the lit city around it, not the crowd, the cars or the furniture, and
	 * those are most of the draw calls a bake would otherwise submit.
	 */
	exclude( ...groups ) {

		this.excluded.push( ...groups );

	}

	bake( position, now = performance.now() ) {

		this.last = now;
		const t = performance.now();

		const pmrem = new THREE.PMREMGenerator( this.renderer );
		const previous = this.target;
		const shown = this.excluded.filter( ( group ) => group.visible );

		for ( const group of shown ) group.visible = false;

		this.target = pmrem.fromScene( this.scene, 0, NEAR, FAR, { size: this.size, position } );

		for ( const group of shown ) group.visible = true;


		this.scene.environment = this.target.texture;
		this.at = position.clone();

		pmrem.dispose();
		previous?.dispose();
		this.hitches?.note( 'probe bake', performance.now() - t );

	}

	/**
	 * @param crossed true when the player has just walked between the street
	 * and a room.
	 */
	update( position ) {

		if ( ! this.at ) return;

		if ( this.at.distanceTo( position ) > this.interval ) this.pending = true;

		if ( ! this.pending ) return;

		// A bake is six renders of the city in one frame, so it only happens
		// on the cooldown and never on a threshold: walking into a building
		// keeps the street's reflections until the next distance bake.
		const now = performance.now();

		if ( now - this.last < COOLDOWN ) return;

		this.pending = false;
		this.bake( position, now );

	}

}
