import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd } from '../agents/Crowd.js';
import { Interactor } from './Interactor.js';

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

} );

const CLOCK = { timeMin: 780, daySeconds: 46800 };

/** One walker on one edge, with the player standing on top of them. */
function street() {

	const sim = simulation( new Map( [ [ 'e1', [ { ...AGENT } ] ], [ 'e2', [] ] ] ) );
	const crowd = new Crowd( {
		assets: { variants: [ {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
		routes: routes(), signals: { green: () => true }, sim,
		places: new Map(), capacity: 4
	} );

	crowd.update( 1 / 60, new THREE.Vector3(), CLOCK );

	const feet = [ ...crowd.members.values() ][ 0 ]?.position.clone() ?? new THREE.Vector3();
	const panels = [];
	const interactor = new Interactor( {
		crowd, doors: [], sim,
		controller: { body: { feet }, forward: new THREE.Vector3( 0, 0, - 1 ) }
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
		pointAt: ( edge, distance ) => ( { x: distance, z: 0, heading: 0 } ),
		exitNode: () => 'n1',
		nextFrom: () => ( { edge: EDGE, direction: 1 } )
	};

}

/** Answers per walk edge, and instantiates only handles it currently reports. */
function simulation( byEdge ) {

	const instantiated = [];
	const resumed = [];
	const all = () => [ ...byEdge.values() ].flat();

	const sim = {
		agents: byEdge.get( 'e1' ),
		neighbour: byEdge.get( 'e2' ),
		instantiated,
		resumed,
		npcIds: [ 'n1', 'n2' ],
		crowd: ( timeMin, scope ) => ( { agents: byEdge.get( scope.id ) ?? [] } ),
		instantiate: ( crowdId ) => {

			const slot = all().findIndex( ( agent ) => agent.crowdId === crowdId );

			if ( slot < 0 ) return null;

			instantiated.push( crowdId );

			return { npcId: sim.npcIds[ slot ], type: 'shop_clerk' };

		},
		behaviorAt: () => ( { activity: 'commuting', mode: 'street', place: { kind: 'edge', id: 'e1' } } ),
		interrupt: () => {},
		resume: ( npcId ) => resumed.push( npcId )
	};

	return sim;

}
