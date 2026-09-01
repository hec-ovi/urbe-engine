import * as THREE from 'three/webgpu';

const NEAR = 1;
const FAR = 320;

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
 * At the lowest tier the bake is the sky only, once: cheap, and still enough
 * for glass to stop looking like painted cardboard.
 */
export class EnvironmentProbe {

	/**
	 * @param sky the SkyMesh, for the cheap bake
	 * @param tier quality descriptor (probeSize, probeInterval in metres)
	 */
	constructor( renderer, scene, sky, tier ) {

		this.renderer = renderer;
		this.scene = scene;
		this.sky = sky;
		this.size = tier.probeSize;
		this.interval = tier.probeInterval;
		this.at = null;
		this.target = null;

	}

	/** One bake. Never per frame: six cube faces plus a mip convolution. */
	bake( position ) {

		const pmrem = new THREE.PMREMGenerator( this.renderer );
		const previous = this.target;

		this.target = this.interval > 0
			? pmrem.fromScene( this.scene, 0, NEAR, FAR, { size: this.size, position } )
			: pmrem.fromScene( new THREE.Scene().add( this.sky.clone() ), 0, NEAR, 2000, { size: this.size } );

		this.scene.environment = this.target.texture;
		this.at = position.clone();

		pmrem.dispose();
		previous?.dispose();

	}

	update( position ) {

		if ( this.interval <= 0 || ! this.at ) return;

		if ( this.at.distanceTo( position ) > this.interval ) this.bake( position );

	}

}
