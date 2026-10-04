import { CompanionBoundary } from './CompanionBoundary.js';
import { CompanionLines } from './CompanionLines.js';
import { CompanionPlaces, standsIn } from './CompanionPlaces.js';
import { LINGER_SECONDS } from '../agents/NpcContinuity.js';
import { dispositionOf, willingTo } from '../../../../quests/dist/runtime.js';

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
/** Game minutes a person stays where an errand for the player takes them before going back to their day. */
const ERRAND_MIN = { walk: 15, home: 60, work: 60, wait: 15, sit: 20 };
/** How far short of a person someone sent to them stops, metres: a step, face to face. */
const BESIDE = 1.2;
/** The actions a person takes on their own for the player, once the talk is done. */
const ERRANDS = new Set( [ 'walk', 'home', 'work', 'wait', 'sit' ] );
/** What a person on each errand is doing for the player, as the talk tells them. */
const TASK = { walk: 'walking', home: 'home', work: 'work', wait: 'waiting', sit: 'sitting' };
/** People this old or tired do not run, whatever the player does. */
const RUNS_UNDER = 60;
/** The minutes a lead is reckoned to take when a person weighs it against their next shift. */
const LEAD_MINUTES = 10;
/** How private a request is to the person: their home, their work, a follow, or a public place. */
const PRIVACY = { home: 'home', work: 'work', follow: 'follow', person: 'public', spot: 'public', venue: 'public', stop: 'public', street: 'public', quest: 'public', scene: 'public', haunt: 'public' };
/** The ends the player is there for, sending the companion off or hearing a leader out at the place. */
const LINGERING = new Set( [ 'dismissed', 'done' ] );

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
	/**
	 * @param inside optional `{ plan(parcelId), workSpot(npc), homeSpot(npc), seat(actor), open(gate) }`:
	 *   a building's circulation, the spot a person works at, the seat of
	 *   their own home, the free seat nearest a body in its building; each a
	 *   `{ position, parcelId, floor, heading?, seated? }` or null
	 * @param streets optional Quests StreetNames, for leads to a street
	 * @param people optional `(npc) => [{ npcId, name, position }]`, the people a person knows whose bodies are placed
	 * @param categoryOf optional `(type) => category`, the person's kind, which colours how they take to strangers
	 * @param addresses optional AddressBook: home and work by address, and the dwellings and rooms a line names
	 * @param holds optional `(npcId, scope) => boolean`, whether a person holds the access a door needs:
	 *   a leader who does opens the door of the place it brought the player to
	 * @param opened optional `(parcelId) => boolean`: only a building anybody can go into is a venue or haunt to walk or lead to
	 */
	constructor( {
		continuity, sim, routes, places, atlas, quests = null, scenes = null, crowd = null,
		inside = null, streets = null, people = null, categoryOf = () => undefined, addresses = null, holds = null, opened = null,
		lines = CompanionLines.standard(), boundary = new CompanionBoundary()
	} ) {

		this.continuity = continuity;
		this.sim = sim;
		this.quests = quests;
		this.scenes = scenes;
		this.crowd = crowd;
		this.lines = lines;
		this.boundary = boundary;
		this.inside = inside;
		this.categoryOf = categoryOf;
		this.routes = routes;
		this.holds = holds;
		this.places = new CompanionPlaces( { atlas, places, routes, lines, inside, streets, people, addresses, opened } );
		/** The companion under way, as saved. */
		this.state = null;
		/** An accepted offer waiting for its person's conversation to close. */
		this.pending = null;
		/** The errands this companion sent people on, by npcId: the action and the place it told. */
		this.errands = new Map();

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

	/**
	 * The talk request's `offers`: the available follow and places (a talk's
	 * wide list, `offers({ wide: true })`), and, with `person`, the actions
	 * this person may take for the player on their own: walk to one of those
	 * places, stop what they do for the player, go home or to work, wait, sit.
	 * Null when there is none.
	 * @param person `{ npcId, timeMin }`
	 */
	talkOffers( offers, person = null ) {

		const follow = offers.some( ( offer ) => offer.kind === 'follow' && offer.available );
		const places = offers.filter( ( offer ) => offer.kind === 'lead' && offer.available )
			.map( ( { destination } ) => ( { placeId: destination.place.id, name: destination.offeredAs ?? destination.name, relation: destination.relation } ) );
		const actions = person ? this.#actions( person.npcId, person.timeMin ) : {};
		if ( ! places.length ) delete actions.walk;
		const any = follow || places.length || Object.keys( actions ).length;
		return this.boundary.output( 'talk-offers', any
			? { ...( follow ? { follow: true } : {} ), ...( places.length ? { places } : {} ), ...actions }
			: null );

	}

	/**
	 * The player chose an offer. An available one is accepted and starts once
	 * this person's conversation closes; `line` is what the person says either
	 * way. With `willing` the person also decides as their disposition says
	 * (`willingTo`), which is how a host decides a chosen offer when no model
	 * can answer for the person: a hostile person refuses everything, a wary
	 * one goes only to a public place, a neutral one anywhere but home.
	 */
	accept( request ) {

		this.boundary.input( 'accept-request', request );
		const chosen = this.#offers( { ...request, wide: true } ).find( ( offer ) => offer.offerId === request.offerId );
		if ( request.willing && chosen?.available && chosen.kind !== 'dismiss' ) {

			const npc = this.#person( request.npcId );
			const disposition = dispositionOf( npc, this.categoryOf( npc.type ) );
			const privacy = chosen.kind === 'follow' ? 'follow' : PRIVACY[ chosen.destination.relation ] ?? 'public';
			if ( ! willingTo( disposition, privacy ) ) return this.#accept( request, { ...chosen, available: false, reason: 'unwilling', disposition } );

		}
		return this.#accept( request, chosen );

	}

	/**
	 * The person agreed through a talk tool: `follow_player`, `lead_player_to`
	 * or `walk_to` a `placeId`, `stop`, `go_home`, `go_to_work`, `wait_here`,
	 * `sit`, or on a call `meet_player`, a walk to where the player is
	 * (`meet`). The typed request is the player's consent, so what it names
	 * that is available is accepted, to start once the talk is done; anything
	 * else is refused with the reason the person says.
	 */
	acceptFromTool( request ) {

		this.boundary.input( 'tool-request', request );
		const { npcId, timeMin, kind } = request;
		const lead = ( offers ) => offers.find( ( offer ) => offer.kind === 'lead' && offer.destination.place.id === request.placeId );
		if ( kind === 'follow' || kind === 'lead' ) {

			const offers = this.#offers( { ...request, wide: true } );
			return this.#accept( request, kind === 'follow' ? offers.find( ( offer ) => offer.kind === 'follow' ) : lead( offers ) );

		}
		const actions = this.#actions( npcId, timeMin );
		const seed = `${npcId}|${Math.floor( timeMin )}`;
		const refuse = ( code ) => this.boundary.output( 'accept-result', { ok: false, npcId, code, line: this.lines.say( `refuse-${code}`, {}, seed ) } );
		if ( kind === 'stop' ) {

			if ( ! actions.stop ) return refuse( 'unknown' );
			this.pending = { npcId, kind: this.state?.npcId === npcId ? 'dismiss' : 'stop' };
			return this.boundary.output( 'accept-result', { ok: true, npcId, offerId: 'stop', kind: 'stop', line: this.lines.say( 'accept-stop', {}, seed ) } );

		}
		if ( kind === 'meet' ) {

			if ( ! actions.walk ) return refuse( this.#why( npcId, timeMin, kind ) );
			const { position, parcelId, floor, name } = request.meet;
			const target = { position: [ ...position ], ...( parcelId ? { parcelId } : {} ), ...( Number.isInteger( floor ) ? { floor } : {} ) };
			this.pending = { npcId, kind: 'walk', destination: { place: { kind: 'spot', id: 'player' }, name, relation: 'person', target }, told: name };
			return this.boundary.output( 'accept-result', { ok: true, npcId, offerId: 'meet', kind: 'walk', line: this.lines.say( 'accept-meet', { place: name }, seed ) } );

		}
		if ( ! actions[ kind ] ) return refuse( this.#why( npcId, timeMin, kind ) );
		let destination = null;
		if ( kind === 'walk' ) {

			const offer = lead( this.#offers( { ...request, wide: true } ) );
			if ( ! offer?.available ) return refuse( offer?.reason ?? 'unknown' );
			const { offeredAs, ...chosen } = offer.destination;
			destination = { ...chosen, told: offeredAs ?? chosen.name };

		}
		const { told, ...going } = destination ?? {};
		this.pending = { npcId, kind, ...( destination ? { destination: going, told } : {} ) };
		return this.boundary.output( 'accept-result', {
			ok: true, npcId, offerId: kind, kind, line: this.lines.say( `accept-${kind}`, destination ? { place: told } : {}, seed )
		} );

	}

	/**
	 * What this person is doing for the player now, as the talk tells them
	 * (Quests `DialogTask`): following, leading to a place (`brought` once
	 * there together), or an errand the
	 * player asked for while the continuity still runs it; null otherwise.
	 */
	taskOf( npcId ) {

		const state = this.state;
		if ( state?.npcId === npcId ) {

			if ( state.kind === 'follow' ) return { kind: 'following' };
			return { kind: [ 'arrived', 'ready', 'talking' ].includes( state.phase ) ? 'brought' : 'leading', place: state.destination.name };

		}
		const errand = this.errands.get( npcId );
		if ( errand && ( this.continuity.errandsUnderway ?? [] ).some( ( entry ) => entry.npcId === npcId ) ) {

			return { kind: TASK[ errand.action ], ...( errand.told ? { place: errand.told } : {} ) };

		}
		this.errands.delete( npcId );
		return null;

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

	#offers( { npcId, timeMin, playerPlaces, wide = false, line = '' } ) {

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
			npc, from: actor.position, playerPlaces, wide, line,
			here: actor.place.kind === 'parcel' ? { parcelId: actor.place.id, ...( Number.isInteger( actor.place.floor ) ? { floor: actor.place.floor } : {} ) } : null,
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
			const key = code === 'unwilling' ? `refuse-unwilling-${chosen.disposition}` : `refuse-${code}`;
			return this.boundary.output( 'accept-result', { ok: false, npcId, code, line: this.lines.say( key, {}, seed ) } );

		}
		// Under way the place goes by its own name; the start notice, read where it was offered, keeps the compass point.
		const { offeredAs, ...destination } = chosen.destination ?? {};
		const told = offeredAs ?? destination.name;
		this.pending = { npcId, kind: chosen.kind, ...( chosen.destination ? { destination, told } : {} ) };
		return this.boundary.output( 'accept-result', {
			ok: true, npcId, offerId: chosen.offerId, kind: chosen.kind,
			line: this.lines.say( `accept-${chosen.kind}`, chosen.destination ? { place: told } : {}, seed )
		} );

	}

	/** Starts, or for a dismissal ends, the accepted offer now no conversation is open. */
	#settle( { timeMin, playerPosition }, signals ) {

		const { npcId, kind, destination, told } = this.pending;
		this.pending = null;
		if ( kind === 'dismiss' ) {

			if ( this.state?.npcId === npcId ) this.#end( 'dismissed', timeMin, signals );
			return;

		}
		if ( kind === 'stop' ) {

			try { this.continuity.endErrand( { npcId, timeMin, linger: LINGER_SECONDS } ); }
			catch { /* The errand is already over. */ }
			signals.push( { kind: 'errand', npcId, action: 'stop' } );
			return;

		}
		if ( ERRANDS.has( kind ) ) return this.#sendOff( npcId, kind, destination, told, timeMin, signals );
		const npc = this.#person( npcId );
		// A lead's walk takes a few minutes; a person due at work within them and twenty more is in a hurry.
		const minutes = destination ? LEAD_MINUTES : undefined;
		try {

			if ( kind === 'follow' ) this.continuity.startFollow( { npcId, timeMin, playerPosition, pace: this.#pace( npc, timeMin ) } );
			else {

				const target = this.#leadTarget( destination );
				this.continuity.startLead( {
					npcId, timeMin, destination: this.#wayTo( destination ), pace: this.#pace( npc, timeMin, minutes ),
					...( target ? { target } : {} )
				} );

			}

		} catch ( error ) {

			this.#letGo( npcId, timeMin );
			const code = error?.code === 'E_NPC_CONFLICT' ? 'conflict' : error?.code === 'E_NPC_PATH' ? 'unknown' : 'unavailable';
			signals.push( { kind: 'refused', npcId, code, line: this.lines.say( `refuse-${code}`, {}, `${npcId}|${Math.floor( timeMin )}` ) } );
			return;

		}
		this.state = { version: '1', npcId, kind, startedAtMin: timeMin, phase: 'walking', ...( destination ? { destination } : {} ) };
		// Whatever the person said, the player reads that they follow, or where they are being taken, as it was offered, and how far.
		const metres = destination ? this.#metresTo( npcId, destination ) : null;
		const notice = ! destination ? this.lines.say( 'notice-follow', { name: this.#given( npcId ) }, `${npcId}|${Math.floor( timeMin )}` )
			: metres === null ? this.#told( 'notice-lead-unmeasured', npcId, told, timeMin )
			: this.lines.say( 'notice-lead', { name: this.#given( npcId ), place: told, metres: String( metres ) }, `${npcId}|${Math.floor( timeMin )}` );
		signals.push( { kind: 'started', npcId, mode: kind, notice } );

	}

	/**
	 * Sends a person on an errand the player asked for, now the talk is done:
	 * to the place they agreed to walk to, home to their own seat, to their
	 * post at work, nowhere (waiting where they stand) or to the free seat
	 * nearest them; there they stay a while before going back to their day.
	 */
	#sendOff( npcId, kind, destination, told, timeMin, signals ) {

		const seed = `${npcId}|${Math.floor( timeMin )}`;
		const target = this.#errandTarget( kind, npcId, destination );
		const refused = ( code ) => {

			this.#letGo( npcId, timeMin );
			signals.push( { kind: 'refused', npcId, code, line: this.lines.say( `refuse-${code}`, {}, seed ) } );

		};
		if ( ! target ) return refused( kind === 'sit' ? 'nowhere' : 'unknown' );
		try {

			this.continuity.sendOnErrand( { npcId, timeMin, target, untilMin: timeMin + ERRAND_MIN[ kind ] } );

		} catch ( error ) {

			return refused( error?.code === 'E_NPC_CONFLICT' ? 'conflict' : error?.code === 'E_NPC_PATH' ? 'unknown' : 'unavailable' );

		}
		this.errands.set( npcId, { action: kind, ...( told ? { told } : {} ) } );
		signals.push( { kind: 'errand', npcId, action: kind, notice: this.#told( `notice-errand-${kind}`, npcId, told ?? '', timeMin ) } );

	}

	/** Where an errand takes the person: a point, inside a building when it names one; null when there is nowhere. */
	#errandTarget( kind, npcId, destination ) {

		const npc = this.#person( npcId );
		const actor = this.continuity.actor( npcId );
		if ( ! npc || ! actor ) return null;
		const at = ( place ) => this.places.positions.get( placeKey( place ) ) ?? null;
		const point = ( position, parcelId = null, floor = null ) => position && {
			position: [ ...position ], ...( parcelId ? { parcelId } : {} ), ...( Number.isInteger( floor ) ? { floor } : {} )
		};
		if ( kind === 'wait' ) return point( actor.position, actor.place.kind === 'parcel' ? actor.place.id : null, actor.place.floor );
		if ( kind === 'sit' ) return this.inside?.seat?.( actor ) ?? null;
		if ( kind === 'home' ) return this.inside?.homeSpot?.( npc ) ?? point( at( { kind: 'parcel', id: npc.home.parcelId } ) );
		if ( kind === 'work' ) return this.inside?.workSpot?.( npc ) ?? ( npc.job ? point( at( { kind: 'parcel', id: npc.job.parcelId } ) ) : null );
		if ( ! destination ) return null;
		const person = destination.target?.npcId ? this.continuity.actor( destination.target.npcId ) : null;
		if ( person ) return point( beside( person.position, actor.position ), person.place.kind === 'parcel' ? person.place.id : null, person.place.floor );
		if ( destination.target?.position ) return point( destination.target.position, destination.target.parcelId, destination.target.floor );
		return point( at( destination.place ) );

	}

	/**
	 * A host who brought the player to their own apartment door opens it for
	 * them: the door of the plan's apartment whose front the lead stopped at;
	 * and a leader who brought them to a door by its address opens it when
	 * they hold the access it needs, as anyone with a card would.
	 */
	#openHome( npcId, destination ) {

		const target = destination.target;
		if ( target?.door && target.scope && this.inside?.open && this.holds?.( npcId, target.scope ) ) {

			this.inside.open( { kind: 'door', parcelId: target.parcelId, floor: target.floor, position: [ ...target.door ] } );
			return;

		}
		if ( destination.relation !== 'home' || ! target?.position || ! this.inside?.open ) return;
		const apartment = this.inside.plan?.( target.parcelId )?.apartments
			.find( ( entry ) => entry.floor === target.floor && entry.front.every( ( value, axis ) => Math.abs( value - target.position[ axis ] ) < 1e-6 ) );
		if ( apartment ) this.inside.open( { kind: 'door', parcelId: target.parcelId, floor: apartment.floor, position: [ ...apartment.door ] } );

	}

	/** The point inside a lead's place the leader takes the player to, or the person it takes them to, or null. */
	#leadTarget( destination ) {

		const target = destination?.target;
		if ( ! target ) return null;
		if ( target.npcId ) return { npcId: target.npcId };
		return { position: [ ...target.position ], ...( target.parcelId ? { parcelId: target.parcelId } : {} ), ...( Number.isInteger( target.floor ) ? { floor: target.floor } : {} ) };

	}

	/** How far a leader stands from where they take the player, straight, to the nearest 10 m; null when either end cannot be placed. */
	#metresTo( npcId, destination ) {

		const from = this.continuity.actor( npcId )?.position;
		const target = destination.target;
		const to = target?.npcId ? this.continuity.actor( target.npcId )?.position
			: target?.position ?? this.places.positions.get( placeKey( destination.place ) ) ?? null;
		if ( ! from || ! to ) return null;
		return Math.max( 10, Math.round( Math.hypot( to[ 0 ] - from[ 0 ], to[ 2 ] - from[ 2 ] ) / 10 ) * 10 );

	}

	/** The continuity place a lead's destination is: a building or stop as itself, a spot as its building, a street or person as where they are. */
	#wayTo( destination ) {

		const { place, target } = destination;
		if ( place.kind === 'parcel' || place.kind === 'stop' ) return { kind: place.kind, id: place.id };
		if ( place.kind === 'spot' ) return { kind: 'parcel', id: target.parcelId };
		if ( place.kind === 'person' ) {

			const person = this.continuity.actor( target.npcId );
			if ( person?.place.kind === 'parcel' || person?.place.kind === 'edge' ) return { kind: person.place.kind, id: person.place.id };

		}
		const position = place.kind === 'person' ? this.continuity.actor( target.npcId )?.position : target?.position;
		const edge = position ? this.routes.project?.( position )?.edge : null;
		if ( ! edge ) throw Object.assign( new Error( `no way to ${place.kind} ${place.id}` ), { code: 'E_NPC_PATH' } );
		return { kind: 'edge', id: edge.id };

	}

	/**
	 * How a person walks with the player: they run with a running player
	 * unless they are old or tired, and a leader due somewhere soon (its next
	 * shift within the walk and twenty minutes) is in a hurry.
	 */
	#pace( npc, timeMin, minutes ) {

		const runs = ( npc?.age ?? 30 ) < RUNS_UNDER && ! ( npc?.traits ?? [] ).includes( 'tired' );
		const hurry = minutes !== undefined && npc && freeMinutes( npc, timeMin ) < minutes + 20;
		return { ...PACE, runs, ...( hurry ? { hurry: true } : {} ) };

	}

	/**
	 * What this person may do on their own for the player now: stop (while
	 * they follow, lead or run an errand for the player), walk somewhere, go
	 * home, go to work (when not there already), wait, and sit (when a seat is
	 * free near them). A person at work, held by a story or unavailable may
	 * only stop.
	 */
	#actions( npcId, timeMin ) {

		const npc = this.#person( npcId );
		if ( ! npc ) return {};
		const actor = this.continuity.actor( npcId );
		const actions = {};
		const errand = ( this.continuity.errandsUnderway ?? [] ).some( ( entry ) => entry.npcId === npcId );
		if ( this.state?.npcId === npcId || errand ) actions.stop = true;
		if ( this.#errandRefusal( npc, actor, timeMin ) ) return actions;
		Object.assign( actions, { walk: true, home: true, wait: true } );
		if ( npc.job && this.sim.behaviorAt( npcId, timeMin )?.activity !== 'working' ) actions.work = true;
		if ( this.inside?.seat?.( actor ) ) actions.sit = true;
		return actions;

	}

	/** Why a person will not set off on an errand of their own now, or null: as for coming along, but somebody else walking with the player is no bar. */
	#errandRefusal( npc, actor, timeMin ) {

		if ( npc.flags.dead || ! actor || actor.place.kind === 'route' || this.crowd?.memberForNpc( npc.npcId )?.fallen ) return 'unavailable';
		if ( this.state?.npcId === npc.npcId ) return null;
		if ( this.quests?.holdsCast( npc.npcId ) ) return 'busy';
		if ( this.sim.behaviorAt( npc.npcId, timeMin )?.activity === 'working' ) return 'on_duty';
		return null;

	}

	/** The reason an action the person was asked for is not theirs to take now. */
	#why( npcId, timeMin, kind ) {

		const npc = this.#person( npcId );
		const refusal = npc ? this.#errandRefusal( npc, this.continuity.actor( npcId ), timeMin ) : 'unavailable';
		if ( refusal ) return refusal;
		return kind === 'sit' ? 'nowhere' : 'unknown';

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
			if ( state.phase === 'arrived' ) this.#openHome( state.npcId, state.destination );
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
				line: this.lines.say( `arrival-${destination.relation}`, { place: destination.name }, seed ),
				notice: this.#told( 'notice-arrived', npcId, destination.name, timeMin )
			} );

		}
		if ( state.phase === 'ready' ) {

			if ( talking ) state.phase = 'talking';
			else if ( near > LEAVE_DISTANCE && ! atPlace ) this.#end( 'left', timeMin, signals );
			else if ( timeMin - state.readyAtMin >= READY_MIN ) this.#end( 'done', timeMin, signals );

		} else if ( state.phase === 'talking' && ! talking ) this.#end( 'done', timeMin, signals );

	}

	/**
	 * The companion goes back to its day from where it stands, if the
	 * continuity still has it: let go by the player or done talking about the
	 * place, first standing a moment turned to them.
	 */
	#end( reason, timeMin, signals, notice = null ) {

		const { npcId } = this.state;
		this.state = null;
		const linger = LINGERING.has( reason ) ? { linger: LINGER_SECONDS } : {};
		if ( this.continuity.companion?.npcId === npcId ) this.continuity.stopFollow( { timeMin, ...linger } );
		signals.push( { kind: 'ended', npcId, reason, ...( notice ? { notice } : {} ) } );

	}

	/** What the player reads when a companion gives up on them, or null when it went without a word. */
	#notice( reason, npcId, timeMin ) {

		if ( reason === 'unavailable' ) return null;
		return this.lines.say( `notice-gave-up-${reason}`, { name: this.#given( npcId ) }, `${npcId}|${Math.floor( timeMin )}` );

	}

	/** What the player reads about a leader and the `place` it leads to. */
	#told( key, npcId, place, timeMin ) {

		return this.lines.say( key, { name: this.#given( npcId ), place }, `${npcId}|${Math.floor( timeMin )}` );

	}

	/** The person's given name, as the story calls them. */
	#given( npcId ) {

		return this.quests?.characterName( npcId )?.given ?? this.sim.getNPC( npcId ).name.given;

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

/** A step short of `position` on the side `from` comes from, at its height; `position` itself when they stand together. */
function beside( position, from ) {

	const dx = from[ 0 ] - position[ 0 ];
	const dz = from[ 2 ] - position[ 2 ];
	const away = Math.hypot( dx, dz );
	if ( away <= BESIDE ) return [ ...position ];
	return [ position[ 0 ] + dx / away * BESIDE, position[ 1 ], position[ 2 ] + dz / away * BESIDE ];

}
