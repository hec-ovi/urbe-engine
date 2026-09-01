import * as THREE from 'three/webgpu';
import { CLIP } from '../agents/CharacterAssets.js';

const TALK_RANGE = 2.5;
const DOOR_RANGE = 3.2;
const DOOR_SPEED = 2.2;
const DOOR_ANGLE = ( 100 * Math.PI ) / 180;
/** Roughly 40 degrees off the crosshair: past that you are not aiming at it. */
const MIN_AIM = 0.76;
/**
 * Two targets this close together in the frame are one ambiguous aim, and the
 * door wins it: a person you meant to talk to can be looked at squarely, but a
 * doorway with somebody standing in it cannot be aimed at any other way.
 */
const TIE = 0.05;
/** A person is aimed at around the chest, not at their feet. */
const CHEST = 1.3;
/** And a door around the handle, not at the sill. */
const HANDLE = 1.1;

/**
 * What pressing E does, and what the prompt says before you press it.
 *
 * The target is whatever the crosshair is actually pointing at: every door and
 * every person in reach is scored by how far off the centre of the screen it
 * sits, and the closest to the middle wins. Distance only decides who is in
 * reach at all, which is what stops a person standing near a doorway from
 * making the door unopenable. An aim too close to call goes to the door.
 *
 * Talking freezes that one NPC through the simulation's interrupt and hands
 * back its full identity and routine; the door just swings, because the
 * interior is already there.
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

		this.target = pick(
			this.controller.eye,
			this.controller.look,
			this.doors.filter( ( door ) => door.center.distanceTo( this.controller.body.feet ) <= DOOR_RANGE ),
			this.crowd.within( this.controller.body.feet, TALK_RANGE )
		);

		return this.target ? prompt( this.target ) : null;

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

		if ( npcId ) this.sim.resume( npcId, clock.timeMin );

		person.frozen = false;
		person.clip = CLIP.WALK;
		this.conversation = null;
		this.onConversation?.( null );

	}

	#talk( person, clock ) {

		const timeMin = clock.timeMin;

		if ( ! person.npcId ) {

			// A street handle only answers for the epoch it was sampled in and
			// people walk the pavement long after that, so a refusal means
			// asking the crowd who the simulation has out there now.
			let handle = person.crowdId;
			let instance = this.sim.instantiate( handle, timeMin );

			if ( ! instance ) {

				handle = this.crowd.handleFor( person, timeMin );
				instance = handle ? this.sim.instantiate( handle, timeMin ) : null;

			}

			if ( instance ) {

				person.crowdId = handle;
				person.npcId = instance.npcId;
				person.instance = instance;

			}

		}

		if ( person.npcId ) this.sim.interrupt( person.npcId, timeMin );

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
			behavior: person.npcId ? this.sim.behaviorAt( person.npcId, timeMin ) : null
		};

		this.onConversation?.( this.conversation );

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

/**
 * The target the crosshair is on, out of the doors and people already known to
 * be in reach. Pure so the tie rule can be tested without a world around it.
 *
 * @param eye the camera position, @param look the unit crosshair ray
 * @returns { kind: 'door'|'npc', door?, person?, aim } or null
 */
export function pick( eye, look, doors, people ) {

	const candidates = [];

	for ( const door of doors ) {

		candidates.push( { kind: 'door', door, aim: aimAt( eye, look, door.center, HANDLE ) } );

	}

	for ( const person of people ) {

		candidates.push( { kind: 'npc', person, aim: aimAt( eye, look, person.position, CHEST ) } );

	}

	let best = null;

	for ( const candidate of candidates ) {

		if ( candidate.aim < MIN_AIM ) continue;

		if ( ! best || candidate.aim > best.aim ) best = candidate;

	}

	if ( ! best ) return null;

	// An aim too close to call goes to the door.
	const door = candidates.find( ( c ) => c.kind === 'door' && c.aim > best.aim - TIE );

	return door ?? best;

}

/** How centred a point is in the frame: the cosine off the crosshair ray. */
function aimAt( eye, look, position, rise ) {

	return TMP.copy( position ).setY( position.y + rise ).sub( eye ).normalize().dot( look );

}

/** What the prompt says, always naming the thing it will act on. */
function prompt( target ) {

	if ( target.kind === 'door' ) {

		const name = target.door.name;

		return `E  ${target.door.open > 0.5 ? 'close' : 'open'} the door${name ? ` to ${name}` : ''}`;

	}

	const given = target.person.instance?.name?.given;

	return `E  talk to ${given ?? `the ${target.person.type.replace( /_/g, ' ' )}`}`;

}

const TMP = new THREE.Vector3();
