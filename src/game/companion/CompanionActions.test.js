import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { StreetNames } from '../../../../quests/dist/runtime.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from '../agents/NpcContinuity.js';
import { WalkRoutes } from '../agents/WalkRoutes.js';
import { targetOf } from './CompanionPlaces.js';
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

	it( 'offers a worker\'s own spot at work with what a target holds, whatever else the spot carries, and drops a point that is not one', () => {

		// An anchor's work spot carries the way it faces and a seat flag; offers carry neither.
		const game = setup( { workSpot: vi.fn( ( npc ) => ( { position: [ 303, 1, 259 ], parcelId: npc.job.parcelId, floor: 0, heading: 1.57, seated: true } ) ) } );
		const barista = game.talkTo();
		const offers = game.companion.offers( { npcId: barista.npcId, timeMin: AFTERNOON, playerPlaces: [] } );
		const work = offers.find( ( offer ) => offer.destination?.relation === 'work' );
		expect( work.destination.target ).toEqual( { position: [ 303, 1, 259 ], parcelId: 'p_cafe', floor: 0 } );
		expect( offers.some( ( offer ) => offer.kind === 'follow' ) ).toBe( true );
		expect( targetOf( { position: [ 1, Number.NaN, 2 ], parcelId: 'p' } ) ).toBeNull();
		expect( targetOf( { position: [ 1, 2 ], parcelId: 'p' } ) ).toBeNull();
		expect( targetOf( { npcId: 'a1', heading: 0 } ) ).toEqual( { npcId: 'a1' } );
		expect( targetOf( { position: [ 1, 2, 3 ], door: [ 1, 2, 4 ] } ) ).toEqual( { position: [ 1, 2, 3 ] } );

		// A work spot whose point is no point leaves the work place without one, and the offers still hold.
		game.inside.workSpot.mockImplementation( ( npc ) => ( { position: [ 303, Number.NaN, 259 ], parcelId: npc.job.parcelId, floor: 0 } ) );
		expect( () => game.companion.offers( { npcId: barista.npcId, timeMin: AFTERNOON, playerPlaces: [] } ) ).not.toThrow();

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

	it( 'comes to where the player is when asked on a call, as a walk to that spot once the call is over', () => {

		const game = setup();
		const barista = game.talkTo();
		const meet = { position: [ 300, 1, 255 ], parcelId: 'p_cafe', floor: 0, name: 'the cafe' };
		expect( game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'meet', meet } ) ).toMatchObject( {
			ok: true, kind: 'walk', offerId: 'meet', line: expect.stringContaining( 'the cafe' )
		} );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: game.companion.accepted( barista.npcId ) } );
		expect( game.frame( AFTERNOON, barista.position )[ 0 ] ).toMatchObject( { kind: 'errand', npcId: barista.npcId, action: 'walk' } );
		expect( game.continuity.serialize().errands[ 0 ].target ).toMatchObject( { position: [ 300, 1, 255 ], parcelId: 'p_cafe', floor: 0 } );
		expect( game.companion.taskOf( barista.npcId ) ).toMatchObject( { kind: 'walking', place: 'the cafe' } );
		expect( () => game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'meet' } ) ).toThrow( /tool-request/ );
		expect( () => game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'wait', meet } ) ).toThrow( /tool-request/ );

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

	it( 'sends a person to somebody they know, stopping a step short of them on their own side', () => {

		const game = setup();
		const barista = game.talkTo();
		const friend = game.continuity.appear( { npcId: game.friend, timeMin: AFTERNOON } );
		expect( game.companion.acceptFromTool( { ...game.ask( barista ), kind: 'walk', placeId: game.friend } ) ).toMatchObject( { ok: true, kind: 'walk' } );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: true } );
		expect( game.frame( AFTERNOON, barista.position )[ 0 ] ).toMatchObject( { kind: 'errand', action: 'walk', notice: expect.stringContaining( 'Ada Ruiz' ) } );
		const [ errand ] = game.continuity.serialize().errands;
		const gap = Math.hypot( errand.target.position[ 0 ] - friend.position[ 0 ], errand.target.position[ 2 ] - friend.position[ 2 ] );
		expect( gap ).toBeCloseTo( 1.2, 6 );
		expect( Math.hypot( errand.target.position[ 0 ] - barista.position[ 0 ], errand.target.position[ 2 ] - barista.position[ 2 ] ) )
			.toBeLessThan( Math.hypot( friend.position[ 0 ] - barista.position[ 0 ], friend.position[ 2 ] - barista.position[ 2 ] ) );
		expect( game.companion.taskOf( barista.npcId ) ).toEqual( { kind: 'walking', place: 'Ada Ruiz' } );

	} );

	it( 'takes the player up to their own numbered door and opens it for them', () => {

		const game = setup( {}, { interiorRoutes: straightIndoors() } );
		const barista = game.talkTo();
		const npc = game.bridge.getNPC( barista.npcId );
		const homeParcel = npc.home.parcelId;
		const parcel = FIXTURE_BLUEPRINT.parcels.find( ( entry ) => entry.id === homeParcel );
		const [ x, z ] = parcel.access.point;
		const apartment = { floor: 1, unit: 'u1', number: '101', door: [ x + 2, 5, z + 4 ], front: [ x + 2, 5, z + 3.1 ] };
		npc.home = { ...npc.home, apartment: { id: 'floor:1/u1', number: '101', floor: 1 } };
		game.inside.plan.mockImplementation( ( parcelId ) => parcelId === homeParcel ? { floors: [], apartments: [ apartment ] } : null );
		const open = game.inside.open = vi.fn( () => true );

		const home = game.companion.offers( game.ask( barista ) ).find( ( offer ) => offer.destination?.relation === 'home' );
		// The door's corridor side, the door itself and the access it needs, which the host holds.
		expect( home.destination.target ).toEqual( { position: apartment.front, parcelId: homeParcel, floor: 1, door: apartment.door, scope: `home:${homeParcel}/floor:1/u1` } );
		expect( game.companion.accept( { ...game.ask( barista ), offerId: home.offerId } ).ok ).toBe( true );
		game.continuity.endConversation( { timeMin: AFTERNOON, hold: true } );
		game.frame( AFTERNOON, barista.position );
		expect( game.companion.taskOf( barista.npcId ) ).toEqual( { kind: 'leading', place: home.destination.name } );
		for ( let step = 0; step < 4000 && game.continuity.companion?.phase !== 'arrived'; step ++ ) {

			// Shut until the host stands at it.
			expect( open ).not.toHaveBeenCalled();
			const at = game.continuity.companion.position;
			game.frame( AFTERNOON, [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ] );

		}
		const stood = game.continuity.companion.position;
		expect( Math.hypot( ...stood.map( ( value, axis ) => value - apartment.front[ axis ] ) ) ).toBeLessThan( 0.5 );
		game.frame( AFTERNOON, apartment.front );
		expect( open ).toHaveBeenCalledExactlyOnceWith( { kind: 'door', parcelId: homeParcel, floor: 1, position: apartment.door } );
		expect( game.companion.taskOf( barista.npcId ) ).toEqual( { kind: 'brought', place: home.destination.name } );

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

/** Interior routes over every building: straight from the door to the point. */
function straightIndoors() {

	return { covers: () => true, route: ( parcelId, from, to ) => ( { path3: [ from, to ] } ) };

}

function setup( overrides = {}, continuityOptions = {} ) {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const routes = new WalkRoutes( networks );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], heading: 0
	} ) );
	const continuity = new NpcContinuity( { simulation: bridge, routes, places, ...continuityOptions } );
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
