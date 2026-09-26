import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd } from '../agents/Crowd.js';
import { CLIP } from '../agents/CharacterAssets.js';
import { Interactor, pick } from './Interactor.js';

/**
 * The playtest failure this replaces: with a person and a door both in reach,
 * E always took the person and the door became impossible to open. What decides
 * now is where the crosshair points, not who is closer.
 */
it( 'takes whichever target the centre of the screen is on, and the door when the aim is too close to call', () => {

	const eye = new THREE.Vector3( 0, 1.7, 0 );
	const look = new THREE.Vector3( 0, 0, - 1 );
	const door = { center: new THREE.Vector3( 0, 0, - 2 ), open: 0, name: 'BAR' };
	const person = { position: new THREE.Vector3( 0, 0, - 2 ), type: 'shop_clerk' };
	const aside = { ...person, position: new THREE.Vector3( 1.6, 0, - 2 ) };

	expect( pick( eye, look, [ door ], [ aside ] ).kind ).toBe( 'door' );
	expect( pick( eye, look, [ { ...door, center: new THREE.Vector3( 1.6, 0, - 2 ) } ], [ person ] ).kind ).toBe( 'npc' );
	// Somebody standing in the doorway: there is no angle that separates them.
	expect( pick( eye, look, [ door ], [ person ] ).kind ).toBe( 'door' );
	expect( pick( eye, new THREE.Vector3( 1, 0, 0 ), [ door ], [ person ] ) ).toBe( null );

} );

/** Quests and investigations share one crosshair route and both symbolic bindings. */
it( 'offers the quest action when stealing and talking aim at the same person', () => {

	const eye = new THREE.Vector3( 0, 1.7, 0 );
	const person = { position: new THREE.Vector3( 0, 0, - 1.5 ), type: 'security' };
	const look = person.position.clone().add( new THREE.Vector3( 0, 1.3, 0 ) ).sub( eye ).normalize();
	const theft = { kind: 'quest', aim: Math.min( 1, look.dot( look ) ), interaction: { targetKey: 'quest:notes:steal', prompt: 'E  steal the cup notes' } };
	expect( pick( eye, look, [], [ person ], [], [ theft ] ) ).toBe( theft );
	// A less centered quest target cannot steal a deliberately aimed conversation.
	expect( pick( eye, look, [], [ person ], [], [ { ...theft, aim: 0.95 } ] ).kind ).toBe( 'npc' );
	const door = { center: person.position.clone(), open: 0 };
	expect( pick( eye, look, [ door ], [ person ], [], [ theft ] ).kind ).toBe( 'door' );

} );

it( 'offers authored quest and investigation targets through the shared crosshair and forwards E and R exactly', () => {

	const controller = {
		body: { feet: new THREE.Vector3() }, eye: new THREE.Vector3( 0, 1.7, 0 ), look: new THREE.Vector3( 0, 0, - 1 )
	};
	const route = ( kind, targetKey, prompt ) => ( {
		candidates: vi.fn( () => [ { kind, aim: 1, interaction: { targetKey, prompt } } ] ),
		perform: vi.fn( ( request ) => ( { ok: true, ...request } ) )
	} );

	const quests = route( 'quest', 'quest:q:pickup', 'E  take drive   R  read drive' );
	const withQuests = new Interactor( { crowd: { within: () => [] }, doors: [], sim: {}, controller, quests } );
	const state = { playerPlaces: [ { kind: 'parcel', id: 'p9' } ] };

	expect( withQuests.update( 1 / 60, state ) ).toBe( 'E  take drive   R  read drive' );
	expect( quests.candidates ).toHaveBeenCalledWith( state );
	expect( withQuests.activate( CLOCK ) ).toMatchObject( { bindingAction: 'interact' } );
	expect( withQuests.activate( CLOCK, 'secondary-interact' ) ).toMatchObject( { bindingAction: 'secondary-interact' } );
	expect( quests.perform ).toHaveBeenLastCalledWith( {
		targetKey: 'quest:q:pickup', bindingAction: 'secondary-interact', timeMin: CLOCK.timeMin
	} );

	const investigations = route( 'investigation', 'investigation:scene:evidence', 'E  inspect drive   R  take drive' );
	const withEvidence = new Interactor( {
		crowd: { within: () => [] }, doors: [], sim: {}, controller,
		elevators: { panels: () => [] }, quests: null, investigations
	} );
	const frame = { timeMin: 8, playerPlaces: [], feet: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 1.7, z: 0 }, look: { x: 0, y: 0, z: -1 } };

	expect( withEvidence.update( 1 / 60, frame ) ).toBe( 'E  inspect drive   R  take drive' );
	expect( withEvidence.activate( { timeMin: 8 }, 'secondary-interact' ) ).toMatchObject( { ok: true } );
	expect( investigations.perform ).toHaveBeenCalledWith( {
		targetKey: 'investigation:scene:evidence', bindingAction: 'secondary-interact', timeMin: 8
	} );

} );

/**
 * E on a person is the whole talk feature: the prompt names who is in range,
 * the press hands the panel an instantiated NPC, and the second press lets
 * them walk on again.
 */
it( 'prompts by type, hands the panel the instantiated NPC, and closes on the second press', () => {

	const { interactor, crowd, sim, panels } = street();
	const person = [ ...crowd.members.values() ][ 0 ];

	expect( interactor.update( 1 / 60 ) ).toBe( 'E  talk to the shop clerk' );

	interactor.activate( CLOCK );

	expect( panels ).toHaveLength( 1 );
	expect( panels[ 0 ].instance.npcId ).toBe( 'n1' );
	expect( panels[ 0 ].behavior.activity ).toBe( 'commuting' );
	expect( person.frozen ).toBe( true );

	interactor.close( CLOCK );

	expect( panels[ 1 ] ).toBe( null );
	expect( interactor.conversation ).toBe( null );
	expect( person.frozen ).toBe( false );
	expect( sim.resumed ).toEqual( [ 'n1' ] );

} );

it( 'hands the named body to continuity and to animation composition for the conversation', () => {

	let controlled = null;
	const continuity = {
		beginConversation: vi.fn( ( request ) => ( controlled = continuityActor( request, 'conversation', 'idle' ) ) ),
		endConversation: vi.fn( () => ( { ...controlled, mode: 'resuming', animation: 'walk' } ) )
	};
	const animations = { beginConversation: vi.fn(), endConversation: vi.fn() };
	const { interactor, crowd, sim } = street( continuity, animations );
	const person = [ ...crowd.members.values() ][ 0 ];
	const visible = person.position.toArray();

	interactor.update( 1 / 60 );
	interactor.activate( CLOCK );
	const conversation = interactor.conversation;

	expect( continuity.beginConversation ).toHaveBeenCalledWith( expect.objectContaining( {
		npcId: 'n1', timeMin: CLOCK.timeMin, position: visible, place: { kind: 'edge', id: 'e1' }
	} ) );
	expect( animations.beginConversation ).toHaveBeenCalledWith( conversation, controlled );
	expect( person ).toMatchObject( { npcId: 'n1', frozen: true, talking: false, clip: CLIP.IDLE } );
	expect( sim.interrupted ).toEqual( [] );

	interactor.close( { ...CLOCK, timeMin: CLOCK.timeMin + 1 } );

	expect( continuity.endConversation ).toHaveBeenCalledWith( { timeMin: CLOCK.timeMin + 1 } );
	expect( animations.endConversation ).toHaveBeenCalledWith(
		conversation, expect.objectContaining( { npcId: 'n1', mode: 'resuming', animation: 'walk' } )
	);
	expect( person.position.toArray() ).toEqual( visible );
	expect( person ).toMatchObject( { npcId: 'n1', clip: CLIP.WALK, controlMode: 'resuming' } );
	expect( sim.resumed ).toEqual( [] );

} );

it.each( [ false, true ] )( 'opens a late-identified %s seated post on its clicked body instead of its distant canonical body', ( sitting ) => {

	let controlled;
	const continuity = {
		beginConversation: vi.fn( request => ( controlled = continuityActor( request, 'conversation', request.seated ? 'sit' : 'idle' ) ) ),
		endConversation: vi.fn( () => ( { ...controlled, mode: 'schedule' } ) )
	};
	const { interactor, crowd, sim } = street( continuity );
	const clicked = [ ...crowd.members.values() ][ 0 ];
	clicked.position.set( 233.07, 0, 109.56 );
	Object.assign( clicked, { parcelId: 'p14', edge: null, stationary: true, activity: 'working',
		heading: 1.2, clip: sitting ? CLIP.SIT : CLIP.IDLE, spot: sitting ? 'seat:0' : 'counter:0' } );
	const visible = clicked.position.toArray();
	const distant = [ 160.6, 0.15, 44.85 ];
	const canonical = crowd.syncActor( continuityActor( {
		npcId: 'n1', position: distant, heading: 0.4, place: { kind: 'edge', id: 'e1' }
	}, 'resuming', 'walk' ), new THREE.Vector3( ...distant ) );
	canonical.hero = true;
	const focusedPosition = canonical.position;
	interactor.controller.body.feet.copy( clicked.position ).add( new THREE.Vector3( 0, 0, 1.5 ) );
	interactor.controller.eye.copy( interactor.controller.body.feet ).add( new THREE.Vector3( 0, 1.7, 0 ) );
	interactor.update( 0 );
	expect( interactor.target.person ).toBe( clicked );
	interactor.activate( CLOCK );

	expect( continuity.beginConversation ).toHaveBeenCalledWith( {
		npcId: 'n1', timeMin: CLOCK.timeMin, position: visible, place: { kind: 'parcel', id: 'p14' },
		heading: sitting ? 1.2 : 0, seated: sitting, post: { heading: 1.2, spot: clicked.spot }
	} );
	expect( interactor.conversation.person ).toBe( canonical );
	expect( crowd.memberForNpc( 'n1' ) ).toBe( canonical );
	expect( canonical.position ).toBe( focusedPosition );
	expect( canonical.position.toArray() ).toEqual( visible );
	expect( canonical ).toMatchObject( { hero: true, parcelId: 'p14', edge: null, stationary: true,
		spot: clicked.spot, clip: sitting ? CLIP.SIT : CLIP.IDLE, activity: 'working' } );
	expect( crowd.count ).toBe( 1 );
	expect( sim.interrupted ).toEqual( [] );
	interactor.close( CLOCK );
	expect( canonical.position.toArray() ).toEqual( visible );
	expect( crowd.count ).toBe( 1 );

} );

it.each( [ 'following', 'leading', 'posing' ] )( 'does not move a protected %s identity to its newly identified alias', mode => {

	const continuity = { beginConversation: vi.fn() };
	const { interactor, crowd, sim } = street( continuity );
	const clicked = [ ...crowd.members.values() ][ 0 ];
	const distant = [ 160.6, 0.15, 44.85 ];
	const canonical = crowd.syncActor( continuityActor( {
		npcId: 'n1', position: distant, heading: 0.4, place: { kind: 'edge', id: 'e1' }
	}, mode, 'walk' ), new THREE.Vector3( ...distant ) );
	canonical.hero = true;
	interactor.update( 0 );
	expect( interactor.target.person ).toBe( clicked );
	interactor.activate( CLOCK );

	expect( continuity.beginConversation ).not.toHaveBeenCalled();
	expect( interactor.conversation ).toBeNull();
	expect( crowd.memberForNpc( 'n1' ) ).toBe( canonical );
	expect( canonical.position.toArray() ).toEqual( distant );
	expect( canonical ).toMatchObject( { hero: true, controlMode: mode } );
	expect( crowd.count ).toBe( 1 );
	expect( sim.interrupted ).toEqual( [] );

} );

it( 'keeps a quest cast in place after the talk, faces the player throughout, and survives a refusal', () => {

	let controlled = null;
	const continuity = {
		beginConversation: vi.fn( ( request ) => ( controlled = continuityActor( request, 'conversation', 'idle' ) ) ),
		endConversation: vi.fn( () => ( { ...controlled, mode: 'posing', animation: 'idle' } ) )
	};
	const quests = { candidates: () => [], holdsCast: vi.fn( () => true ) };
	const { interactor, crowd } = street( continuity, null );
	interactor.quests = quests;
	const person = [ ...crowd.members.values() ][ 0 ];

	interactor.update( 1 / 60 );
	interactor.activate( CLOCK );
	const facing = person.heading;

	// The player circles them; they keep looking at the player.
	interactor.controller.body.feet.set( person.position.x + 2, person.position.y, person.position.z );
	interactor.update( 1 / 60 );
	expect( person.heading ).not.toBe( facing );
	expect( person.heading ).toBeCloseTo( Math.PI / 2 );

	interactor.close( { ...CLOCK, timeMin: CLOCK.timeMin + 1 } );
	expect( quests.holdsCast ).toHaveBeenCalledWith( 'n1' );
	expect( continuity.endConversation ).toHaveBeenCalledWith( { timeMin: CLOCK.timeMin + 1, hold: true } );

	// A refused conversation costs one press, never the frame.
	const refusing = street( {
		beginConversation: () => { throw new Error( 'someone else has control' ); },
		endConversation: () => { throw new Error( 'no NPC is in conversation' ); }
	}, null );
	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	refusing.interactor.update( 1 / 60 );
	expect( () => refusing.interactor.activate( CLOCK ) ).not.toThrow();
	expect( refusing.interactor.conversation ).toMatchObject( { npcId: 'n1', controlled: false } );
	expect( refusing.sim.interrupted ).toEqual( [ 'n1' ] );
	expect( () => refusing.interactor.close( CLOCK ) ).not.toThrow();
	expect( refusing.sim.resumed ).toEqual( [ 'n1' ] );
	warning.mockRestore();

} );

it( 'opens a conversation with a person by id without aiming, and keeps a person the host keeps where they stand', () => {

	let controlled = null;
	const continuity = {
		beginConversation: vi.fn( ( request ) => ( controlled = continuityActor( request, 'conversation', 'idle' ) ) ),
		endConversation: vi.fn( () => ( { ...controlled, mode: 'posing', animation: 'idle' } ) )
	};
	const { interactor, crowd, panels } = street( continuity );
	interactor.update( 1 / 60 );
	interactor.activate( CLOCK );
	interactor.close( CLOCK );
	expect( continuity.endConversation ).toHaveBeenLastCalledWith( { timeMin: CLOCK.timeMin } );

	// The player looks away: nobody is aimed at, and the host opens the talk.
	interactor.controller.look.set( 0, 0, 1 );
	interactor.update( 1 / 60 );
	expect( interactor.target ).toBeNull();
	const conversation = interactor.talkTo( 'n1', CLOCK );
	expect( conversation ).toMatchObject( { npcId: 'n1', controlled: true } );
	expect( panels.at( - 1 ) ).toBe( conversation );
	expect( interactor.talkTo( 'n1', CLOCK ) ).toBeNull();

	interactor.close( CLOCK, 'player-left', { keep: true } );
	expect( continuity.endConversation ).toHaveBeenLastCalledWith( { timeMin: CLOCK.timeMin, hold: true } );
	expect( interactor.talkTo( 'n2', CLOCK ) ).toBeNull();
	crowd.memberForNpc( 'n1' ).retiring = true;
	expect( interactor.talkTo( 'n1', CLOCK ) ).toBeNull();
	crowd.memberForNpc( 'n1' ).retiring = false;
	crowd.memberForNpc( 'n1' ).fallen = true;
	expect( interactor.talkTo( 'n1', CLOCK ) ).toBeNull();
	expect( continuity.beginConversation ).toHaveBeenCalledTimes( 2 );

} );

const CLOCK = { timeMin: 780, daySeconds: 46800 };

/**
 * A walker outlives the trip they were sampled on: the next refresh hands the
 * same body a later handle and it walks on in the look it had. Talking to it
 * must establish the person in that look, whether its handle still answers or
 * the crowd has to find it another one.
 */
it.each( [ 'its own handle', 'a handle the crowd finds' ] )( 'names a re-handled walker in the look it walks in, through %s', ( route ) => {

	const trip = ( crowdId, appearanceSeed, fields = {} ) => ( {
		crowdId, type: 'shop_clerk', gender: 'female', appearanceSeed, activity: 'commuting',
		place: { kind: 'edge', id: 'e1' }, progress: 0.5, direction: 1, ...fields
	} );
	const byEdge = new Map( [ [ 'e1', [ trip( 'trip-1', 123 ) ] ], [ 'e2', [] ] ] );
	const sim = establishing( byEdge );
	const { interactor, crowd } = street( null, null, sim );
	const body = [ ...crowd.members.values() ][ 0 ];

	byEdge.set( 'e1', [ trip( 'trip-2', 456 ) ] );
	crowd.update( 3, new THREE.Vector3(), CLOCK );
	expect( body ).toMatchObject( { crowdId: 'trip-2', appearanceSeed: 123 } );
	const walked = { variant: body.variant, gender: body.gender, look: body.look };
	if ( route === 'a handle the crowd finds' ) {

		// trip-2 is over before the next refresh; the street now holds an
		// established person, a man and one free woman.
		byEdge.set( 'e1', [ trip( 'known', 9, { npcId: 'n0' } ), trip( 'his', 8, { gender: 'male' } ), trip( 'hers', 789 ) ] );

	}

	// The walk carried them past the crosshair; the press is on them.
	interactor.target = { kind: 'npc', person: body };
	interactor.activate( CLOCK );

	const handle = route === 'its own handle' ? 'trip-2' : 'hers';
	expect( sim.instantiated ).toEqual( [ ...( handle === 'hers' ? [ [ 'trip-2', CLOCK.timeMin, 123 ] ] : [] ), [ handle, CLOCK.timeMin, 123 ] ] );
	expect( interactor.conversation.person ).toBe( body );
	expect( body ).toMatchObject( { crowdId: handle, npcId: 'n1', appearanceSeed: 123, ...walked } );
	expect( body.look ).toBe( walked.look );

	interactor.close( CLOCK );
	crowd.update( 3, new THREE.Vector3(), CLOCK );
	expect( crowd.memberForNpc( 'n1' ) ).toBe( body );
	expect( body.look ).toBe( walked.look );

} );

it( 'talks to a stress copy and to somebody retiring as nobody, and gives neither an identity', () => {

	const sim = establishing( new Map( [ [ 'e1', [ { ...AGENT, gender: 'female', appearanceSeed: 5 } ] ], [ 'e2', [] ] ] ) );
	const { interactor, crowd } = street( null, null, sim, { stress: 1, capacity: 4 } );
	const [ walker, copy ] = [ ...crowd.members.values() ];
	expect( copy ).toMatchObject( { copy: true, crowdId: null } );

	sim.agents.length = 0;
	crowd.update( 3, new THREE.Vector3(), CLOCK );
	expect( walker ).toMatchObject( { retiring: true, crowdId: null } );

	for ( const person of [ copy, walker ] ) {

		const seed = person.appearanceSeed;
		interactor.target = { kind: 'npc', person };
		interactor.activate( CLOCK );
		expect( interactor.conversation ).toMatchObject( { person, npcId: null, instance: null } );
		interactor.close( CLOCK );
		expect( person ).toMatchObject( { npcId: null, crowdId: null, appearanceSeed: seed, frozen: false } );

	}
	expect( sim.instantiated ).toEqual( [] );

} );

it( 'keeps a seated speaker aligned with their furniture while the player circles the chair', () => {

	let controlled;
	const continuity = {
		beginConversation: vi.fn( ( request ) => ( controlled = continuityActor( request, 'conversation', 'sit' ) ) ),
		endConversation: vi.fn( () => ( { ...controlled, mode: 'posing', animation: 'sit' } ) )
	};
	const { interactor, crowd } = street( continuity );
	const person = [ ...crowd.members.values() ][ 0 ];
	person.clip = CLIP.SIT;
	person.heading = Math.PI;
	const position = person.position.toArray();
	interactor.quests = { candidates: () => [], holdsCast: () => true };
	interactor.update( 1 / 60 );
	interactor.activate( CLOCK );
	expect( continuity.beginConversation ).toHaveBeenCalledWith( expect.objectContaining( { seated: true, heading: Math.PI } ) );
	for ( const offset of [ [ 2, 0 ], [ 0, - 2 ], [ - 2, 0 ] ] ) {

		interactor.controller.body.feet.set( person.position.x + offset[ 0 ], person.position.y, person.position.z + offset[ 1 ] );
		interactor.update( 1 / 60 );
		expect( person.heading ).toBe( Math.PI );
		expect( person.position.toArray() ).toEqual( position );

	}
	interactor.close( CLOCK );
	expect( person.heading ).toBe( Math.PI );

} );

/** One walker on one edge, with the player standing on top of them. */
function street( continuity = null, animations = null, sim = simulation( new Map( [ [ 'e1', [ { ...AGENT } ] ], [ 'e2', [] ] ] ) ), options = {} ) {

	const crowd = new Crowd( {
		assets: { variants: [ {}, {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
		routes: routes(), signals: { green: () => true }, sim,
		places: new Map(), capacity: 4, ...options
	} );

	crowd.update( 1 / 60, new THREE.Vector3(), CLOCK );

	// Standing a pace back from the walker with the crosshair on them.
	const feet = ( [ ...crowd.members.values() ][ 0 ]?.position.clone() ?? new THREE.Vector3() )
		.add( new THREE.Vector3( 0, 0, 1.5 ) );
	const panels = [];
	const interactor = new Interactor( {
		crowd, doors: [], sim, continuity, animations,
		controller: {
			body: { feet },
			forward: new THREE.Vector3( 0, 0, - 1 ),
			look: new THREE.Vector3( 0, 0, - 1 ),
			eye: feet.clone().setY( feet.y + 1.7 )
		}
	} );
	interactor.onConversation = ( conversation ) => panels.push( conversation );

	return { interactor, crowd, sim, panels };

}

const AGENT = {
	crowdId: 'c|edge|e1|0|390', type: 'shop_clerk', activity: 'commuting',
	place: { kind: 'edge', id: 'e1' }, progress: 0.5, direction: 1
};

const EDGE = { id: 'e1', from: 'n0', to: 'n1', kind: 'sidewalk', signal: null, length: 40, mid: [ 0, 0 ] };
/** The next stretch of the same street, inside talk's widening reach. */
const NEIGHBOUR = { ...EDGE, id: 'e2', mid: [ 20, 0 ] };

function routes() {

	return {
		edges: new Map( [ [ EDGE.id, EDGE ], [ NEIGHBOUR.id, NEIGHBOUR ] ] ),
		near: () => [ EDGE, NEIGHBOUR ],
		project: () => ( { edge: EDGE, distance: EDGE.length / 2 } ),
		pointAt: ( edge, distance ) => ( { x: distance, y: 0, z: 0, heading: 0 } ),
		exitNode: () => 'n1',
		nextFrom: () => ( { edge: EDGE, direction: 1 } )
	};

}

/** Answers per walk edge, and instantiates only handles it currently reports. */
function simulation( byEdge ) {

	const instantiated = [];
	const resumed = [];
	const interrupted = [];
	const all = () => [ ...byEdge.values() ].flat();

	const sim = {
		agents: byEdge.get( 'e1' ),
		neighbour: byEdge.get( 'e2' ),
		instantiated,
		resumed,
		interrupted,
		npcIds: [ 'n1', 'n2' ],
		// The pavement here is short, so a radius scope sees everyone on it.
		crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'radius' ? all() : byEdge.get( scope.id ) ?? [] } ),
		instantiate: ( crowdId ) => {

			const slot = all().findIndex( ( agent ) => agent.crowdId === crowdId );

			if ( slot < 0 ) return null;

			instantiated.push( crowdId );

			return { npcId: sim.npcIds[ slot ], type: 'shop_clerk' };

		},
		behaviorAt: () => ( { activity: 'commuting', mode: 'street', place: { kind: 'edge', id: 'e1' } } ),
		getNPC: ( npcId ) => ( {
			npcId, name: { given: 'Mina', family: 'Costa' }, type: 'shop_clerk', gender: 'female', appearanceSeed: 33
		} ),
		interrupt: ( npcId ) => interrupted.push( npcId ),
		resume: ( npcId ) => resumed.push( npcId )
	};

	return sim;

}

/**
 * The simulation's crowd establishment as the talk sees it through SimBridge:
 * a handle it reports becomes a new person of the handle's type and gender in
 * the hinted seed, a bound handle stays that person, and samples name bound
 * handles with the person's own seed.
 */
function establishing( byEdge ) {

	const people = new Map();
	const bound = new Map();
	const instantiated = [];
	const named = ( agent ) => bound.has( agent.crowdId )
		? { ...agent, npcId: bound.get( agent.crowdId ), appearanceSeed: people.get( bound.get( agent.crowdId ) ).appearanceSeed } : agent;

	return {
		agents: byEdge.get( 'e1' ),
		instantiated,
		crowd: ( timeMin, scope ) => ( {
			agents: ( scope.kind === 'radius' ? [ ...byEdge.values() ].flat() : byEdge.get( scope.id ) ?? [] ).map( named )
		} ),
		instantiate: ( crowdId, timeMin, appearanceSeed ) => {

			instantiated.push( [ crowdId, timeMin, appearanceSeed ] );
			if ( bound.has( crowdId ) ) return people.get( bound.get( crowdId ) );
			const agent = [ ...byEdge.values() ].flat().find( ( candidate ) => candidate.crowdId === crowdId && ! candidate.npcId );
			if ( ! agent ) return null;
			const npc = {
				npcId: `n${people.size + 1}`, name: { given: 'Mina', family: 'Costa' },
				type: agent.type, gender: agent.gender, appearanceSeed: appearanceSeed ?? agent.appearanceSeed
			};
			people.set( npc.npcId, npc );
			bound.set( crowdId, npc.npcId );
			return npc;

		},
		getNPC: ( npcId ) => people.get( npcId ),
		behaviorAt: () => null,
		interrupt: () => {},
		resume: () => {}
	};

}

function continuityActor( request, mode, animation ) {

	return {
		npcId: request.npcId,
		name: { given: 'Mina', family: 'Costa' },
		type: 'shop_clerk',
		gender: 'female',
		appearanceSeed: 33,
		place: request.place,
		position: request.position,
		heading: request.heading,
		animation,
		mode,
		schedule: { activity: 'commuting', progress: 0.5, nextDestination: { kind: 'parcel', id: 'p9' } },
		visible: true
	};

}

it( 'puts down an authored source that throws and keeps answering the rest of the frame', () => {

	const controller = {
		body: { feet: new THREE.Vector3() }, eye: new THREE.Vector3( 0, 1.7, 0 ), look: new THREE.Vector3( 0, 0, - 1 )
	};
	const broken = { candidates: vi.fn( () => { throw new Error( 'gameplay-frame does not match its schema' ); } ) };
	const quests = { candidates: vi.fn( () => [ { kind: 'quest', aim: 1, interaction: { targetKey: 'quest:q:pickup', prompt: 'E  take drive' } } ] ) };
	const error = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	const interactor = new Interactor( { crowd: { within: () => [] }, doors: [], sim: {}, controller, quests, investigations: broken } );

	expect( interactor.update( 1 / 60, { playerPlaces: [ { kind: 'station', id: 's1' } ] } ) ).toBe( 'E  take drive' );
	expect( interactor.update( 1 / 60, { playerPlaces: [] } ) ).toBe( 'E  take drive' );
	expect( broken.candidates ).toHaveBeenCalledTimes( 1 );
	expect( error ).toHaveBeenCalledTimes( 1 );
	error.mockRestore();

} );
