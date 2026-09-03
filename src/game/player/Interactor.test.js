import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd } from '../agents/Crowd.js';
import { CLIP } from '../agents/CharacterAssets.js';
import { Interactor, pick } from './Interactor.js';

/**
 * The playtest failure this replaces: with a person and a door both in reach,
 * E always took the person and the door became impossible to open. What decides
 * now is where the crosshair points, not who is closer.
 */
describe( 'the crosshair picks the target', () => {

	const eye = new THREE.Vector3( 0, 1.7, 0 );
	const look = new THREE.Vector3( 0, 0, - 1 );
	const door = { center: new THREE.Vector3( 0, 0, - 2 ), open: 0, name: 'BAR' };
	const person = { position: new THREE.Vector3( 0, 0, - 2 ), type: 'shop_clerk' };

	it( 'takes whichever one the centre of the screen is on', () => {

		const aside = { ...person, position: new THREE.Vector3( 1.6, 0, - 2 ) };

		expect( pick( eye, look, [ door ], [ aside ] ).kind ).toBe( 'door' );
		expect( pick( eye, look, [ { ...door, center: new THREE.Vector3( 1.6, 0, - 2 ) } ], [ person ] ).kind ).toBe( 'npc' );

	} );

	it( 'gives an aim too close to call to the door', () => {

		// Somebody standing in the doorway: there is no angle that separates them.
		expect( pick( eye, look, [ door ], [ person ] ).kind ).toBe( 'door' );

	} );

	it( 'takes nothing when the crosshair is on neither', () => {

		expect( pick( eye, new THREE.Vector3( 1, 0, 0 ), [ door ], [ person ] ) ).toBe( null );

	} );

} );

describe( 'investigation interaction routing', () => {

	it( 'offers authored evidence through the shared crosshair and forwards E and R exactly', () => {

		const investigations = {
			candidates: vi.fn( () => [ {
				kind: 'investigation', aim: 1,
				interaction: { targetKey: 'investigation:scene:evidence', prompt: 'E  inspect drive   R  take drive' }
			} ] ),
			perform: vi.fn( ( request ) => ( { ok: true, ...request } ) )
		};
		const controller = {
			eye: new THREE.Vector3( 0, 1.7, 0 ), look: new THREE.Vector3( 0, 0, -1 ),
			body: { feet: new THREE.Vector3() }
		};
		const interactor = new Interactor( {
			crowd: { within: () => [] }, doors: [], sim: {}, controller,
			elevators: { panels: () => [] }, quests: null, investigations
		} );
		const frame = { timeMin: 8, playerPlaces: [], feet: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 1.7, z: 0 }, look: { x: 0, y: 0, z: -1 } };

		expect( interactor.update( 1 / 60, frame ) ).toBe( 'E  inspect drive   R  take drive' );
		expect( interactor.activate( { timeMin: 8 }, 'secondary-interact' ) ).toMatchObject( { ok: true, bindingAction: 'secondary-interact' } );
		expect( investigations.perform ).toHaveBeenCalledWith( {
			targetKey: 'investigation:scene:evidence', bindingAction: 'secondary-interact', timeMin: 8
		} );

	} );

} );

/**
 * E on a person is the whole talk feature, so what it has to keep is the
 * promise the game contract makes: the prompt names who is in range, and the
 * press hands the panel a payload. A street crowd handle only answers for the
 * epoch it was sampled in, and people outlive that on the pavement, so the
 * press must resolve a live handle rather than fall through the stale one.
 */
describe( 'E on an NPC', () => {

	it( 'prompts by type and hands the panel the instantiated NPC', () => {

		const { interactor, crowd, panels } = street();
		const person = [ ...crowd.members.values() ][ 0 ];

		expect( interactor.update( 1 / 60 ) ).toBe( 'E  talk to the shop clerk' );

		interactor.activate( CLOCK );

		expect( panels ).toHaveLength( 1 );
		expect( panels[ 0 ].instance.npcId ).toBe( 'n1' );
		expect( panels[ 0 ].behavior.activity ).toBe( 'commuting' );
		expect( person.frozen ).toBe( true );

	} );

	it( 'opens the panel on a handle that went stale under the walker', () => {

		const { interactor, crowd, sim, panels } = street();
		const person = [ ...crowd.members.values() ][ 0 ];
		// the pavement has moved on to a new sampling epoch
		person.crowdId = 'c|edge|e1|0|100';

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );

		expect( sim.instantiated ).toEqual( [ 'c|edge|e1|0|390' ] );
		expect( panels[ 0 ].instance.npcId ).toBe( 'n1' );

	} );

	it( 'names a walker who wandered onto a stretch the simulation keeps empty', () => {

		const { interactor, sim, panels } = street();
		// they walked off the sampled pavement; the next stretch is populated
		sim.neighbour.push( { ...AGENT, crowdId: 'c|edge|e2|0|390', place: { kind: 'edge', id: 'e2' } } );
		sim.agents.length = 0;

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );

		expect( panels[ 0 ].instance.npcId ).toBe( 'n1' );

	} );

	it( 'still opens the panel when the simulation has nobody out on that street', () => {

		const { interactor, sim, panels } = street();
		sim.agents.length = 0;

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );

		expect( panels ).toHaveLength( 1 );
		expect( panels[ 0 ].instance ).toBe( null );

	} );

	it( 'never hands two people in reach the same NPC', () => {

		const { interactor, crowd, sim, panels } = street();
		sim.agents.push( { ...AGENT, crowdId: 'c|edge|e1|1|390', progress: 0.51 } );
		sim.npcIds = [ 'n1', 'n2' ];

		// a second walker on the same pavement, both handles a stale epoch old
		const [ first ] = crowd.members.values();
		crowd.members.set( 'twin', { ...first, id: 'twin', crowdId: 'c|edge|e1|1|100', position: first.position.clone() } );
		first.crowdId = 'c|edge|e1|0|100';

		for ( const person of crowd.members.values() ) {

			interactor.target = { kind: 'npc', person };
			interactor.activate( CLOCK );
			interactor.close( CLOCK );

		}

		expect( panels.filter( Boolean ).map( ( p ) => p.npcId ) ).toEqual( [ 'n1', 'n2' ] );

	} );

	it( 'closes on the second press and lets the person walk on', () => {

		const { interactor, crowd, sim, panels } = street();
		const person = [ ...crowd.members.values() ][ 0 ];

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );
		interactor.close( CLOCK );

		expect( panels[ 1 ] ).toBe( null );
		expect( interactor.conversation ).toBe( null );
		expect( person.frozen ).toBe( false );
		expect( sim.resumed ).toEqual( [ 'n1' ] );

	} );

	it( 'hands a named body to continuity for conversation and resumes it from the visible position', () => {

		let actor = null;
		const continuity = {
			beginConversation: vi.fn( ( request ) => ( actor = continuityActor( request, 'conversation', 'idle' ) ) ),
			endConversation: vi.fn( ( request ) => ( {
				...actor, mode: 'resuming', animation: 'walk', schedule: { ...actor.schedule, progress: request.timeMin / 1000 }
			} ) )
		};
		const { interactor, crowd, sim } = street( continuity );
		const person = [ ...crowd.members.values() ][ 0 ];
		const visible = person.position.toArray();

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );

		expect( continuity.beginConversation ).toHaveBeenCalledWith( expect.objectContaining( {
			npcId: 'n1', timeMin: CLOCK.timeMin, position: visible, place: { kind: 'edge', id: 'e1' }
		} ) );
		expect( person ).toMatchObject( { npcId: 'n1', frozen: true, talking: true, clip: CLIP.TALK } );
		expect( sim.interrupted ).toEqual( [] );

		interactor.close( { ...CLOCK, timeMin: CLOCK.timeMin + 1 } );
		expect( continuity.endConversation ).toHaveBeenCalledWith( { timeMin: CLOCK.timeMin + 1 } );
		expect( person.position.toArray() ).toEqual( visible );
		expect( person ).toMatchObject( { npcId: 'n1', frozen: true, talking: false, clip: CLIP.WALK, controlMode: 'resuming' } );
		expect( sim.resumed ).toEqual( [] );

	} );

	it( 'hands the exact controlled actor lifecycle to gameplay animation composition', () => {

		let controlled = null;
		const continuity = {
			beginConversation: vi.fn( ( request ) => ( controlled = continuityActor( request, 'conversation', 'idle' ) ) ),
			endConversation: vi.fn( () => ( { ...controlled, mode: 'resuming', animation: 'walk' } ) )
		};
		const animations = { beginConversation: vi.fn(), endConversation: vi.fn() };
		const { interactor } = street( continuity, animations );

		interactor.update( 1 / 60 );
		interactor.activate( CLOCK );
		const conversation = interactor.conversation;
		expect( animations.beginConversation ).toHaveBeenCalledWith( conversation, controlled );

		interactor.close( CLOCK );
		expect( animations.endConversation ).toHaveBeenCalledWith(
			conversation, expect.objectContaining( { npcId: 'n1', mode: 'resuming', animation: 'walk' } )
		);

	} );

} );

describe( 'cast quest NPC bodies', () => {

	it( 'resolves the exact cast NPC from nearby matching crowd handles', () => {

		const { crowd, sim } = street();
		sim.getNPC = () => ( { npcId: 'n1', type: 'shop_clerk', gender: 'female' } );
		const player = [ ...crowd.members.values() ][ 0 ].position.clone();
		const member = crowd.questMember( 'n1', CLOCK.timeMin, player, { kind: 'edge', id: 'e1' } );

		expect( member.npcId ).toBe( 'n1' );
		expect( member.instance.npcId ).toBe( 'n1' );
		expect( sim.instantiated ).toEqual( [ 'c|edge|e1|0|390' ] );

	} );

	it( 'posts the actual cast NPC at a nearby parcel anchor when the regular sample omitted them', () => {

		const sim = {
			crowd: () => ( { agents: [] } ),
			getNPC: () => ( { npcId: 'cast-guard', type: 'quest_security', gender: 'male' } ),
			instantiate: () => null
		};
		const inside = new THREE.Vector3( 4, 0.12, 5 );
		const crowd = new Crowd( {
			assets: { variants: [ {} ], durations: [ 1 ], meshesOf: () => [] },
			routes: routes(), signals: { green: () => true }, sim,
			places: new Map( [ [ 'p9', { inside, heading: 0, anchors: {} } ] ] ), capacity: 1
		} );
		crowd.members.set( 'ambient', { id: 'ambient', position: inside.clone().add( new THREE.Vector3( 5, 0, 0 ) ), npcId: null } );
		const member = crowd.questMember( 'cast-guard', CLOCK.timeMin, inside, { kind: 'parcel', id: 'p9' } );

		expect( member ).toMatchObject( { npcId: 'cast-guard', parcelId: 'p9', quest: true, stationary: true } );
		expect( member.instance.npcId ).toBe( 'cast-guard' );
		expect( member.position.distanceTo( inside ) ).toBeCloseTo( 0.8 );
		expect( crowd.members.size ).toBe( 1 );
		expect( crowd.members.has( 'ambient' ) ).toBe( false );

	} );

	it( 'keeps one deterministic quest body on the exact published walk edge', () => {

		const sim = {
			crowd: () => ( { agents: [] } ),
			getNPC: () => ( { npcId: 'cast-edge', type: 'quest_security', gender: 'male' } ),
			instantiate: () => null
		};
		const crowd = new Crowd( {
			assets: { variants: [ {} ], durations: [ 1 ], meshesOf: () => [] },
			routes: routes(), signals: { green: () => true }, sim, places: new Map(), capacity: 2
		} );
		const player = new THREE.Vector3( 20, 0, 0 );
		const first = crowd.questMember( 'cast-edge', CLOCK.timeMin, player, { kind: 'edge', id: 'e1' } );
		const second = crowd.questMember( 'cast-edge', CLOCK.timeMin, player, { kind: 'edge', id: 'e1' } );

		expect( second ).toBe( first );
		expect( first.edge.id ).toBe( 'e1' );
		expect( crowd.members.size ).toBe( 1 );

	} );

} );

describe( 'shared quest interaction route', () => {

	it( 'shows the centered quest prompt and dispatches both symbolic bindings without changing NPC talk', () => {

		const calls = [];
		const quests = {
			candidates: vi.fn( () => [ {
				kind: 'quest', aim: 1,
				interaction: { targetKey: 'quest:q:pickup', prompt: 'E  take drive   R  read drive' }
			} ] ),
			perform: vi.fn( ( request ) => {

				calls.push( request );
				return { ok: true, action: request.bindingAction };

			} )
		};
		const interactor = new Interactor( {
			crowd: { within: () => [] }, doors: [], sim: {}, quests,
			controller: {
				body: { feet: new THREE.Vector3() }, eye: new THREE.Vector3( 0, 1.7, 0 ), look: new THREE.Vector3( 0, 0, - 1 )
			}
		} );
		const state = { playerPlaces: [ { kind: 'parcel', id: 'p9' } ] };

		expect( interactor.update( 1 / 60, state ) ).toBe( 'E  take drive   R  read drive' );
		expect( quests.candidates ).toHaveBeenCalledWith( state );
		expect( interactor.activate( CLOCK ) ).toMatchObject( { action: 'interact' } );
		expect( interactor.activate( CLOCK, 'secondary-interact' ) ).toMatchObject( { action: 'secondary-interact' } );
		expect( calls ).toEqual( [
			{ targetKey: 'quest:q:pickup', bindingAction: 'interact', timeMin: CLOCK.timeMin },
			{ targetKey: 'quest:q:pickup', bindingAction: 'secondary-interact', timeMin: CLOCK.timeMin }
		] );

	} );

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
