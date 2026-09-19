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

const CLOCK = { timeMin: 780, daySeconds: 46800 };

/** One walker on one edge, with the player standing on top of them. */
function street( continuity = null, animations = null ) {

	const sim = simulation( new Map( [ [ 'e1', [ { ...AGENT } ] ], [ 'e2', [] ] ] ) );
	const crowd = new Crowd( {
		assets: { variants: [ {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
		routes: routes(), signals: { green: () => true }, sim,
		places: new Map(), capacity: 4
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
