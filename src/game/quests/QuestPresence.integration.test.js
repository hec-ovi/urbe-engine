import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { Crowd } from '../agents/Crowd.js';
import { NpcContinuity } from '../agents/NpcContinuity.js';
import { WalkRoutes } from '../agents/WalkRoutes.js';
import { QuestSession } from './QuestSession.js';
import { QuestGameplay } from './QuestGameplay.js';
import { Interactor } from '../player/Interactor.js';
import { TalkClient } from '../talk/TalkClient.js';
import { npcProfile } from '../../ui/widgets/NpcProfile.js';
import { quest, role, step } from './quest.test-fixtures.js';

const TIME = 600;
const VENUE = 'p_rest';
const POINT = [ 355, 0.02, 250 ];
const PARCEL = { kind: 'parcel', id: VENUE };

describe( 'authored quest appointments with the real population and rendered crowd', () => {

	it( 'uses the authored character name in the objective, E prompt and dialogue without renaming the person or bystanders', () => {

		const definition = definitions()[ 0 ];
		definition.roles[ 0 ].characterName = { given: 'Petra', family: 'Moss' };
		definition.steps[ 0 ].narrative.playerHint = 'Hear Petra out about her brother.';
		const { session, gameplay, crowd, continuity, sim } = setup( [ definition ] );
		gameplay.candidates( frame() );
		const npcId = session.entries[ 0 ].runtime.cast.a;
		const body = crowd.memberForNpc( npcId );
		const originalName = { ...sim.getNPC( npcId ).name };
		const feet = body.position.clone().add( new THREE.Vector3( 0, 0, 1.5 ) );
		const eye = feet.clone().add( new THREE.Vector3( 0, 1.7, 0 ) );
		const look = body.position.clone().add( new THREE.Vector3( 0, 1.3, 0 ) ).sub( eye ).normalize();
		const interaction = new Interactor( {
			crowd, doors: [], sim, continuity, quests: gameplay,
			controller: { body: { feet }, eye, look }
		} );

		expect( session.view( TIME )[ 0 ].steps[ 0 ] ).toMatchObject( { text: 'Hear Petra out about her brother.', npcName: 'Petra Moss' } );
		expect( interaction.update( 0, { ...frame(), feet: vector( feet.toArray() ), eye: vector( eye.toArray() ), look: vector( look.toArray() ) } ) ).toBe( 'E  talk to Petra' );
		interaction.activate( { timeMin: TIME } );
		expect( npcProfile( interaction.conversation ).name ).toBe( 'Petra Moss' );
		expect( TalkClient.nameOf( interaction.conversation.instance ) ).toBe( 'Petra Moss' );
		expect( interaction.conversation.npcId ).toBe( npcId );
		expect( body.instance.name ).toEqual( originalName );
		expect( sim.getNPC( npcId ).name ).toEqual( originalName );
		const bystander = sim.findNPCs( { type: 'barista' } ).find( ( person ) => person.npcId !== npcId );
		expect( session.characterName( bystander.npcId ) ).toBeNull();

	} );

	it( 'posts the exact off-site cast, survives schedule updates and save/restore, then advances only the selected conversation', () => {

		const first = setup( definitions() );
		const { session, gameplay, crowd, continuity, sim } = first;
		const cast = session.entries[ 0 ].runtime.cast;
		expect( session.blocked ).toEqual( [] );
		expect( sim.behaviorAt( cast.a, TIME ).place.id ).not.toBe( VENUE );
		expect( session.entries[ 0 ].runtime.stepAvailability( 'talk', TIME ).available ).toBe( false );
		// A body is only posted near the actual destination.
		gameplay.candidates( frame( TIME, [ 0, 0, 0 ] ) );
		expect( crowd.memberForNpc( cast.a ) ).toBeNull();

		gameplay.candidates( frame() );
		const body = crowd.memberForNpc( cast.a );
		expect( body ).toMatchObject( { npcId: cast.a, parcelId: VENUE, controlMode: 'posing', spot: 'meeting:0' } );
		expect( continuity.heldNpcIds ).toContain( cast.a );
		expect( gameplay.places( TIME )[ 0 ].availability ).toEqual( { available: true } );
		const position = body.position.toArray();
		for ( const actor of continuity.updateVisible( { timeMin: TIME + 120, playerPosition: POINT, maxDistance: 100 } ) ) {
			crowd.syncActor( actor, new THREE.Vector3( ...POINT ) );
		}
		expect( crowd.memberForNpc( cast.a ).position.toArray() ).toEqual( position );
		expect( crowd.memberForNpc( cast.a ).spot ).toBe( 'meeting:0' );

		const restored = setup( definitions(), {
			simulation: sim.serialize(), progress: session.persistenceView( TIME + 120 ), continuity: continuity.serialize()
		} );
		restored.gameplay.candidates( frame( TIME + 120 ) );
		expect( restored.crowd.memberForNpc( cast.a ) ).toMatchObject( { npcId: cast.a, parcelId: VENUE, controlMode: 'posing' } );
		expect( restored.session.advanceFor( 'main', { kind: 'talkedTo', npcId: cast.a }, TIME + 120 ) ).toHaveLength( 1 );
		expect( restored.session.entries[ 0 ].runtime.status() ).toBe( 'completed' );
		expect( restored.session.entries[ 1 ].runtime.status() ).toBe( 'active' );

	} );

	it( 'brings both people to a listening appointment without sharing an anchor and accepts its measured interaction', () => {

		const { session, gameplay, crowd, continuity } = setup( definitions().slice( 1 ) );
		const cast = session.entries[ 0 ].runtime.cast;
		expect( cast.a ).not.toBe( cast.b );
		expect( session.entries[ 0 ].runtime.windows( 'listen' ) ).toEqual( [] );
		const candidates = gameplay.candidates( frame() );
		const people = [ cast.a, cast.b ].map( ( npcId ) => crowd.memberForNpc( npcId ) );
		expect( people.every( ( body ) => body?.parcelId === VENUE ) ).toBe( true );
		expect( new Set( people.map( ( body ) => body.spot ) ).size ).toBe( 2 );
		expect( people[ 0 ].position.distanceTo( people[ 1 ].position ) ).toBeGreaterThan( 0.6 );
		expect( continuity.heldNpcIds.sort() ).toEqual( [ cast.a, cast.b ].sort() );
		expect( candidates ).toHaveLength( 1 );
		const result = gameplay.perform( { targetKey: candidates[ 0 ].interaction.targetKey, bindingAction: 'interact', timeMin: TIME } );
		expect( result ).toMatchObject( { ok: true, progressed: true } );
		expect( session.entries[ 0 ].runtime.status() ).toBe( 'completed' );
		gameplay.candidates( frame() );
		expect( continuity.heldNpcIds ).toEqual( [] );

	} );

	it( 'does not post outside an authored window, for unmet conditions, or after death', () => {

		const def = definitions()[ 0 ];
		def.steps[ 0 ].window = { label: 'appointment', days: [ 0 ], startMin: 660, endMin: 720 };
		const { session, gameplay, crowd, sim } = setup( [ def ] );
		const npcId = session.entries[ 0 ].runtime.cast.a;
		gameplay.candidates( frame() );
		expect( crowd.memberForNpc( npcId ) ).toBeNull();
		sim.applyFlag( npcId, { kind: 'die' } );
		gameplay.candidates( frame( 680 ) );
		expect( crowd.memberForNpc( npcId ) ).toBeNull();

	} );

} );

function definitions() {

	const a = { ...role( 'a', 'barista' ), reservedName: { given: 'Ana', family: 'Test' } };
	const b = { ...role( 'b', 'barista' ), reservedName: { given: 'Bo', family: 'Test' } };
	return [
		quest( 'main', { roles: [ a ], steps: [ step( 'talk', { kind: 'talk', roleId: 'a', atParcelId: VENUE }, { endingId: 'done' } ) ] } ),
		quest( 'side', { roles: [ a, b ], steps: [ step( 'listen', { kind: 'listen', roleIds: [ 'a', 'b' ], atParcelId: VENUE }, { endingId: 'done', wantedByRoleId: 'a' } ) ] } )
	];

}

function setup( definitions, saved = null ) {

	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, null, saved?.simulation );
	if ( ! saved ) for ( const given of [ 'Ana', 'Bo' ] ) sim.reserveNPC( { name: { given, family: 'Test' }, type: 'barista', jobParcelId: 'p_cafe' } );
	const session = QuestSession.create( definitions, sim, TIME, saved?.progress );
	const routes = new WalkRoutes( { walk: { nodes: [], edges: [] } } );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 0.02, parcel.access.point[ 1 ] ], heading: 0, anchors: []
	} ) );
	const continuity = new NpcContinuity( { simulation: sim, routes, places } );
	if ( saved ) continuity.restore( saved.continuity );
	const crowd = new Crowd( {
		assets: { variants: [ {}, {} ], durations: Array( 20 ).fill( 1 ), meshesOf: () => [] },
		routes, sim, continuity, signals: { green: () => true }, capacity: 8,
		places: new Map( [ [ VENUE, {
			inside: new THREE.Vector3( ...POINT ), heading: 0,
			// Service posts on opposite sides of a real-sized floor cannot
			// serve as a two-person conversation within the eight-metre reach.
			anchors: { counter: [ - 15, 15 ].map( ( x, index ) => ( {
				id: `counter-${index}`, position: new THREE.Vector3( POINT[ 0 ] + x, POINT[ 1 ], POINT[ 2 ] - 2 ), heading: 0
			} ) ) }
		} ] ] )
	} );
	const gameplay = new QuestGameplay( {
		session, crowd, continuity, world: { parcels: [ { id: VENUE, anchor: POINT } ] },
		physics: { rapier: { Ray: class { constructor( origin, direction ) { this.origin = origin; this.direction = direction; } } }, world: { castRay: () => null } },
		missionItems: { get: () => null }
	} );
	return { sim, session, continuity, crowd, gameplay };

}

function frame( timeMin = TIME, feet = POINT ) {

	return { timeMin, playerPlaces: [ PARCEL ], feet: vector( feet ), eye: { x: feet[ 0 ], y: feet[ 1 ] + 1.7, z: feet[ 2 ] }, look: { x: 0, y: - 0.18, z: - 0.983666 } };

}

function vector( point ) { return { x: point[ 0 ], y: point[ 1 ], z: point[ 2 ] }; }
