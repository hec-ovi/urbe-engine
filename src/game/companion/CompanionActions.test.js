import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { StreetNames } from '../../../../quests/dist/runtime.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from '../agents/NpcContinuity.js';
import { WalkRoutes } from '../agents/WalkRoutes.js';
import { CompanionGameplay } from './CompanionGameplay.js';

const AFTERNOON = 16 * 60;
/** The cafe as its interior publishes it: a lift and stairs on two floors, a dining room and a kitchen below, offices above. */
const CAFE_PLAN = {
	floors: [
		{ index: 0, elevation: 1, lifts: [ { id: 'elev-0', position: [ 302, 1, 258 ] } ], stairs: [ { id: 'stair-a', position: [ 298, 1, 258 ] } ],
			rooms: [ { id: 'floor:0/dining', kind: 'dining_room', position: [ 300, 1, 255 ] }, { id: 'floor:0/kitchen', kind: 'kitchen', position: [ 303, 1, 255 ] }, { id: 'floor:0/hall', kind: 'corridor', position: [ 300, 1, 252 ] } ] },
		{ index: 1, elevation: 5, lifts: [ { id: 'elev-0', position: [ 302, 5, 258 ] } ], stairs: [ { id: 'stair-a', position: [ 298, 5, 258 ] } ], rooms: [ { id: 'floor:1/office', kind: 'office', position: [ 300, 5, 255 ] } ] }
	],
	apartments: []
};

describe( 'what a person may do for the player', () => {

	it( 'tells a talk more places than the chat shows: the building\'s lift, stairs, rooms and floors, people they know, venues, stops and streets', () => {

		const game = setup();
		const barista = game.talkTo();
		const wide = game.companion.offers( { ...game.ask( barista ), wide: true } ).filter( ( offer ) => offer.kind === 'lead' );
		const ids = wide.map( ( offer ) => offer.destination.place.id );
		expect( ids ).toEqual( expect.arrayContaining( [ 'lift:elev-0', 'stairs:stair-a', 'room:floor:0/dining', 'room:floor:0/kitchen', 'floor:1', game.friend ] ) );
		expect( ids ).not.toContain( 'room:floor:0/hall' );
		expect( wide.find( ( offer ) => offer.destination.place.id === 'floor:1' ) ).toMatchObject( {
			label: 'Take me to the first floor', destination: { relation: 'spot', target: { position: [ 302, 5, 258 ], parcelId: 'p_cafe', floor: 1 } }
		} );
		expect( wide.find( ( offer ) => offer.destination.place.id === game.friend ).destination ).toMatchObject( { name: 'Ada Ruiz', relation: 'person', target: { npcId: game.friend } } );
		expect( wide.some( ( offer ) => offer.destination.relation === 'street' ) ).toBe( true );
		expect( wide.length ).toBeLessThanOrEqual( 16 );
		expect( game.companion.offers( game.ask( barista ) ).filter( ( offer ) => offer.kind === 'lead' ).length ).toBeLessThanOrEqual( 4 );

		const talk = game.companion.talkOffers( game.companion.offers( { ...game.ask( barista ), wide: true } ), { npcId: barista.npcId, timeMin: AFTERNOON } );
		expect( talk ).toMatchObject( { follow: true, walk: true, home: true, wait: true, sit: true } );
		expect( talk.places.map( ( place ) => place.placeId ) ).toContain( 'lift:elev-0' );

	} );

	it( 'sends a person home to their own seat once the talk is done, says where they went, and stops the errand when asked', () => {

		const game = setup();
		const barista = game.talkTo();
		expect( game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'home' } ) ).toMatchObject( { ok: true, kind: 'home', line: expect.any( String ) } );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: game.companion.accepted( barista.npcId ) } );
		expect( game.frame( AFTERNOON, barista.position ) ).toEqual( [ { kind: 'errand', npcId: barista.npcId, action: 'home', notice: expect.stringMatching( / heads home\.$/ ) } ] );
		expect( game.inside.homeSpot ).toHaveBeenCalled();
		expect( game.continuity.serialize().errands[ 0 ] ).toMatchObject( { npcId: barista.npcId, target: { position: [ 560, 4, 262 ], parcelId: 'p_r1', floor: 1, seated: true }, untilMin: AFTERNOON + 60 } );

		game.continuity.beginConversation( { npcId: barista.npcId, timeMin: AFTERNOON + 1, position: game.continuity.actor( barista.npcId ).position, heading: 0, place: game.continuity.actor( barista.npcId ).place, seated: false } );
		expect( game.companion.acceptFromTool( { ...game.ask( barista, AFTERNOON + 1 ), kind: 'stop' } ) ).toMatchObject( { ok: true, kind: 'stop' } );
		game.continuity.endConversation( { timeMin: AFTERNOON + 1 } );
		expect( game.frame( AFTERNOON + 1, barista.position ) ).toEqual( [ { kind: 'errand', npcId: barista.npcId, action: 'stop' } ] );
		expect( game.continuity.serialize().errands ).toBeUndefined();

	} );

	it( 'waits where it stands or sits on the nearest free seat, and has nowhere to sit without one', () => {

		const game = setup();
		const barista = game.talkTo();
		expect( game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'sit' } ) ).toMatchObject( { ok: true, kind: 'sit' } );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: true } );
		expect( game.frame( AFTERNOON, barista.position )[ 0 ] ).toMatchObject( { kind: 'errand', action: 'sit' } );
		expect( game.continuity.serialize().errands[ 0 ].target ).toMatchObject( { seated: true, position: [ 301, 1, 256 ] } );

		const unseated = setup( { seat: () => null } );
		const other = unseated.talkTo();
		expect( unseated.companion.acceptFromTool( { ...unseated.ask( other ), kind: 'sit' } ) ).toMatchObject( { ok: false, code: 'nowhere', line: 'There\'s nowhere for that here.' } );
		expect( unseated.companion.acceptFromTool( { ...unseated.ask( other ), kind: 'wait' } ) ).toMatchObject( { ok: true, kind: 'wait' } );

	} );

	it( 'decides a chosen place by the person\'s disposition when asked to: a hostile person refuses rudely, a friendly one goes', () => {

		for ( const [ traits, ok, line ] of [ [ [ 'suspicious', 'brusque' ], false, /^(Get lost\.|Not for you\. Not ever\.)$/ ], [ [ 'warm', 'helpful' ], true, /./ ] ] ) {

			const game = setup();
			const barista = game.talkTo();
			game.bridge.getNPC( barista.npcId ).traits = traits;
			const lead = game.companion.offers( game.ask( barista ) ).find( ( offer ) => offer.kind === 'lead' && offer.available );
			const result = game.companion.accept( { ...game.ask( barista ), offerId: lead.offerId, willing: true } );
			expect( result.ok ).toBe( ok );
			expect( result.line ).toMatch( line );
			if ( ! ok ) expect( result.code ).toBe( 'unwilling' );

		}

	} );

	it( 'leads to a person by their target and paces the walk by who the leader is', () => {

		const game = setup();
		const barista = game.talkTo();
		const startLead = vi.spyOn( game.continuity, 'startLead' );
		game.continuity.appear( { npcId: game.friend, timeMin: AFTERNOON } );
		expect( game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'lead', placeId: game.friend } ) ).toMatchObject( { ok: true, kind: 'lead' } );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: true } );
		game.frame( AFTERNOON, barista.position );
		const [ request ] = startLead.mock.calls.at( - 1 );
		expect( request ).toMatchObject( { target: { npcId: game.friend }, pace: { giveUpBeyond: 60, giveUpAfterMin: 3, runs: expect.any( Boolean ) } } );
		expect( request.pace.runs ).toBe( game.bridge.getNPC( barista.npcId ).age < 60 && ! game.bridge.getNPC( barista.npcId ).traits.includes( 'tired' ) );

	} );

} );

function setup( overrides = {} ) {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const routes = new WalkRoutes( networks );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], heading: 0
	} ) );
	const continuity = new NpcContinuity( { simulation: bridge, routes, places } );
	const friend = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: 9 * 60 } );
	const inside = {
		plan: vi.fn( ( parcelId ) => parcelId === 'p_cafe' ? CAFE_PLAN : null ),
		workSpot: vi.fn( () => null ),
		homeSpot: vi.fn( () => ( { position: [ 560, 4, 262 ], parcelId: 'p_r1', floor: 1, seated: true } ) ),
		seat: vi.fn( () => ( { position: [ 301, 1, 256 ], parcelId: 'p_cafe', floor: 0, heading: 0, seated: true } ) ),
		...overrides
	};
	const companion = new CompanionGameplay( {
		continuity, sim: bridge, routes, places, atlas: FIXTURE_BLUEPRINT, inside,
		streets: new StreetNames( FIXTURE_BLUEPRINT.streets ),
		people: () => [ { npcId: friend.npcId, name: 'Ada Ruiz', position: [ 250, 1, 405 ] } ],
		quests: { holdsCast: () => false, escorts: () => false, places: () => [], characterName: () => null }
	} );
	const game = {
		bridge, continuity, companion, inside, friend: friend.npcId,
		/** The day barista in the cafe at the afternoon minute, in a chat. */
		talkTo() {

			const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: 9 * 60 } );
			// Off shift in the afternoon, at the cafe's door with the player.
			continuity.hold( { npcId: npc.npcId, timeMin: AFTERNOON, position: [ 300, 1, 256 ], heading: 0, place: { kind: 'parcel', id: 'p_cafe' } } );
			const actor = continuity.actor( npc.npcId );
			continuity.releaseHold( { npcId: npc.npcId, timeMin: AFTERNOON } );
			continuity.beginConversation( { npcId: npc.npcId, timeMin: AFTERNOON, position: actor.position, heading: 0, place: actor.place, seated: false } );
			return continuity.actor( npc.npcId );

		},
		ask( { npcId, place }, timeMin = AFTERNOON ) {

			return { npcId, timeMin, playerPlaces: place?.kind === 'parcel' ? [ place ] : [] };

		},
		frame( timeMin, playerPosition ) {

			continuity.updateFollow( { timeMin, deltaSeconds: 1, playerPosition } );
			return companion.update( { timeMin, playerPosition, playerPlaces: [] } );

		}
	};
	return game;

}

function network() {

	const hub = { id: 'hub', x: 500, y: 1, z: 250, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = parcel.access.point;
		nodes.push( { id, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( { id: `walk-${parcel.id}`, from: id, to: hub.id, kind: 'access', width: 2, path: [ [ x, z ], [ hub.x, hub.z ] ], path3: [ [ x, 1, z ], [ hub.x, hub.y, hub.z ] ] } );

	}
	return {
		walk: { nodes, edges },
		transit: { routes: [ {
			id: 'unused-route', kind: 'bus', lineId: 'unused',
			stops: [ { stopId: 'unused-a', x: 5000, y: 0, z: 5000, shapeDist: 0 }, { stopId: 'unused-b', x: 5000, y: 0, z: 5000, shapeDist: 1 } ],
			template: [ { arrive: 0, depart: 0 }, { arrive: 60, depart: 60 } ],
			service: [ { start: 0, end: 86400, headway: 600, phase: 0 } ]
		} ] }
	};

}
