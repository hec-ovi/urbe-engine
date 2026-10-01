import * as THREE from 'three/webgpu';
import { personLook } from '../agents/Crowd.js';
import { PLAYER_CLIP_NAMES } from '../agents/CharacterCatalog.js';

/** Where in the idle clip a portrait holds the person: settled, arms down. */
const POSE_AT = 0.3;
/** Head and shoulders: the lens, how far off the head bone, how far below it the frame centres, the turn and the rise. */
const LENS = { fov: 24, distance: 1.5, drop: 0, turn: 0.42, rise: 0.08 };

/**
 * A person's own face: their avatar, dressed from their recipe the way the
 * focused rig is (CharacterPoser), held in an idle pose and pictured head and
 * shoulders in a three-quarter view under a soft key, a cool fill and a rim,
 * over a neutral dark backdrop (Snapshots). Each recipe is pictured once and
 * kept, so the codex, and later contacts and calls, all show the same image.
 *
 * `portrait( { npcId } | { recipe } )` resolves with the picture's URL, or
 * null when the person cannot be dressed.
 */
export class Portraits {

	/**
	 * @param snapshots the Snapshots that draws it
	 * @param poser the CharacterPoser the focused rig shares
	 * @param sim the simulation port, for `getNPC`
	 */
	constructor( { snapshots, poser, sim = null } ) {

		this.snapshots = snapshots;
		this.poser = poser;
		this.sim = sim;
		this.cache = new Map();
		this.scene = new THREE.Scene();
		const key = new THREE.DirectionalLight( 0xffe9d2, 2.6 );
		key.position.set( - 1.6, 2.4, 2.2 );
		const rim = new THREE.DirectionalLight( 0x9fe8ff, 1.8 );
		rim.position.set( 1.8, 1.6, - 2.2 );
		this.scene.add( new THREE.HemisphereLight( 0xc8dcdc, 0x1a2224, 1.1 ), key, rim );
		this.camera = new THREE.PerspectiveCamera( LENS.fov, 1, 0.05, 20 );

	}

	portrait( subject ) {

		const recipe = subject?.recipe ?? this.#recipeOf( subject?.npcId );
		if ( ! recipe ) return Promise.resolve( null );
		const key = JSON.stringify( recipe );
		if ( ! this.cache.has( key ) ) this.cache.set( key, this.snapshots.take( () => this.#stage( recipe ) ) );
		return this.cache.get( key );

	}

	/** The recipe the crowd dresses this person in; null for somebody the city does not hold. */
	#recipeOf( npcId ) {

		if ( ! npcId || ! this.sim ) return null;
		let npc;
		try {

			npc = this.sim.getNPC( npcId );

		} catch {

			return null;

		}
		return npc ? personLook( npc, npcId ).recipe : null;

	}

	async #stage( recipe ) {

		const root = await this.poser.pose( recipe, PLAYER_CLIP_NAMES.IDLE, POSE_AT );
		this.scene.add( root );
		root.updateMatrixWorld( true );
		frameFace( this.camera, headOf( root ) );
		return {
			scene: this.scene,
			camera: this.camera,
			done: () => {

				root.removeFromParent();
				this.poser.release( root );

			}
		};

	}

}

/** The head bone's world position, else a standing person's head height. */
export function headOf( root ) {

	let head = null;
	root.traverse( ( node ) => { if ( ! head && node.isBone && node.name === 'Head' ) head = node; } );
	return head ? head.getWorldPosition( new THREE.Vector3() ) : new THREE.Vector3( 0, 1.62, 0 );

}

/** Aims the camera at the head and shoulders of a person facing +Z, from their front left, a little above. */
export function frameFace( camera, head ) {

	const target = head.clone().setY( head.y - LENS.drop );
	camera.position.set(
		target.x + Math.sin( LENS.turn ) * LENS.distance,
		target.y + LENS.rise,
		target.z + Math.cos( LENS.turn ) * LENS.distance
	);
	camera.lookAt( target );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();
	return target;

}
