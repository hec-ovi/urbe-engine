import * as THREE from 'three/webgpu';
import { CLIP } from '../agents/CharacterAssets.js';

const TALK_RANGE = 2.5;
const DOOR_RANGE = 3.2;
const DOOR_SPEED = 2.2;
const DOOR_ANGLE = ( 100 * Math.PI ) / 180;

/**
 * What pressing E does, and what the prompt says before you press it. Two
 * things are reachable: the nearest person within talking distance, and the
 * entrance you are standing in front of. Talking freezes that one NPC through
 * the simulation's interrupt and hands back its full identity and routine;
 * the door just swings, because the interior is already there.
 */
export class Interactor {

	constructor( { crowd, doors, sim, controller } ) {

		this.crowd = crowd;
		this.doors = doors;
		this.sim = sim;
		this.controller = controller;
		this.target = null;
		this.conversation = null;
		this.onConversation = null;

	}

	/** @returns the prompt string, or null. */
	update( delta ) {

		for ( const door of this.doors ) this.#swing( door, delta );

		if ( this.conversation ) return null;

		const feet = this.controller.body.feet;
		const forward = this.controller.forward;

		const person = this.crowd.nearest( feet, TALK_RANGE );
		const door = this.#doorInFront( feet, forward );

		if ( person ) {

			this.target = { kind: 'npc', person };

			return `E  talk to the ${person.type.replace( /_/g, ' ' )}`;

		}

		if ( door ) {

			this.target = { kind: 'door', door };

			return door.open > 0.5 ? `E  close the door` : `E  open the door`;

		}

		this.target = null;

		return null;

	}

	/** Called on a real E press. */
	activate( clock ) {

		if ( ! this.target ) return;

		if ( this.target.kind === 'door' ) {

			this.target.door.wanted = this.target.door.wanted > 0.5 ? 0 : 1;

			return;

		}

		this.#talk( this.target.person, clock );

	}

	close( clock ) {

		if ( ! this.conversation ) return;

		const { person, npcId } = this.conversation;
		this.sim.resume( npcId, clock.timeMin );
		person.frozen = false;
		person.clip = CLIP.WALK;
		this.conversation = null;
		this.onConversation?.( null );

	}

	#talk( person, clock ) {

		const timeMin = clock.timeMin;

		if ( ! person.npcId ) {

			const instance = this.sim.instantiate( person.crowdId, timeMin );

			if ( ! instance ) return;

			person.npcId = instance.npcId;
			person.instance = instance;

		}

		this.sim.interrupt( person.npcId, timeMin );
		person.frozen = true;
		person.clip = CLIP.TALK;
		person.heading = Math.atan2(
			this.controller.body.feet.x - person.position.x,
			this.controller.body.feet.z - person.position.z
		);

		this.conversation = {
			person,
			npcId: person.npcId,
			instance: person.instance,
			behavior: this.sim.behaviorAt( person.npcId, timeMin )
		};

		this.onConversation?.( this.conversation );

	}

	#doorInFront( feet, forward ) {

		let best = null;
		let bestScore = Infinity;

		for ( const door of this.doors ) {

			const distance = door.center.distanceTo( feet );

			if ( distance > DOOR_RANGE ) continue;

			const toDoor = TMP.copy( door.center ).sub( feet ).setY( 0 ).normalize();

			if ( toDoor.dot( forward ) < 0.35 ) continue;

			if ( distance < bestScore ) {

				bestScore = distance;
				best = door;

			}

		}

		return best;

	}

	#swing( door, delta ) {

		const wanted = door.wanted ?? 0;

		if ( door.open === wanted ) return;

		const step = DOOR_SPEED * delta;
		door.open = wanted > door.open
			? Math.min( wanted, door.open + step )
			: Math.max( wanted, door.open - step );

		door.pivot.rotation.y = door.open * DOOR_ANGLE;

	}

}

const TMP = new THREE.Vector3();
