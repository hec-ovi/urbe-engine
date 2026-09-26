import { CompanionBoundary } from './CompanionBoundary.js';
import { CompanionLines } from './CompanionLines.js';
import { CompanionPlaces, standsIn } from './CompanionPlaces.js';

/** A companion the player leaves gives up once they stay this far away for this long. */
const PACE = { giveUpBeyond: 60, giveUpAfterMin: 3 };
/** The walking pace a lead is timed at, in metres per second. */
const PLAYER_PACE = 1.2;
/** Minutes a lead keeps free for talking about the place at the end. */
const ARRIVAL_TALK_MIN = 5;
/** Minutes before their next shift a person needs to come along at all. */
const FOLLOW_FREE_MIN = 15;
/** The player has caught up with an arrived leader within this many metres. */
const CATCH_UP = 4;
/** A leader nobody talks to at the place goes back to its day this many minutes after the arrival, or once the player is this far from it and outside the place. */
const READY_MIN = 2;
const LEAVE_DISTANCE = 15;
/** Minutes between the things a waiting leader calls out; the host clock counts whole minutes. */
const WAIT_LINE_MIN = 1;
const DAY = 1440;
const MODE = { follow: 'following', lead: 'leading' };

/**
 * One person the player has asked along: following the player, or leading
 * them to a place and talking about it there. Code decides who may come and
 * where to; a typed request the person agrees to and an explicit action both
 * start it once the conversation closes. Continuity moves the body; this box
 * owns the offer, the words on the way, the arrival and the end.
 */
export class CompanionGameplay {

	/**
	 * @param continuity NpcContinuity: `companion`, `conversation`, `actor`, `startFollow`, `startLead`, `stopFollow`, `heldNpcIds`, `releaseHold`, `drainEvents`
	 * @param sim the simulation: `getNPC`, `behaviorAt`
	 * @param routes WalkRoutes, places the continuity places and atlas the city plan, for CompanionPlaces
	 * @param quests optional `{ holdsCast(npcId), escorts(npcId), places(timeMin), characterName(npcId) }`
	 * @param scenes optional provider of staged scenery places `[{ place, name, relation: 'scene', notes? }]`
	 * @param crowd optional `{ memberForNpc(npcId) }`, whose fallen bodies cannot come
	 */
	constructor( {
		continuity, sim, routes, places, atlas, quests = null, scenes = null, crowd = null,
		lines = CompanionLines.standard(), boundary = new CompanionBoundary()
	} ) {

		this.continuity = continuity;
		this.sim = sim;
		this.quests = quests;
		this.scenes = scenes;
		this.crowd = crowd;
		this.lines = lines;
		this.boundary = boundary;
		this.places = new CompanionPlaces( { atlas, places, routes, lines } );
		/** The companion under way, as saved. */
		this.state = null;
		/** An accepted offer waiting for its person's conversation to close. */
		this.pending = null;

	}

	/** The companion under way: `{ npcId, kind, phase, destination? }`, or null. */
	get active() {

		if ( ! this.state ) return null;
		const { npcId, kind, phase, destination } = this.state;
		return { npcId, kind, phase, ...( destination ? { destination: structuredClone( destination ) } : {} ) };

	}

	/**
	 * What the player may ask of this person now: 'Come with me', 'Show me'
	 * one of up to four places, and 'You can go now' for the companion. An
	 * unavailable offer carries the reason the person gives for refusing it.
	 */
	offers( request ) {

		this.boundary.input( 'offers-request', request );
		return this.boundary.output( 'offers', this.#offers( request ) );

	}

	/** The talk request's `offers`: the available follow and places, or null when there is none. */
	talkOffers( offers ) {

		const follow = offers.some( ( offer ) => offer.kind === 'follow' && offer.available );
		const places = offers.filter( ( offer ) => offer.kind === 'lead' && offer.available )
			.map( ( { destination } ) => ( { placeId: destination.place.id, name: destination.offeredAs ?? destination.name } ) );
		return this.boundary.output( 'talk-offers', follow || places.length
			? { ...( follow ? { follow: true } : {} ), ...( places.length ? { places } : {} ) }
			: null );

	}

	/**
	 * The player chose an offer. An available one is accepted and starts once
	 * this person's conversation closes; `line` is what the person says either
	 * way.
	 */
	accept( request ) {

		this.boundary.input( 'accept-request', request );
		return this.#accept( request, this.#offers( request ).find( ( offer ) => offer.offerId === request.offerId ) );

	}

	/**
	 * The person agreed through a talk tool: `follow_player`, or
	 * `lead_player_to` a `placeId`. The typed request is the player's consent,
	 * so an offer it names that is available is accepted as if chosen;
	 * anything else is refused with the reason the person says.
	 */
	acceptFromTool( request ) {

		this.boundary.input( 'tool-request', request );
		const offers = this.#offers( request );
		return this.#accept( request, request.kind === 'follow'
			? offers.find( ( offer ) => offer.kind === 'follow' )
			: offers.find( ( offer ) => offer.kind === 'lead' && offer.destination.place.id === request.placeId ) );

	}

	/** Whether an accepted offer waits for this person's conversation to close; the host keeps the body where it stands. */
	accepted( npcId ) {

		return this.pending?.npcId === npcId;

	}

	/** The talk request's `guide` for a leader at its destination, or null. */
	guide( npcId ) {

		const state = this.state;
		return state?.npcId === npcId && state.kind === 'lead' && [ 'arrived', 'ready', 'talking' ].includes( state.phase )
			? guideOf( state.destination )
			: null;

	}

	/**
	 * One frame, right after the continuity's `updateFollow`: starts an
	 * accepted offer once no conversation is open, drains the continuity's
	 * control events and follows the companion to its end. Returns what the
	 * host shows: `started`, `refused`, `line`, `arrival` and `ended` signals.
	 */
	update( request ) {

		this.boundary.input( 'update-request', request );
		const events = this.continuity.drainEvents();
		const signals = [];
		if ( this.pending && ! this.continuity.conversation ) this.#settle( request, signals );
		if ( this.state ) this.#advance( request, events, signals );
		return this.boundary.output( 'signals', signals );

	}

	serialize() {

		return this.boundary.output( 'state', this.state ? structuredClone( this.state ) : null );

	}

	/**
	 * Takes a saved companion back when the restored continuity companion is
	 * the same person in the same mode; one whose place talk was under way
	 * arrives again. Runs after the quest escort is restored, with no
	 * conversation open: a continuity companion that is neither this saved
	 * companion nor the quest escort's person is let go.
	 */
	restore( request ) {

		this.boundary.input( 'restore-request', request );
		this.state = null;
		this.pending = null;
		const saved = request.state;
		const companion = this.continuity.companion;
		if ( ! companion || this.quests?.escorts( companion.npcId ) ) return false;
		if ( companion.npcId !== saved?.npcId || companion.mode !== MODE[ saved.kind ] ) {

			this.continuity.stopFollow( { timeMin: request.timeMin } );
			return false;

		}
		const { readyAtMin, ...state } = structuredClone( saved );
		const arrived = saved.kind === 'lead' && ( companion.phase === 'arrived' || [ 'ready', 'talking' ].includes( saved.phase ) );
		this.state = { ...state, phase: arrived ? 'arrived' : companion.phase };
		return true;

	}

	#offers( { npcId, timeMin, playerPlaces } ) {

		const ours = this.state?.npcId === npcId ? this.state : null;
		const npc = this.#person( npcId );
		const actor = npc ? this.continuity.actor( npcId ) : null;
		const refusal = this.#refusal( npc, actor, timeMin, ours );
		const free = refusal ? 0 : freeMinutes( npc, timeMin );
		const offers = [];
		if ( ours?.kind !== 'follow' ) {

			offers.push( offer( 'follow', this.lines.say( 'label-follow' ), refusal ?? ( free < FOLLOW_FREE_MIN ? 'no_time' : null ) ) );

		}
		const destinations = actor ? this.places.destinations( {
			npc, from: actor.position, playerPlaces,
			quests: this.quests?.places( timeMin ) ?? [],
			scenes: this.scenes ? this.boundary.input( 'scenes', this.scenes() ) : []
		} ) : [];
		for ( const { distance, ...destination } of destinations ) {

			if ( ours?.kind === 'lead' && placeKey( ours.destination.place ) === placeKey( destination.place ) ) continue;
			const minutes = distance / PLAYER_PACE / 60 + ARRIVAL_TALK_MIN;
			offers.push( {
				...offer( `lead:${placeKey( destination.place )}`,
					this.lines.say( `label-lead-${destination.relation}`, { place: destination.offeredAs ?? destination.name } ),
					refusal ?? ( free < minutes ? 'no_time' : null ), 'lead' ),
				destination
			} );

		}
		if ( ours ) offers.push( offer( 'dismiss', this.lines.say( 'label-dismiss' ), null ) );
		return offers;

	}

	/** Why this person will not come along now, or null. */
	#refusal( npc, actor, timeMin, ours ) {

		if ( ! npc || npc.flags.dead || ! actor || actor.place.kind === 'route' || this.crowd?.memberForNpc( npc.npcId )?.fallen ) return 'unavailable';
		if ( ours ) return null;
		const companion = this.continuity.companion;
		if ( companion ) return companion.npcId === npc.npcId ? 'busy' : 'conflict';
		if ( this.pending && this.pending.npcId !== npc.npcId ) return 'conflict';
		if ( this.quests?.holdsCast( npc.npcId ) ) return 'busy';
		if ( this.sim.behaviorAt( npc.npcId, timeMin ).activity === 'working' ) return 'on_duty';
		return null;

	}

	#accept( { npcId, timeMin }, chosen ) {

		const seed = `${npcId}|${Math.floor( timeMin )}`;
		if ( ! chosen?.available ) {

			const code = chosen?.reason ?? 'unknown';
			return this.boundary.output( 'accept-result', { ok: false, npcId, code, line: this.lines.say( `refuse-${code}`, {}, seed ) } );

		}
		// Under way the place goes by its own name: the compass point was from where it was offered.
		const { offeredAs, ...destination } = chosen.destination ?? {};
		this.pending = { npcId, kind: chosen.kind, ...( chosen.destination ? { destination } : {} ) };
		return this.boundary.output( 'accept-result', {
			ok: true, npcId, offerId: chosen.offerId, kind: chosen.kind,
			line: this.lines.say( `accept-${chosen.kind}`, chosen.destination ? { place: offeredAs ?? destination.name } : {}, seed )
		} );

	}

	/** Starts, or for a dismissal ends, the accepted offer now no conversation is open. */
	#settle( { timeMin, playerPosition }, signals ) {

		const { npcId, kind, destination } = this.pending;
		this.pending = null;
		if ( kind === 'dismiss' ) {

			if ( this.state?.npcId === npcId ) this.#end( 'dismissed', timeMin, signals );
			return;

		}
		try {

			if ( kind === 'follow' ) this.continuity.startFollow( { npcId, timeMin, playerPosition, pace: PACE } );
			else this.continuity.startLead( { npcId, timeMin, destination: destination.place, pace: PACE } );

		} catch ( error ) {

			this.#letGo( npcId, timeMin );
			const code = error?.code === 'E_NPC_CONFLICT' ? 'conflict' : error?.code === 'E_NPC_PATH' ? 'unknown' : 'unavailable';
			signals.push( { kind: 'refused', npcId, code, line: this.lines.say( `refuse-${code}`, {}, `${npcId}|${Math.floor( timeMin )}` ) } );
			return;

		}
		this.state = { version: '1', npcId, kind, startedAtMin: timeMin, phase: 'walking', ...( destination ? { destination } : {} ) };
		signals.push( { kind: 'started', npcId, mode: kind } );

	}

	/** A body held for an accepted offer that cannot start walks back into its day. */
	#letGo( npcId, timeMin ) {

		if ( ! this.continuity.heldNpcIds.includes( npcId ) ) return;
		// The hold is gone even when no way back is found; the schedule takes the body on the next visible update.
		try { this.continuity.releaseHold( { npcId, timeMin } ); }
		catch ( error ) { console.warn( `companion ${npcId} could not return to its routine: ${error?.message ?? error}` ); }

	}

	/**
	 * Follows the companion: a follower until it is dismissed or gives up; a
	 * leader calls out while it waits, arrives, and once the player has caught
	 * up with nothing else open asks the host for the conversation
	 * about the place, then goes back to its day when that conversation
	 * closes, the player walks off or nobody talks to it.
	 */
	#advance( { timeMin, playerPosition, playerPlaces, busy = false }, events, signals ) {

		const state = this.state;
		const { npcId } = state;
		const mode = MODE[ state.kind ];
		const gaveUp = events.find( ( event ) => event.npcId === npcId && event.mode === mode && event.phase === 'gave-up' );
		if ( gaveUp ) return this.#end( 'gave-up', timeMin, signals, this.#notice( gaveUp.reason, npcId, timeMin ) );
		const companion = this.continuity.companion;
		if ( companion?.npcId !== npcId || companion.mode !== mode ) return this.#end( 'lost', timeMin, signals );
		if ( state.kind === 'follow' ) {

			state.phase = companion.phase;
			return;

		}
		const talking = this.continuity.conversation?.npcId === npcId;
		const seed = `${npcId}|${Math.floor( timeMin )}`;
		if ( state.phase === 'walking' || state.phase === 'waiting' ) {

			state.phase = companion.phase;
			if ( state.phase === 'waiting' && ! talking && ( state.lineAtMin === undefined || timeMin - state.lineAtMin >= WAIT_LINE_MIN ) ) {

				state.lineAtMin = timeMin;
				signals.push( { kind: 'line', npcId, line: this.lines.say( 'lead-waiting', {}, seed ) } );

			}

		}
		const destination = state.destination;
		const near = distance( playerPosition, companion.position );
		const atPlace = standsIn( playerPlaces, destination.place );
		// A conversation with anybody else, or anything else the player has open, holds the arrival: the host could not open this one.
		if ( state.phase === 'arrived' && ( talking || ( ! busy && ! this.continuity.conversation && ( near <= CATCH_UP || atPlace ) ) ) ) {

			state.phase = 'ready';
			state.readyAtMin = timeMin;
			signals.push( {
				kind: 'arrival', npcId, guide: guideOf( destination ), relation: destination.relation,
				ask: this.lines.say( 'arrival-ask', { place: destination.name }, seed ),
				line: this.lines.say( `arrival-${destination.relation}`, { place: destination.name }, seed )
			} );

		}
		if ( state.phase === 'ready' ) {

			if ( talking ) state.phase = 'talking';
			else if ( near > LEAVE_DISTANCE && ! atPlace ) this.#end( 'left', timeMin, signals );
			else if ( timeMin - state.readyAtMin >= READY_MIN ) this.#end( 'done', timeMin, signals );

		} else if ( state.phase === 'talking' && ! talking ) this.#end( 'done', timeMin, signals );

	}

	/** The companion goes back to its day from where it stands, if the continuity still has it. */
	#end( reason, timeMin, signals, notice = null ) {

		const { npcId } = this.state;
		this.state = null;
		if ( this.continuity.companion?.npcId === npcId ) this.continuity.stopFollow( { timeMin } );
		signals.push( { kind: 'ended', npcId, reason, ...( notice ? { notice } : {} ) } );

	}

	/** What the player reads when a companion gives up on them, or null when it went without a word. */
	#notice( reason, npcId, timeMin ) {

		if ( reason === 'unavailable' ) return null;
		const name = this.quests?.characterName( npcId )?.given ?? this.sim.getNPC( npcId ).name.given;
		return this.lines.say( `notice-gave-up-${reason}`, { name }, `${npcId}|${Math.floor( timeMin )}` );

	}

	/** The live simulation instance, or null when the simulation does not hold this person. */
	#person( npcId ) {

		try { return this.sim.getNPC( npcId ); }
		catch { return null; }

	}

}

/**
 * Minutes until a person sets off for their next shift, read from their
 * weekly routine: the start of the commute that ends at work, or of work
 * itself. Infinity when no shift starts within a day.
 */
export function freeMinutes( npc, timeMin ) {

	let at = timeMin;
	let setOff = null;
	for ( let step = 0; step <= npc.routine.length * 2 && at - timeMin < DAY; step ++ ) {

		const dayStart = Math.floor( at / DAY ) * DAY;
		const minute = at - dayStart;
		const day = Math.floor( at / DAY ) % 7;
		const entry = npc.routine.find( ( candidate ) => candidate.days.includes( day ) && candidate.startMin <= minute && minute < candidate.endMin );
		if ( ! entry ) return Infinity;
		if ( entry.activity === 'working' ) return ( setOff ?? at ) - timeMin;
		setOff = entry.activity === 'commuting' ? setOff ?? at : null;
		at = dayStart + entry.endMin;

	}
	return Infinity;

}

function offer( offerId, label, reason, kind = offerId ) {

	return { offerId, kind, label, available: ! reason, ...( reason ? { reason } : {} ) };

}

function guideOf( destination ) {

	return {
		placeId: destination.place.id, kind: destination.place.kind, name: destination.name,
		...( destination.notes ? { notes: [ ...destination.notes ] } : {} )
	};

}

function placeKey( place ) {

	return `${place.kind}:${place.id}`;

}

function distance( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );

}
