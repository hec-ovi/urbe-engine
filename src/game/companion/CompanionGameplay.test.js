import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS, restoreSimulation } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from '../agents/NpcContinuity.js';
import { WalkRoutes } from '../agents/WalkRoutes.js';
import { CompanionGameplay, freeMinutes } from './CompanionGameplay.js';

/** Monday 16:00: Mira, the cafe's day barista, is at home after her shift. */
const AFTERNOON = 16 * 60;
const HOME = { kind: 'parcel', id: 'p_r2' };
const SCENE = { place: { kind: 'parcel', id: 'p_rest' }, name: 'the back room', relation: 'scene', notes: [ 'Chalk on the floor.' ] };

describe( 'companion offers', () => {

	it( 'offers to come along and to show quest, scene, work and haunt places in order, each within reach', () => {

		const game = setup();
		const mira = game.talkTo( 'p_cafe', AFTERNOON );
		const offers = game.companion.offers( game.ask( mira ) );
		expect( offers.map( ( offer ) => [ offer.offerId, offer.label, offer.available ] ) ).toEqual( [
			[ 'follow', 'Come with me', true ],
			[ 'lead:parcel:p_clinic', 'Show me the clinic', true ],
			[ 'lead:parcel:p_rest', 'Show me the back room', true ],
			[ 'lead:parcel:p_cafe', 'Show me where you work', true ],
			[ 'lead:parcel:p_mall', 'Show me the mall', true ]
		] );
		expect( offers[ 1 ].destination ).toEqual( {
			place: { kind: 'parcel', id: 'p_clinic' }, name: 'the clinic', relation: 'quest', questId: 'main', stepId: 'visit'
		} );
		expect( offers[ 2 ].destination ).toEqual( SCENE );
		// Her home is where the player is standing.
		expect( offers.some( ( offer ) => offer.offerId === 'lead:parcel:p_r2' ) ).toBe( false );
		expect( game.companion.talkOffers( offers ) ).toEqual( {
			follow: true,
			places: [
				{ placeId: 'p_clinic', name: 'the clinic' }, { placeId: 'p_rest', name: 'the back room' },
				{ placeId: 'p_cafe', name: 'the coffee shop' }, { placeId: 'p_mall', name: 'the mall' }
			]
		} );
		expect( game.companion.talkOffers( offers.map( ( offer ) => ( { ...offer, available: false, reason: 'on_duty' } ) ) ) ).toBeNull();

	} );

	it( 'refuses with a reason: at work, due at work, kept by the story, already with company, or fallen', () => {

		const reasons = ( game, request ) => [ ...new Set( game.companion.offers( request ).map( ( offer ) => offer.reason ?? 'available' ) ) ];

		const working = setup();
		expect( reasons( working, working.ask( working.talkTo( 'p_cafe', 9 * 60 ) ) ) ).toEqual( [ 'on_duty' ] );

		// At 05:50 Mira sets off for work in five minutes.
		const early = setup();
		const due = early.talkTo( 'p_cafe', 350 );
		expect( freeMinutes( early.bridge.getNPC( due.npcId ), 350 ) ).toBe( 5 );
		expect( reasons( early, early.ask( due, 350 ) ) ).toEqual( [ 'no_time' ] );

		const cast = setup( { holdsCast: () => true } );
		expect( reasons( cast, cast.ask( cast.talkTo( 'p_cafe', AFTERNOON ) ) ) ).toEqual( [ 'busy' ] );

		const company = setup();
		const other = company.bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: 9 * 60 } );
		company.continuity.startFollow( { npcId: other.npcId, timeMin: AFTERNOON, playerPosition: [ 660, 1, 250 ] } );
		expect( reasons( company, company.ask( company.talkTo( 'p_cafe', AFTERNOON, { conversation: false } ) ) ) ).toEqual( [ 'conflict' ] );

		const fallen = setup( {}, { memberForNpc: () => ( { fallen: true } ) } );
		expect( reasons( fallen, fallen.ask( fallen.talkTo( 'p_cafe', AFTERNOON ) ) ) ).toEqual( [ 'unavailable' ] );

		const refused = working.companion.accept( { ...working.ask( working.continuity.actor( working.continuity.conversation.npcId ), 9 * 60 ), offerId: 'follow' } );
		expect( refused ).toMatchObject( { ok: false, code: 'on_duty' } );
		expect( [ "I'm working. Not now.", "My shift isn't over." ] ).toContain( refused.line );
		expect( working.companion.accepted( refused.npcId ) ).toBe( false );
		expect( working.companion.acceptFromTool( { ...working.ask( working.continuity.actor( refused.npcId ), 9 * 60 ), kind: 'follow' } ) )
			.toMatchObject( { ok: false, code: 'on_duty' } );

	} );

} );

describe( 'a companion under way', () => {

	it( 'leads to a chosen place once the chat closes, and asks for the talk there when the player catches up', () => {

		const game = setup();
		const mira = game.talkTo( 'p_cafe', AFTERNOON );
		const accepted = game.companion.accept( { ...game.ask( mira ), offerId: 'lead:parcel:p_rest' } );
		expect( accepted ).toMatchObject( { ok: true, kind: 'lead', offerId: 'lead:parcel:p_rest' } );
		expect( [ 'Follow me to the back room.', 'This way. Keep close.', 'Come on. It isn\'t far.' ] ).toContain( accepted.line );

		// Nothing starts while the chat is open; the host holds the body as it closes.
		expect( game.frame( AFTERNOON, mira.position ) ).toEqual( [] );
		expect( game.companion.accepted( mira.npcId ) ).toBe( true );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: game.companion.accepted( mira.npcId ) } );
		expect( game.frame( AFTERNOON, mira.position ) ).toEqual( [ { kind: 'started', npcId: mira.npcId, mode: 'lead' } ] );
		expect( game.continuity.companion ).toMatchObject( { npcId: mira.npcId, mode: 'leading' } );
		expect( game.bridge.simulation.serialize().events.filter( ( event ) => event.npcId === mira.npcId ).map( ( event ) => event.k ) )
			.toEqual( [ 'interrupt' ] );

		const signals = game.walkBeside( AFTERNOON + 1, () => game.companion.active.phase === 'ready' );
		expect( signals.map( ( signal ) => signal.kind ) ).toEqual( [ 'arrival' ] );
		expect( signals[ 0 ] ).toMatchObject( {
			npcId: mira.npcId, relation: 'scene',
			guide: { placeId: 'p_rest', kind: 'parcel', name: 'the back room', notes: [ 'Chalk on the floor.' ] }
		} );
		expect( [ 'So this is the back room. Tell me about it.', 'We\'re here. What should I know about the back room?' ] ).toContain( signals[ 0 ].ask );
		expect( game.companion.guide( mira.npcId ) ).toEqual( signals[ 0 ].guide );

		// The host opens the talk; closing it ends the companion, who walks back into their day.
		const at = game.continuity.companion.position;
		game.continuity.beginConversation( { npcId: mira.npcId, timeMin: AFTERNOON + 2, position: at, heading: 0, place: SCENE.place, seated: false } );
		expect( game.frame( AFTERNOON + 2, at ) ).toEqual( [] );
		expect( game.companion.active.phase ).toBe( 'talking' );
		game.continuity.endConversation( { timeMin: AFTERNOON + 3 } );
		expect( game.frame( AFTERNOON + 3, at ) ).toEqual( [ { kind: 'ended', npcId: mira.npcId, reason: 'done' } ] );
		expect( game.continuity.companion ).toBeNull();
		expect( game.companion.active ).toBeNull();
		expect( game.bridge.behaviorAt( mira.npcId, AFTERNOON + 3 ).interrupted ).toBe( false );

	} );

	it( 'calls out while waiting for a lagging player, once a clock minute', () => {

		const game = setup();
		const mira = game.start( 'lead:parcel:p_cafe' );
		const behind = [ ...mira.position ];
		const called = [];
		// A frame a second on the host's whole-minute clock.
		for ( let second = 0; second < 150; second ++ ) {

			const timeMin = AFTERNOON + Math.floor( second / 60 );
			for ( const signal of game.frame( timeMin, behind ) ) {

				expect( signal.kind ).toBe( 'line' );
				expect( [ 'This way.', 'Keep up.', 'Are you coming?', 'Over here.' ] ).toContain( signal.line );
				called.push( timeMin );

			}

		}
		expect( game.companion.active.phase ).toBe( 'waiting' );
		expect( called ).toEqual( [ AFTERNOON, AFTERNOON + 1, AFTERNOON + 2 ] );

	} );

	it( 'asks for the talk once the player stands at the place far from the leader, and lets it go when they walk off', () => {

		const game = setup();
		const mira = game.start( 'lead:parcel:p_rest' );
		const at = game.arrive( AFTERNOON + 1 );
		const across = [ at[ 0 ] + 20, at[ 1 ], at[ 2 ] ];
		const signals = game.frame( AFTERNOON + 1, across, [ SCENE.place ] );
		expect( signals.map( ( signal ) => signal.kind ) ).toEqual( [ 'arrival' ] );
		expect( game.companion.guide( mira.npcId ) ).toEqual( signals[ 0 ].guide );
		expect( game.frame( AFTERNOON + 1, across, [ SCENE.place ] ) ).toEqual( [] );
		expect( game.continuity.companion ).toMatchObject( { npcId: mira.npcId, phase: 'arrived' } );

		// Out of the place and still far away, the player has left the talk behind.
		expect( game.frame( AFTERNOON + 1, across ) ).toEqual( [ { kind: 'ended', npcId: mira.npcId, reason: 'left' } ] );
		expect( game.continuity.companion ).toBeNull();
		expect( game.companion.guide( mira.npcId ) ).toBeNull();

	} );

	it( 'holds the arrival while the player talks to somebody else, then goes back to its day when nobody talks to it', () => {

		const game = setup();
		const mira = game.start( 'lead:parcel:p_rest' );
		const at = game.arrive( AFTERNOON + 1 );
		const beside = [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ];
		game.talkTo( 'p_clinic', AFTERNOON + 1 );
		for ( let timeMin = AFTERNOON + 1; timeMin <= AFTERNOON + 4; timeMin ++ ) expect( game.frame( timeMin, beside, [ SCENE.place ] ) ).toEqual( [] );
		expect( game.companion.active.phase ).toBe( 'arrived' );

		game.continuity.endConversation( { timeMin: AFTERNOON + 4 } );
		expect( game.frame( AFTERNOON + 4, beside ).map( ( signal ) => signal.kind ) ).toEqual( [ 'arrival' ] );
		expect( game.frame( AFTERNOON + 5, beside ) ).toEqual( [] );
		expect( game.frame( AFTERNOON + 6, beside ) ).toEqual( [ { kind: 'ended', npcId: mira.npcId, reason: 'done' } ] );
		expect( game.continuity.companion ).toBeNull();

	} );

	it( 'follows until dismissed, and a dismissal waits for the chat to close', () => {

		const game = setup();
		const mira = game.start( 'follow' );
		expect( game.continuity.companion ).toMatchObject( { npcId: mira.npcId, mode: 'following' } );
		const at = game.continuity.companion.position;
		game.continuity.beginConversation( { npcId: mira.npcId, timeMin: AFTERNOON + 1, position: at, heading: 0, place: HOME, seated: false } );
		const offers = game.companion.offers( game.ask( { npcId: mira.npcId, position: at }, AFTERNOON + 1 ) );
		expect( offers.map( ( offer ) => offer.kind ) ).toEqual( [ 'lead', 'lead', 'lead', 'lead', 'dismiss' ] );
		expect( offers.at( - 1 ) ).toMatchObject( { offerId: 'dismiss', label: 'You can go now', available: true } );
		expect( game.companion.accept( { ...game.ask( { npcId: mira.npcId, position: at }, AFTERNOON + 1 ), offerId: 'dismiss' } ) )
			.toMatchObject( { ok: true, kind: 'dismiss' } );
		expect( game.frame( AFTERNOON + 1, at ) ).toEqual( [] );
		game.continuity.endConversation( { timeMin: AFTERNOON + 1 } );
		expect( game.frame( AFTERNOON + 1, at ) ).toEqual( [ { kind: 'ended', npcId: mira.npcId, reason: 'dismissed' } ] );
		expect( game.continuity.companion ).toBeNull();

	} );

	it( 'turns a follower into a leader where it stands when asked through a talk tool', () => {

		const game = setup();
		const mira = game.start( 'follow' );
		const at = game.continuity.companion.position;
		game.continuity.beginConversation( { npcId: mira.npcId, timeMin: AFTERNOON + 1, position: at, heading: 0, place: HOME, seated: false } );
		const request = { ...game.ask( { npcId: mira.npcId, position: at }, AFTERNOON + 1 ), kind: 'lead', placeId: 'p_cafe' };
		expect( game.companion.acceptFromTool( request ) ).toMatchObject( { ok: true, kind: 'lead', offerId: 'lead:parcel:p_cafe' } );
		const unknown = game.companion.acceptFromTool( { ...request, placeId: 'p_factory' } );
		expect( unknown ).toMatchObject( { ok: false, code: 'unknown', line: 'I don\'t know the way there.' } );
		game.continuity.endConversation( { timeMin: AFTERNOON + 1 } );
		expect( game.frame( AFTERNOON + 1, at ) ).toEqual( [ { kind: 'started', npcId: mira.npcId, mode: 'lead' } ] );
		expect( game.continuity.companion ).toMatchObject( { npcId: mira.npcId, mode: 'leading', position: at } );
		expect( game.companion.active ).toMatchObject( { kind: 'lead', destination: { place: { kind: 'parcel', id: 'p_cafe' }, relation: 'work' } } );

	} );

	it( 'refuses a follow agreed through the talk tool when another companion took the slot, letting the held body go', () => {

		const game = setup();
		const mira = game.talkTo( 'p_cafe', AFTERNOON );
		expect( game.companion.acceptFromTool( { ...game.ask( mira ), kind: 'follow' } ) ).toMatchObject( { ok: true, kind: 'follow', offerId: 'follow' } );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: game.companion.accepted( mira.npcId ) } );
		const other = game.bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: 9 * 60 } );
		game.continuity.startFollow( { npcId: other.npcId, timeMin: AFTERNOON, playerPosition: [ 660, 1, 250 ] } );

		expect( game.frame( AFTERNOON, mira.position ) ).toMatchObject( [ { kind: 'refused', npcId: mira.npcId, code: 'conflict' } ] );
		expect( game.continuity.heldNpcIds ).not.toContain( mira.npcId );
		expect( game.bridge.behaviorAt( mira.npcId, AFTERNOON ).interrupted ).toBe( false );
		expect( game.companion.active ).toBeNull();

	} );

	it( 'gives up on a player who walks away and says so, and ends when the continuity lets it go', () => {

		const game = setup();
		const mira = game.start( 'follow' );
		const far = [ 5000, 1, 5000 ];
		let signals = [];
		for ( let timeMin = AFTERNOON; timeMin <= AFTERNOON + 4 && ! signals.length; timeMin ++ ) signals = game.frame( timeMin, far );
		expect( signals ).toEqual( [ { kind: 'ended', npcId: mira.npcId, reason: 'gave-up', notice: 'Mira gave up waiting for you.' } ] );
		expect( game.companion.serialize() ).toBeNull();

		const again = setup();
		const lead = again.start( 'lead:parcel:p_rest' );
		again.continuity.stopFollow( { timeMin: AFTERNOON + 1 } );
		expect( again.frame( AFTERNOON + 1, lead.position ) ).toEqual( [ { kind: 'ended', npcId: lead.npcId, reason: 'lost' } ] );
		expect( again.companion.active ).toBeNull();

	} );

	it( 'restores a saved leader with its continuity, arriving again, and lets a mismatched one go', () => {

		const game = setup();
		const mira = game.start( 'lead:parcel:p_rest' );
		game.walkBeside( AFTERNOON + 1, () => game.companion.active.phase === 'ready' );
		const saved = game.companion.serialize();
		expect( saved ).toMatchObject( { version: '1', npcId: mira.npcId, kind: 'lead', phase: 'ready', destination: { place: SCENE.place } } );

		const reloaded = setup( {}, null, { simulation: game.bridge.simulation, continuity: game.continuity.serialize() } );
		expect( reloaded.companion.restore( { timeMin: AFTERNOON + 2, state: saved } ) ).toBe( true );
		expect( reloaded.companion.active ).toMatchObject( { npcId: mira.npcId, phase: 'arrived' } );
		const at = reloaded.continuity.companion.position;
		expect( reloaded.frame( AFTERNOON + 2, at ).map( ( signal ) => signal.kind ) ).toEqual( [ 'arrival' ] );

		const other = setup( {}, null, { simulation: game.bridge.simulation, continuity: game.continuity.serialize() } );
		const { version, npcId, startedAtMin } = saved;
		expect( other.companion.restore( { timeMin: AFTERNOON + 2, state: { version, npcId, kind: 'follow', startedAtMin, phase: 'walking' } } ) )
			.toBe( false );
		expect( other.continuity.companion ).toBeNull();
		expect( other.companion.restore( { timeMin: AFTERNOON + 2, state: null } ) ).toBe( false );

	} );

	it( 'lets a restored follower go that neither the save nor a quest escort owns', () => {

		const game = setup();
		const mira = game.start( 'follow' );
		const earlier = { simulation: game.bridge.simulation, continuity: game.continuity.serialize() };

		const orphan = setup( {}, null, earlier );
		expect( orphan.companion.restore( { timeMin: AFTERNOON, state: null } ) ).toBe( false );
		expect( orphan.continuity.companion ).toBeNull();

		const escorted = setup( { escorts: ( npcId ) => npcId === mira.npcId }, null, earlier );
		expect( escorted.companion.restore( { timeMin: AFTERNOON, state: null } ) ).toBe( false );
		expect( escorted.continuity.companion ).toMatchObject( { npcId: mira.npcId, mode: 'following' } );
		expect( escorted.companion.active ).toBeNull();

	} );

} );

describe( 'free time', () => {

	it( 'counts to the commute that ends at work, and to nothing past a day', () => {

		const npc = { routine: [
			{ days: [ 0 ], startMin: 0, endMin: 400, activity: 'sleeping' },
			{ days: [ 0 ], startMin: 400, endMin: 420, activity: 'commuting' },
			{ days: [ 0 ], startMin: 420, endMin: 900, activity: 'working' },
			{ days: [ 0 ], startMin: 900, endMin: 1440, activity: 'leisure' },
			{ days: [ 1, 2, 3, 4, 5, 6 ], startMin: 0, endMin: 1440, activity: 'home' }
		] };
		expect( freeMinutes( npc, 100 ) ).toBe( 300 );
		expect( freeMinutes( npc, 410 ) ).toBe( 0 );
		expect( freeMinutes( npc, 1000 ) ).toBe( Infinity );

	} );

} );

/**
 * The fixture city with one quest place (the clinic) and one staged scene
 * (the restaurant's back room), a continuity over its walk graph, and the
 * companion, optionally restored from an earlier game.
 */
function setup( quests = {}, crowd = null, restored = null ) {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = restored
		? new SimBridge( restoreSimulation( { seed: FIXTURE_BLUEPRINT.meta.seed, blueprint: FIXTURE_BLUEPRINT, networks, interiors: FIXTURE_INTERIORS },
			restored.simulation.serialize() ) )
		: SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const routes = new WalkRoutes( networks );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], heading: 0
	} ) );
	const continuity = new NpcContinuity( { simulation: bridge, routes, places } );
	if ( restored ) continuity.restore( restored.continuity );
	const questPort = {
		holdsCast: vi.fn( () => false ),
		escorts: vi.fn( () => false ),
		places: vi.fn( () => [ { questId: 'main', stepId: 'visit', place: { kind: 'parcel', id: 'p_clinic' } } ] ),
		characterName: vi.fn( () => null ),
		...quests
	};
	const companion = new CompanionGameplay( {
		continuity, sim: bridge, routes, places, atlas: FIXTURE_BLUEPRINT, quests: questPort,
		scenes: () => [ structuredClone( SCENE ) ], crowd
	} );
	const game = {
		bridge, continuity, companion,
		/** The day barista of a venue where they are at `timeMin`, in a chat unless told otherwise. */
		talkTo( venue, timeMin, { conversation = true } = {} ) {

			const npc = bridge.getNPCVendor( { parcelId: venue, timeMin: 9 * 60 } );
			const actor = continuity.appear( { npcId: npc.npcId, timeMin } );
			if ( conversation ) continuity.beginConversation( {
				npcId: npc.npcId, timeMin, position: actor.position, heading: 0, place: actor.place, seated: false
			} );
			return actor;

		},
		/** A request made in the place the person is. */
		ask( { npcId, place }, timeMin = AFTERNOON ) {

			return { npcId, timeMin, playerPlaces: place?.kind === 'parcel' ? [ place ] : [] };

		},
		/** Accepts an offer in the afternoon chat and closes it, holding the body. */
		start( offerId ) {

			const actor = game.talkTo( 'p_cafe', AFTERNOON );
			expect( companion.accept( { ...game.ask( actor ), offerId } ).ok ).toBe( true );
			continuity.endConversation( { timeMin: AFTERNOON, hold: true } );
			expect( game.frame( AFTERNOON, actor.position ).map( ( signal ) => signal.kind ) ).toEqual( [ 'started' ] );
			return actor;

		},
		frame( timeMin, playerPosition, playerPlaces = [] ) {

			continuity.updateFollow( { timeMin, deltaSeconds: 1, playerPosition } );
			return companion.update( { timeMin, playerPosition, playerPlaces } );

		},
		/** Walks a second a frame a step behind the companion until `done`, returning the signals on the way. */
		walkBeside( timeMin, done ) {

			const signals = [];
			for ( let step = 0; step < 1000 && ! done(); step ++ ) {

				const at = continuity.companion.position;
				signals.push( ...game.frame( timeMin, [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ] ) );

			}
			return signals;

		},
		/** Walks the continuity a step behind the leader until it arrives, before the companion sees a frame of it; returns where it stands. */
		arrive( timeMin ) {

			for ( let step = 0; step < 1000 && continuity.companion.phase !== 'arrived'; step ++ ) {

				const at = continuity.companion.position;
				continuity.updateFollow( { timeMin, deltaSeconds: 1, playerPosition: [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ] } );

			}
			expect( continuity.companion.phase ).toBe( 'arrived' );
			return continuity.companion.position;

		}
	};
	return game;

}

/** Every parcel's entrance joined to one raised hub, as the continuity tests walk it. */
function network() {

	const hub = { id: 'hub', x: 500, y: 3, z: 250, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = parcel.access.point;
		nodes.push( { id, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( {
			id: `walk-${parcel.id}`, from: id, to: hub.id, kind: 'access', width: 2,
			path: [ [ x, z ], [ hub.x, hub.z ] ],
			path3: [ [ x, 1, z ], [ ( x + hub.x ) / 2, 7, ( z + hub.z ) / 2 ], [ hub.x, hub.y, hub.z ] ]
		} );

	}
	return {
		walk: { nodes, edges },
		transit: { routes: [ {
			id: 'unused-route', kind: 'bus', lineId: 'unused',
			stops: [
				{ stopId: 'unused-a', x: 5000, y: 0, z: 5000, shapeDist: 0 },
				{ stopId: 'unused-b', x: 5000, y: 0, z: 5000, shapeDist: 1 }
			],
			template: [ { arrive: 0, depart: 0 }, { arrive: 60, depart: 60 } ],
			service: [ { start: 0, end: 86400, headway: 600, phase: 0 } ]
		} ] }
	};

}
