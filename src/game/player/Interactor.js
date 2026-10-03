import * as THREE from 'three/webgpu';
import { CLIP } from '../agents/CharacterAssets.js';
import { LINGER_SECONDS } from '../agents/NpcContinuity.js';

const TALK_RANGE = 2.5;
const DOOR_RANGE = 3.2;
const DOOR_SPEED = 2.2;
/** Seconds a door stands open, after it opened or was last asked open, before it closes by itself. */
export const DOOR_CLOSE_AFTER = 5;
/** Somebody within this of a door's leaf span, at its level, stands in its doorway and keeps it open. */
const DOORWAY = 0.6;
const DOORWAY_HEIGHT = 2.2;
/** The width of a door that does not publish one. */
const DOOR_WIDTH = 1;
const NONE = Object.freeze( [] );
/** Roughly 40 degrees off the crosshair: past that you are not aiming at it. */
const MIN_AIM = 0.76;
/**
 * Two targets this close together in the frame are one ambiguous aim, and the
 * door wins it: a person you meant to talk to can be looked at squarely, but a
 * doorway with somebody standing in it cannot be aimed at any other way.
 */
const TIE = 0.05;
/** A person is aimed at around the chest, not at their feet. */
export const CHEST = 1.3;
/** And a door around the handle, not at the sill. */
const HANDLE = 1.1;
/** Where the view turns to on a person the host opens a conversation with. */
const FACE = 1.55;

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

	/**
	 * @param access optional locks and pockets: `lockOf(door, feet)` (PlayerAccess: null for a door
	 *   anyone opens, else `{ scope, place, locked }`), `lockedPrompt(lock)`, the line a locked
	 *   door shows, and `liftable(person)`, the R line for a person whose card the player could
	 *   lift, or null
	 */
	constructor( { crowd, doors, sim, controller, elevators, quests, investigations = null, continuity = null, animations = null, doorColliders = null, interiors = null, typeLabels = null, access = null } ) {

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
		this.interiors = interiors;
		this.access = access;
		/** The lock of the door aimed at this frame, `{ scope, place, locked }`, or null: the prompt's lock mark. */
		this.lock = null;
		/** Heard when E is pressed on a door locked to the player: `( door, lock )`. */
		this.onLocked = null;
		/** Heard when R is pressed on a person who carries a card: `( person, clock )`. */
		this.onLift = null;
		/** Each NPC type's readable label, which names a person the prompt has no given name for. */
		this.typeLabels = typeLabels ?? new Map();
		this.target = null;
		this.conversation = null;
		this.onConversation = null;
		/** The doors in reach this frame, gathered into one array kept for every frame. */
		this.reach = [];
		/** Seconds this Interactor has run, the clock doors close by. */
		this.seconds = 0;

	}

	/** @returns the prompt string, or null. */
	update( delta, questState ) {

		// The apartment doors of the floors shown now run beside the street doors.
		const apartments = this.interiors?.apartmentDoors?.doors ?? NONE;
		this.seconds += delta;
		for ( const door of this.doors ) this.#moveDoor( door, delta );
		for ( const door of apartments ) this.#moveDoor( door, delta );

		if ( this.conversation ) {

			if ( this.conversation.person ) this.#facePlayer( this.conversation.person );
			return null;

		}

		const feet = this.controller.body.feet;
		const reach = this.reach;
		reach.length = 0;
		for ( const door of this.doors ) if ( door.center.distanceTo( feet ) <= DOOR_RANGE ) reach.push( door );
		for ( const door of apartments ) if ( door.center.distanceTo( feet ) <= DOOR_RANGE ) reach.push( door );

		this.target = pick(
			this.controller.eye,
			this.controller.look,
			reach,
			this.crowd.within( feet, TALK_RANGE ),
			this.elevators?.panels( feet, DOOR_RANGE ) ?? [],
			[ ...this.#candidates( 'quests', questState ), ...this.#candidates( 'investigations', questState ) ]
		);
		this.lock = this.target?.kind === 'door' ? this.access?.lockOf( this.target.door, feet ) ?? null : null;

		// Page Up and Page Down choose a floor anywhere inside a car; E still
		// acts on the button under the crosshair.
		const cabin = this.elevators?.cabinAt?.( feet ) ?? null;
		if ( cabin && this.controller.input?.locked ) {

			if ( this.controller.input.consume( 'PageUp' ) ) cabin.select( 1 );
			if ( this.controller.input.consume( 'PageDown' ) ) cabin.select( - 1 );

		}
		return this.target ? prompt( this.target, this.quests, this.typeLabels, this.lock, this.access ) : null;

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
		if ( bindingAction === 'secondary-interact' && this.target.kind === 'npc' && this.access?.liftable?.( this.target.person ) ) {

			this.onLift?.( this.target.person, clock );
			return;

		}
		if ( bindingAction !== 'interact' ) return;

		if ( this.target.kind === 'door' ) {

			// A locked door stays shut and solid to a player without its card; closing is never locked.
			const lock = this.access?.lockOf( this.target.door, this.controller.body.feet ) ?? null;
			if ( ! ( this.target.door.wanted > 0.5 ) && lock?.locked ) {

				this.onLocked?.( this.target.door, lock );
				return;

			}
			this.target.door.wanted = this.target.door.wanted > 0.5 ? 0 : 1;
			if ( this.target.door.wanted ) {

				this.target.door.askedAt = this.seconds;

				this.target.door.loadingFloor = true;
				this.interiors?.requestFloor( this.target.door.parcelId, this.target.door.floor ?? 0 );

			}

			return;

		}

		if ( this.target.kind === 'elevator' ) {

			this.target.shaft.press( this.target );

			return;

		}

		this.#talk( this.target.person, clock );

	}

	/**
	 * Opens a conversation with the body this person has on the street now, as
	 * E on them would, without aiming: the host asks for it when a companion
	 * has led the player somewhere, and the view turns to the person's face.
	 * The conversation, or null when the person has no body in the crowd, is
	 * fallen or somebody is already talked to.
	 */
	talkTo( npcId, clock ) {

		const person = this.crowd.memberForNpc( npcId );
		if ( this.conversation || ! person || person.fallen || person.retiring ) return null;
		this.#talk( person, clock );
		const { position } = this.conversation?.person ?? {};
		if ( position ) this.controller.turnTo( position.clone().setY( position.y + FACE ) );
		return this.conversation;

	}

	/**
	 * A conversation over the phone: the person is wherever their day has
	 * them and nobody stops, turns or holds their body, which goes on with its
	 * day; `instance` and `behavior` are the person and what they are doing as
	 * the talk tells them. Null when somebody is already talked to.
	 */
	call( { npcId, instance, behavior } ) {

		if ( this.conversation ) return null;
		this.conversation = { person: null, npcId, controlled: false, instance, behavior, call: true };
		this.onConversation?.( this.conversation );
		return this.conversation;

	}

	/**
	 * Ends the conversation. A person an open quest step still names, or one
	 * the host `keep`s (somebody who agreed to come along), stays where the
	 * player found them; everybody else walks back into their day, the player
	 * leaving them standing turned to them for LINGER_SECONDS first.
	 */
	close( clock, reason = 'player-left', { keep = false } = {} ) {

		if ( ! this.conversation ) return;

		const conversation = this.conversation;
		if ( conversation.call ) {

			// Hanging up leaves the person to the day they never left.
			this.conversation = null;
			this.onConversation?.( null );
			return;

		}
		const { npcId, controlled } = conversation;
		let { person } = conversation;
		let actor = null;

		person.talking = false;
		if ( npcId && controlled ) {

			const hold = keep || Boolean( this.quests?.holdsCast?.( npcId ) );
			try {

				const linger = ! hold && reason === 'player-left' ? { linger: LINGER_SECONDS } : {};
				actor = this.continuity.endConversation( { timeMin: clock.exactMin ?? clock.timeMin, ...( hold ? { hold } : {} ), ...linger } );
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
		// Resolving a sampled handle can return an existing body across town.
		// The player chose this visible placement, before identity deduplication.
		const position = person.position.clone();
		const place = personPlace( person );
		const sitting = seated( person );
		const post = person.stationary && place?.kind === 'parcel' &&
			! [ 'following', 'leading', 'resuming', 'posing' ].includes( person.controlMode )
			? { heading: person.heading, ...( person.spot ? { spot: person.spot } : {} ) } : null;
		const placement = {
			heading: person.heading, parcelId: person.parcelId, edge: person.edge,
			place, stationary: person.stationary, distance: person.distance, direction: person.direction,
			offset: person.offset, clip: person.clip, restClip: person.restClip ?? person.clip,
			spot: person.spot, activity: person.activity
		};

		// A body with no handle, a stress copy or somebody retiring, is nobody
		// the simulation reports: the talk stays anonymous and gives it no
		// identity. Everybody else becomes the person the simulation has out
		// there, established in the look the player is looking at.
		if ( ! person.npcId && person.crowdId ) {

			// A street handle only answers for the epoch it was sampled in and
			// people walk the pavement long after that, so a refusal means
			// asking the crowd who the simulation has out there now.
			let handle = person.crowdId;
			let instance = this.sim.instantiate( handle, timeMin, person.appearanceSeed );

			if ( ! instance ) {

				handle = this.crowd.handleFor( person, timeMin );
				instance = handle ? this.sim.instantiate( handle, timeMin, person.appearanceSeed ) : null;

			}

			if ( instance ) {

				person.crowdId = handle;
				const canonical = this.crowd.identify( person, instance );
				if ( canonical !== person ) {

					// An alias cannot move an active escort or an explicitly
					// controlled body. The duplicate has still been retired.
					if ( protectedPlacement( canonical, this.continuity ) ) return;
					canonical.position.copy( position );
					Object.assign( canonical, placement );

				}
				person = canonical;

			}

		}

		let controlled = false;
		let controlledActor = null;
		if ( person.npcId && this.continuity && place ) {

			// Continuity can refuse: somebody else holds control, or this
			// identity is gone. One press is lost, never a thrown frame.
			try {

				controlledActor = this.continuity.beginConversation( {
					npcId: person.npcId,
					timeMin: clock.exactMin ?? timeMin,
					position: position.toArray(),
					heading: sitting ? placement.heading : headingTo( this.controller.body.feet, position ),
					place,
					...( post ? { post } : {} ),
					seated: sitting
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

		this.#closeByItself( door );
		const requested = door.wanted ?? 0;
		const ready = ! this.interiors?.pending.has( door.parcelId ) || this.interiors.floorShown( door.parcelId, door.floor ?? 0 );
		const wanted = ready ? requested : 0;
		if ( ready && door.loadingFloor ) { this.interiors?.releaseFloor( door.parcelId ); door.loadingFloor = false; }

		if ( door.open === wanted ) return;

		const step = DOOR_SPEED * delta;
		door.open = wanted > door.open
			? Math.min( wanted, door.open + step )
			: Math.max( wanted, door.open - step );

		door.motion.apply( door.pivots, door.open );
		this.doorColliders?.sync( door );

	}

	/**
	 * Every door closes by itself DOOR_CLOSE_AFTER seconds after it stood
	 * fully open or was last asked open (the player's E, or a walker asking
	 * it through `asked`), never on somebody standing in its doorway.
	 */
	#closeByItself( door ) {

		if ( door.asked ) {

			door.askedAt = this.seconds;
			door.asked = false;

		}
		if ( ! ( ( door.wanted ?? 0 ) > 0.5 ) ) {

			door.askedAt = undefined;
			door.openedAt = undefined;
			return;

		}
		door.askedAt ??= this.seconds;
		if ( door.open < 1 ) {

			door.openedAt = undefined;
			return;

		}
		door.openedAt ??= this.seconds;
		if ( this.seconds - Math.max( door.askedAt, door.openedAt ) < DOOR_CLOSE_AFTER ) return;
		if ( this.#inDoorway( door ) ) return;
		door.wanted = 0;

	}

	/** Whether the player or anybody in the crowd stands in a door's doorway. */
	#inDoorway( door ) {

		const reach = ( door.width ?? DOOR_WIDTH ) / 2 + DOORWAY;
		const stands = ( position ) => {

			const rise = position.y - door.center.y;
			return rise > - 0.5 && rise < DOORWAY_HEIGHT && Math.hypot( position.x - door.center.x, position.z - door.center.z ) <= reach;

		};
		if ( stands( this.controller.body.feet ) ) return true;
		return ( this.crowd?.within?.( door.center, reach + DOORWAY_HEIGHT ) ?? NONE ).some( ( member ) => stands( member.position ) );

	}

}

function protectedPlacement( person, continuity ) {

	return person.fallen || [ 'following', 'leading', 'posing', 'conversation' ].includes( person.controlMode ) ||
		( continuity?.follow?.npcId === person.npcId && [ 'following', 'leading' ].includes( continuity.follow.mode ) ) ||
		continuity?.pose?.npcId === person.npcId || continuity?.conversation?.npcId === person.npcId;

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

		const aim = aimAt( eye, look, panel.center, 0 );
		// A lift button is small, so it takes aiming at: the crosshair ray has to
		// pass within its radius, where the cone a door gets would pick a floor
		// button while looking straight at the lift doors.
		if ( panel.aimRadius && ! passesWithin( eye, panel.center, aim, panel.aimRadius ) ) continue;
		candidates.push( { ...panel, aim } );

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

/** Whether the crosshair ray, `aim` the cosine off it, passes within `radius` of a point ahead. */
function passesWithin( eye, position, aim, radius ) {

	return aim > 0 && eye.distanceToSquared( position ) * Math.max( 0, 1 - aim * aim ) <= radius * radius;

}

/** How centred a point is in the frame: the cosine off the crosshair ray. */
function aimAt( eye, look, position, rise ) {

	return TMP.copy( position ).setY( position.y + rise ).sub( eye ).normalize().dot( look );

}

/**
 * What the prompt says, always naming the thing it will act on: a door
 * locked to the player says what it needs instead, and a person carrying a
 * card the player could lift adds the R line.
 */
function prompt( target, quests, typeLabels = new Map(), lock = null, access = null ) {

	if ( target.kind === 'quest' || target.kind === 'investigation' ) return target.interaction.prompt;
	if ( target.kind === 'elevator' ) return target.shaft.label( target );

	if ( target.kind === 'door' ) {

		const open = target.door.open > 0.5 || target.door.wanted > 0.5;
		if ( lock?.locked && ! open ) return access?.lockedPrompt?.( lock ) ?? `Locked: ${lock.place} needs an access card`;
		const name = lock?.place ?? target.door.name;

		return `E  ${target.door.open > 0.5 ? 'close' : 'open'} the door${name ? ` to ${name}` : ''}`;

	}

	const given = quests?.characterName?.( target.person.npcId )?.given ?? target.person.instance?.name?.given;
	const lift = access?.liftable?.( target.person ) ?? null;

	return `E  talk to ${given ?? `the ${roleOf( target.person.type, typeLabels )}`}${lift ? `   ${lift}` : ''}`;

}

/** A person's role in words: their type's label, else its id without the authoring prefix. */
function roleOf( type, typeLabels ) {

	const label = typeLabels.get( type ) ?? type.replace( /^quest_/, '' ).replace( /_/g, ' ' );
	return label.toLowerCase();

}

const TMP = new THREE.Vector3();
