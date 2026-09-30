import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CLIP } from './CharacterAssets.js';
import { CROWD_CLIPS } from './CharacterCatalog.js';
import { stepIdle } from './IdleVariety.js';
import { BREAK, STAY, Visits, breakSpot, freeSeat } from './Visits.js';
import { Crowd } from './Crowd.js';
import { WalkRoutes } from './WalkRoutes.js';

const DURATIONS = CROWD_CLIPS.map( () => 1 );
const STEP = 0.1;

/** A café: two seats facing +Z, a counter served facing -X, a spot by the door, and the door itself. */
function cafe() {

	return {
		inside: new THREE.Vector3( 0, 0, 0 ),
		outside: new THREE.Vector3( 0, 0, - 3 ),
		heading: 0,
		anchors: {
			seat: [ { position: new THREE.Vector3( 4, 0.07, 4 ), heading: 0 }, { position: new THREE.Vector3( 6, 0.07, 4 ), heading: Math.PI / 2 } ],
			counter: [ { position: new THREE.Vector3( 4, 0, 0 ), heading: - Math.PI / 2 } ],
			work: []
		},
		lobby: [ new THREE.Vector3( 1, 0, 1 ) ]
	};

}

function guest( place, seat = 0, seed = 9 ) {

	const anchor = place.anchors.seat[ seat ];
	return {
		id: `g${seed}`, parcelId: 'cafe', crowdId: `patron-${seed}`, spot: `seat:${seat}`, position: anchor.position.clone(),
		heading: anchor.heading, clip: CLIP.SIT, appearanceSeed: seed, frame: 0, type: 'quest_resident', activity: 'leisure'
	};

}

/** Visits over some guests: their spots are who holds what. */
function visitsOf( people ) {

	return new Visits( { durations: DURATIONS, spots: () => new Set( people.map( ( person ) => person.spot ).filter( Boolean ) ) } );

}

/** Steps a guest as the crowd does: the visit, else the idle variety. Each step's stage, clip and place. */
function live( visits, member, place, seconds ) {

	const steps = [];
	for ( let t = 0; t < seconds; t += STEP ) {

		if ( ! visits.step( member, STEP, place ) ) stepIdle( member, STEP, DURATIONS );
		steps.push( { t, stage: member.visit?.stage, shown: member.shown, y: member.position.y, spot: member.spot, at: member.position.clone(), heading: member.heading } );

	}
	return steps;

}

const stages = ( steps ) => steps.map( ( step ) => step.stage ).filter( ( stage, i, all ) => stage !== all[ i - 1 ] );

describe( 'a guest\'s visit', () => {

	it( 'sits a while, gets up for the counter, stands there a while and sits down again', () => {

		const place = cafe();
		const member = guest( place );
		const visits = visitsOf( [ member ] );
		visits.seat( member, { spot: 'seat:0', ...place.anchors.seat[ 0 ] }, place );
		const steps = live( visits, member, place, STAY[ 1 ] + BREAK[ 1 ] + 60 );

		expect( stages( steps ).slice( 0, 6 ) ).toEqual( [ 'seated', 'rising', 'walking', 'waiting', 'walking', 'sitting' ] );
		const rose = steps.find( ( step ) => step.stage === 'rising' );
		expect( rose.t ).toBeGreaterThanOrEqual( STAY[ 0 ] );
		expect( rose.t ).toBeLessThan( STAY[ 1 ] + 5 );
		expect( rose.shown ).toBe( CLIP.STAND_UP );
		// Standing up lowers the feet from the seat to the floor.
		const walking = steps.find( ( step ) => step.stage === 'walking' );
		expect( walking.y ).toBe( 0 );
		expect( walking.shown ).toBe( CLIP.WALK );
		// At the counter, across from whoever serves there and facing them.
		const waiting = steps.find( ( step ) => step.stage === 'waiting' );
		expect( waiting.spot ).toBe( 'queue:0' );
		expect( waiting.at.x ).toBeCloseTo( 4 - 1.35, 5 );
		expect( waiting.at.z ).toBeCloseTo( 0, 5 );
		expect( Math.cos( waiting.heading - Math.PI / 2 ) ).toBeCloseTo( 1, 5 );
		const standing = steps.filter( ( step ) => step.stage === 'waiting' ).length * STEP;
		expect( standing ).toBeGreaterThanOrEqual( BREAK[ 0 ] );
		// Sitting down again on their own seat, turned to its way and on its cushion.
		const sat = steps.findIndex( ( step, i ) => i > 0 && step.stage === 'seated' && steps[ i - 1 ].stage === 'sitting' );
		expect( sat ).toBeGreaterThan( 0 );
		expect( steps[ sat - 1 ].shown ).toBe( CLIP.SIT_DOWN );
		expect( steps[ sat ].spot ).toBe( 'seat:0' );
		expect( steps[ sat ].at.toArray() ).toEqual( place.anchors.seat[ 0 ].position.toArray() );
		expect( steps[ sat ].heading ).toBeCloseTo( 0, 6 );

	} );

	it( 'sits somewhere else when somebody took the seat meanwhile', () => {

		const place = cafe();
		const first = guest( place, 0, 9 );
		const people = [ first ];
		const visits = visitsOf( people );
		visits.seat( first, { spot: 'seat:0', ...place.anchors.seat[ 0 ] }, place );
		let steps = [];
		while ( first.visit.stage !== 'waiting' ) steps = live( visits, first, place, 1 );
		// Somebody new sits where they sat.
		people.push( { spot: 'seat:0' } );
		while ( first.visit.stage !== 'seated' || first.shown === CLIP.SIT_DOWN ) steps = live( visits, first, place, 1 );
		expect( first.spot ).toBe( 'seat:1' );
		expect( first.position.x ).toBe( 6 );
		expect( steps.at( - 1 ).heading ).toBeCloseTo( Math.PI / 2, 6 );

	} );

	it( 'gets up and walks out through the door when the visit ends, giving up the seat and who they were', () => {

		const place = cafe();
		const member = guest( place );
		const visits = visitsOf( [ member ] );
		visits.seat( member, { spot: 'seat:0', ...place.anchors.seat[ 0 ] }, place );
		live( visits, member, place, 5 );
		visits.leave( member, place );
		expect( member.retiring ).toBe( true );
		expect( member.crowdId ).toBeNull();
		const steps = live( visits, member, place, 30 );
		expect( stages( steps ) ).toEqual( [ 'rising', 'walking' ] );
		expect( member.spot ).toBeNull();
		// They reach the door and fade out through it.
		expect( member.leaving ).toBe( true );
		const path = steps.filter( ( step ) => step.stage === 'walking' );
		expect( path.some( ( step ) => step.at.distanceTo( place.inside ) < 0.2 ) ).toBe( true );
		expect( path.at( - 1 ).at.distanceTo( place.outside ) ).toBeLessThan( 0.05 );

	} );

	it( 'walks in from the door and sits down when the player could see the seat', () => {

		const place = cafe();
		const member = guest( place, 1, 21 );
		const visits = visitsOf( [ member ] );
		visits.seat( member, { spot: 'seat:1', ...place.anchors.seat[ 1 ] }, place, { arriving: true } );
		expect( member.position.toArray() ).toEqual( place.inside.toArray() );
		const steps = live( visits, member, place, 15 );
		expect( stages( steps ) ).toEqual( [ 'walking', 'sitting', 'seated' ] );
		expect( member.clip ).toBe( CLIP.SIT );
		expect( member.position.toArray() ).toEqual( place.anchors.seat[ 1 ].position.toArray() );

	} );

	it( 'finds the first seat nobody holds, and somewhere to stand: the counter, then by the door', () => {

		const place = cafe();
		expect( freeSeat( place, new Set( [ 'seat:0' ] ) ).spot ).toBe( 'seat:1' );
		expect( freeSeat( place, new Set( [ 'seat:0', 'seat:1' ] ) ) ).toBeNull();
		expect( breakSpot( place, new Set() ).spot ).toBe( 'queue:0' );
		expect( breakSpot( place, new Set( [ 'queue:0' ] ) ).spot ).toBe( 'lobby:0' );
		expect( breakSpot( place, new Set( [ 'queue:0', 'lobby:0' ] ) ) ).toBeNull();

	} );

} );

describe( 'guests in the crowd', () => {

	const routes = () => new WalkRoutes( { walk: { nodes: [ { id: 'a', x: 100, y: 0, z: 0 }, { id: 'b', x: 140, y: 0, z: 0 } ], edges: [ { id: 'e', from: 'a', to: 'b', kind: 'sidewalk', path: [ [ 100, 0 ], [ 140, 0 ] ], path3: [ [ 100, 0, 0 ], [ 140, 0, 0 ] ] } ] } } );
	const assets = () => ( { variants: [ {}, {} ], durations: DURATIONS, meshesOf: () => [] } );
	const patron = ( id, seed ) => ( { crowdId: id, type: 'quest_resident', gender: 'female', appearanceSeed: seed, activity: 'leisure', place: { kind: 'parcel', id: 'cafe' } } );

	it( 'keeps a guest the guest they came in as, and walks them out when the simulation ends their visit, while another walks in', () => {

		const place = cafe();
		let guests = [ patron( 'visit-1', 3 ) ];
		let hidden = true;
		const crowd = new Crowd( {
			assets: assets(), routes: routes(), signals: { green: () => true },
			sim: { crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? guests : [] } ), getNPC: () => null },
			places: new Map( [ [ 'cafe', place ] ] ), capacity: 6, visibility: { hidden: () => hidden }
		} );
		const player = new THREE.Vector3( 2, 0, 2 );
		crowd.update( 0, player, { timeMin: 600, daySeconds: 36000 } );
		const [ first ] = crowd.members.values();
		expect( first.spot ).toBe( 'seat:0' );
		expect( first.clip ).toBe( CLIP.SIT );

		// The player looks on: the visit ends and another guest comes in.
		hidden = false;
		guests = [ patron( 'visit-2', 4 ) ];
		for ( let second = 0; second < 3.2; second += 0.1 ) crowd.update( 0.1, player, { timeMin: 601, daySeconds: 36060 + second } );
		const second = [ ...crowd.members.values() ].find( ( member ) => member.crowdId === 'visit-2' );
		// The one who sat there was not handed the new guest: they are on their way out.
		expect( second ).not.toBe( first );
		expect( first.retiring ).toBe( true );
		expect( [ 'rising', 'walking' ] ).toContain( first.visit.stage );
		// The newcomer walks in from the door to the first free seat.
		expect( second.visit.stage ).toBe( 'walking' );
		for ( let step = 0; step < 300 && crowd.members.has( first.id ); step ++ ) crowd.update( 0.1, player, { timeMin: 601, daySeconds: 36063 + step / 10 } );
		expect( crowd.members.has( first.id ) ).toBe( false );
		expect( second.visit.stage ).toBe( 'seated' );
		expect( second.clip ).toBe( CLIP.SIT );

	} );

} );
