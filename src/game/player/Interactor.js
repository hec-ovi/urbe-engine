import * as THREE from 'three/webgpu';
import { CLIP } from '../agents/CharacterAssets.js';

const TALK_RANGE = 2.5;
const DOOR_RANGE = 3.2;
const DOOR_SPEED = 2.2;
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
 * back its full identity and routine; a door follows its authored movement.
 */
export class Interactor {

	constructor( { crowd, doors, sim, controller, elevators, quests, investigations = null, continuity = null, animations = null, doorColliders = null } ) {

		this.crowd = crowd;
		this.doors = doors;
		this.sim = sim;
		this.controller = controller;
		this.elevators = elevators;
		this.quests = quests;
		this.investigations = investigations;
		this.continuity = continuity;
		this.animations = animations;
		this.doorColliders = doorColliders;
		this.target = null;
		this.conversation = null;
		this.onConversation = null;

	}

	/** @returns the prompt string, or null. */
	update( delta, questState ) {

		for ( const door of this.doors ) this.#moveDoor( door, delta );

		if ( this.conversation ) {

			this.#facePlayer( this.conversation.person );
			return null;

		}

		const feet = this.controller.body.feet;

		this.target = pick(
			this.controller.eye,
			this.controller.look,
			this.doors.filter( ( door ) => door.center.distanceTo( feet ) <= DOOR_RANGE ),
			this.crowd.within( feet, TALK_RANGE ),
			this.elevators?.panels( feet, DOOR_RANGE ) ?? [],
			[ ...this.#candidates( 'quests', questState ), ...this.#candidates( 'investigations', questState ) ]
		);

		return this.target ? prompt( this.target, this.quests ) : null;

	}

	/**
	 * One authored source's targets this frame. A source that throws is
	 * reported once and put down for the session, so a bad frame from one of
	 * them never stops the game: the doors and the crowd still answer.
	 */
	#candidates( source, questState ) {

		const gameplay = this[ source ];
		if ( ! gameplay ) return [];

		try {

			return gameplay.candidates( questState ) ?? [];

		} catch ( error ) {

			this[ source ] = null;
			const details = Array.isArray( error?.details ) ? ` (${error.details.join( '; ' )})` : '';
			console.error( `${source} put down for this session: ${error?.message ?? error}${details}` );

			return [];

		}

	}

	/** Called on a real E press. */
	activate( clock, bindingAction = 'interact' ) {

		if ( ! this.target ) return;

		if ( this.target.kind === 'quest' ) {

			return this.quests.perform( {
				targetKey: this.target.interaction.targetKey,
				bindingAction,
				timeMin: clock.timeMin
			} );

		}
		if ( this.target.kind === 'investigation' ) {

			return this.investigations.perform( {
				targetKey: this.target.interaction.targetKey,
				bindingAction,
				timeMin: clock.timeMin
			} );

		}
		if ( bindingAction !== 'interact' ) return;

		if ( this.target.kind === 'door' ) {

			this.target.door.wanted = this.target.door.wanted > 0.5 ? 0 : 1;

			return;

		}

		if ( this.target.kind === 'elevator' ) {

			this.target.shaft.press( this.target );

			return;

		}

		this.#talk( this.target.person, clock );

	}

	close( clock, reason = 'player-left' ) {

		if ( ! this.conversation ) return;

		const conversation = this.conversation;
		const { npcId, controlled } = conversation;
		let { person } = conversation;
		let actor = null;

		person.talking = false;
		if ( npcId && controlled ) {

			// A person an open step is still about keeps the spot the player
			// found them in; everybody else walks back into their day.
			const hold = Boolean( this.quests?.holdsCast?.( npcId ) );
			try {

				actor = this.continuity.endConversation( { timeMin: clock.timeMin, ...( hold ? { hold } : {} ) } );
				person = this.crowd.syncActor( actor, this.controller.body.feet ) ?? person;

			} catch ( error ) {

				console.warn( `conversation with ${npcId} ended outside continuity: ${error?.message ?? error}` );
				this.sim.resume( npcId, clock.timeMin );
				person.frozen = false;
				person.clip = person.restClip ?? CLIP.WALK;

			}

		} else {

			if ( npcId ) this.sim.resume( npcId, clock.timeMin );
			person.frozen = false;
			person.clip = person.restClip ?? CLIP.WALK;

		}
		if ( reason === 'player-left' ) this.animations?.endConversation( conversation, actor );
		else this.animations?.endConversation( conversation, actor, reason );
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
				if ( this.crowd.identify ) person = this.crowd.identify( person, instance ) ?? person;
				else {

					person.npcId = instance.npcId;
					person.instance = instance;

				}

			}

		}

		let controlled = false;
		let controlledActor = null;
		const place = personPlace( person );
		if ( person.npcId && this.continuity && place ) {

			// Continuity can refuse: somebody else holds control, or this
			// identity is gone. One press is lost, never a thrown frame.
			try {

				controlledActor = this.continuity.beginConversation( {
					npcId: person.npcId,
					timeMin,
					position: person.position.toArray(),
					heading: seated( person ) ? person.heading : headingTo( this.controller.body.feet, person.position ),
					place,
					seated: person.clip === CLIP.SIT || person.clip === CLIP.SIT_TALK
				} );
				person = this.crowd.syncActor( controlledActor, this.controller.body.feet ) ?? person;
				controlled = true;

			} catch ( error ) {

				console.warn( `conversation with ${person.npcId} is not under continuity: ${error?.message ?? error}` );
				this.sim.interrupt( person.npcId, timeMin );

			}

		} else if ( person.npcId ) this.sim.interrupt( person.npcId, timeMin );

		person.frozen = true;
		person.talking = false;
		person.restClip = person.restClip ?? person.clip;
		person.clip = person.restClip;
		this.#facePlayer( person );

		const characterName = this.quests?.characterName?.( person.npcId );
		const scheduled = person.npcId ? this.sim.behaviorAt( person.npcId, timeMin ) : null;
		const actualPlace = controlledActor?.place ?? personPlace( person );
		const behavior = scheduled && actualPlace ? {
			mode: actualPlace.kind === 'parcel' ? 'interior' : actualPlace.kind === 'route' ? 'transit' : 'street',
			activity: [ 'working', 'shopping', 'leisure', 'home', 'commuting', 'transit_wait' ].includes( person.activity ) ? person.activity : 'leisure',
			place: actualPlace, interrupted: true
		} : scheduled;
		this.conversation = {
			person,
			npcId: person.npcId,
			controlled,
			// A presentation copy keeps the story's name coherent in the
			// prompt, profile and reply without renaming the simulation NPC.
			instance: characterName ? { ...person.instance, name: characterName } : person.instance,
			behavior
		};
		this.animations?.beginConversation( this.conversation, controlledActor );

		this.onConversation?.( this.conversation );

	}

	/** Standing speakers turn to the player; seated bodies keep their chair's pose. */
	#facePlayer( person ) {

		if ( ! person || seated( person ) ) return;
		person.heading = headingTo( this.controller.body.feet, person.position );

	}

	#moveDoor( door, delta ) {

		const wanted = door.wanted ?? 0;

		if ( door.open === wanted ) return;

		const step = DOOR_SPEED * delta;
		door.open = wanted > door.open
			? Math.min( wanted, door.open + step )
			: Math.max( wanted, door.open - step );

		door.motion.apply( door.pivots, door.open );
		this.doorColliders?.sync( door );

	}

}

function seated( person ) {

	return person.clip === CLIP.SIT || person.clip === CLIP.SIT_TALK
		|| person.restClip === CLIP.SIT || person.restClip === CLIP.SIT_TALK;

}

function headingTo( feet, position ) {

	return Math.atan2( feet.x - position.x, feet.z - position.z );

}

function personPlace( person ) {

	if ( person.parcelId ) return { kind: 'parcel', id: person.parcelId };
	if ( person.edge?.id ) return { kind: 'edge', id: person.edge.id };
	return null;

}

/**
 * The target the crosshair is on, out of the doors and people already known to
 * be in reach. Pure so the tie rule can be tested without a world around it.
 *
 * @param eye the camera position, @param look the unit crosshair ray
 * @returns { kind: 'door'|'npc', door?, person?, aim } or null
 */
export function pick( eye, look, doors, people, panels = [], questTargets = [] ) {

	const candidates = [];

	for ( const door of doors ) {

		candidates.push( { kind: 'door', door, aim: aimAt( eye, look, door.center, HANDLE ) } );

	}

	for ( const panel of panels ) {

		candidates.push( { ...panel, aim: aimAt( eye, look, panel.center, 0 ) } );

	}

	for ( const person of people ) {

		candidates.push( { kind: 'npc', person, aim: aimAt( eye, look, person.position, CHEST ) } );

	}

	for ( const target of questTargets ) candidates.push( target );

	let best = null;

	for ( const candidate of candidates ) {

		if ( candidate.aim < MIN_AIM ) continue;

		const samePersonAction = best?.kind === 'npc' &&
			[ 'quest', 'investigation' ].includes( candidate.kind ) && Math.abs( candidate.aim - best.aim ) < 1e-6;
		// Stealing from a person uses the same chest point as talking. On that
		// exact aim, offer the measured quest action rather than hiding it
		// forever behind generic talk. A distinct, better-aimed target still wins.
		if ( ! best || candidate.aim > best.aim || samePersonAction ) best = candidate;

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
function prompt( target, quests ) {

	if ( target.kind === 'quest' || target.kind === 'investigation' ) return target.interaction.prompt;
	if ( target.kind === 'elevator' ) return target.shaft.label( target );

	if ( target.kind === 'door' ) {

		const name = target.door.name;

		return `E  ${target.door.open > 0.5 ? 'close' : 'open'} the door${name ? ` to ${name}` : ''}`;

	}

	const given = quests?.characterName?.( target.person.npcId )?.given ?? target.person.instance?.name?.given;

	return `E  talk to ${given ?? `the ${target.person.type.replace( /_/g, ' ' )}`}`;

}

const TMP = new THREE.Vector3();
