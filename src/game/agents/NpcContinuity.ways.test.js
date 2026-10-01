import { describe, expect, it } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from './NpcContinuity.js';
import { WalkRoutes } from './WalkRoutes.js';

const MON_9 = 9 * 60;
const CAFE_ANCHOR = [ 300, 1, 256 ];
/** Each building's main door: just inside it (the access point) and its doorstep 3 m out toward the street. */
const doorstep = ( parcel ) => [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] - 3 ];

describe( 'NPC continuity through doors and lifts', () => {

	it( 'stops short of a closed door on its way out, asks it open, and walks through once it is', () => {

		const opened = { asked: 0, open: false };
		const ways = { pass: ( npcId, gate ) => { opened.asked ++; opened.gate = gate; return opened.open; }, ride: () => null };
		const { bridge, controller } = setup( { ways, interiorRoutes: indoor( [ 'p_cafe' ] ) } );
		const npc = held( bridge, controller );
		controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' } } );
		const player = { playerPosition: CAFE_ANCHOR };
		let furthest = 0;
		for ( let step = 0; step < 40; step ++ ) {

			controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, ...player } );
			furthest = Math.max( furthest, controller.serialize().follow.route.cursor );

		}
		const gate = controller.serialize().follow.route.gates.find( ( entry ) => entry.kind === 'door' );
		expect( gate ).toMatchObject( { kind: 'door', parcelId: 'p_cafe', position: [ 305, 1, 248.5 ] } );
		expect( opened.asked ).toBeGreaterThan( 0 );
		expect( furthest ).toBeLessThanOrEqual( gate.at - 0.5 );
		opened.open = true;
		for ( let step = 0; step < 10; step ++ ) controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, ...player } );
		expect( controller.serialize().follow.route.cursor ).toBeGreaterThan( gate.at );

	} );

	it( 'keeps a door it led the player through open while the player is still near it', () => {

		const asked = [];
		const ways = { pass: ( npcId, gate ) => { asked.push( gate.position ); return true; }, ride: () => null };
		const { bridge, controller } = setup( { ways, interiorRoutes: indoor( [ 'p_cafe' ] ) } );
		const npc = held( bridge, controller );
		controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' } } );
		// The player walks two metres behind the leader until it is through the door.
		let gate = null;
		for ( let step = 0; step < 80; step ++ ) {

			const at = controller.actor( npc.npcId ).position;
			controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ at[ 0 ], at[ 1 ], at[ 2 ] + 2 ] } );
			const route = controller.serialize().follow.route;
			gate = route.gates.find( ( entry ) => entry.kind === 'door' );
			if ( route.cursor > gate.at + 1 ) break;

		}
		// Through it, the player still at the door: asked again each frame they are near it.
		const before = asked.length;
		controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ gate.position[ 0 ], 1, gate.position[ 2 ] + 1 ] } );
		expect( asked.length ).toBe( before + 1 );
		expect( asked.at( - 1 ) ).toEqual( gate.position );
		// The player well past it, or far behind: no longer.
		controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ gate.position[ 0 ], 1, gate.position[ 2 ] - 6 ] } );
		expect( asked.length ).toBe( before + 1 );

	} );

	it( "calls a lift at its landing, waits for it, rides in its car at the car's height and walks out on the floor above", () => {

		const script = { calls: 0, rides: 0, y: 1, done: false };
		const ways = {
			pass: () => true,
			ride( npcId, gate, stage ) {

				if ( stage === 'call' ) return ++ script.calls > 3 ? 'board' : 'wait';
				if ( stage === 'ride' ) {

					script.rides ++;
					script.y = Math.min( 9, script.y + 2 );
					return script.y >= 9 ? 'alight' : { y: script.y };

				}
				script.done = true;
				return 'done';

			}
		};
		const { bridge, controller } = setup( { ways, interiorRoutes: tower() } );
		const npc = held( bridge, controller );
		const upstairs = [ 566, 9, 270 ];
		controller.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: upstairs, parcelId: 'p_r1', floor: 2 }, untilMin: MON_9 + 30 } );
		const seen = [];
		for ( let step = 0; step < 2000 && ! controller.errandsUnderway[ 0 ].arrived; step ++ ) {

			controller.updateFollow( { timeMin: MON_9 + step / 600, deltaSeconds: 0.5, playerPosition: [ 0, 0, 0 ] } );
			seen.push( controller.actor( npc.npcId ).position );

		}
		expect( controller.errandsUnderway[ 0 ].arrived ).toBe( true );
		expect( script.calls ).toBe( 4 );
		expect( script.done ).toBe( true );
		// Off the ground only in the car's middle, at the heights the car rode through.
		const lifted = seen.filter( ( point ) => point[ 1 ] > 1.01 && point[ 1 ] < 8.99 );
		expect( lifted.length ).toBeGreaterThan( 0 );
		expect( lifted.every( ( point ) => point[ 0 ] === 562 && point[ 2 ] === 262 ) ).toBe( true );
		expect( [ ...new Set( lifted.map( ( point ) => point[ 1 ] ) ) ] ).toEqual( [ 5, 7 ] );
		controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 0.5, playerPosition: [ 0, 0, 0 ] } );
		expect( controller.actor( npc.npcId ) ).toMatchObject( { mode: 'errand', animation: 'idle', place: { kind: 'parcel', id: 'p_r1', floor: 2 } } );

	} );

	it( 'boards a lift with the player it leads, waiting at the landing for them and holding the car until they step in', () => {

		const script = { calls: 0, rides: 0, y: 1 };
		const ways = {
			pass: () => true,
			ride( npcId, gate, stage ) {

				if ( stage === 'call' ) return ++ script.calls > 1 ? 'board' : 'wait';
				if ( stage === 'ride' ) {

					script.rides ++;
					script.y = Math.min( 9, script.y + 2 );
					return script.y >= 9 ? 'alight' : { y: script.y };

				}
				return 'done';

			}
		};
		const { bridge, controller } = setup( { ways, interiorRoutes: tower() } );
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		// In the tower's lobby, by its door, with the player beside them.
		const lobby = [ 560, 1, 255 ];
		controller.hold( { npcId: npc.npcId, timeMin: MON_9, position: lobby, heading: 0, place: { kind: 'parcel', id: 'p_r1' } } );
		controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_r1' }, target: { position: [ 566, 9, 270 ], parcelId: 'p_r1', floor: 2 } } );
		const step = ( player, frames = 1 ) => {

			for ( let index = 0; index < frames; index ++ ) controller.updateFollow( { timeMin: MON_9 + index / 600, deltaSeconds: 0.5, playerPosition: player } );
			return controller.serialize().follow.route;

		};
		// The player keeps back, 6.8 m from the landing: the leader walks to it and stands there, the car open, not boarding.
		let route = step( [ 556.5, 1, 255 ], 40 );
		const lift = route.gates.find( ( gate ) => gate.kind === 'lift' );
		expect( route.ride ).toMatchObject( { stage: 'call' } );
		expect( route.cursor ).toBeCloseTo( lift.from, 6 );
		expect( step( [ 562, 1, 255.5 ], 8 ).ride ).toMatchObject( { stage: 'ride', held: true } );
		// In the car, holding it: no floor pressed while the player is still on the landing.
		expect( script.rides ).toBe( 0 );
		expect( controller.actor( npc.npcId ).position ).toEqual( [ 562, 1, 262 ] );
		route = step( [ 562.4, 1, 261.6 ] );
		expect( route.ride.held ).toBeUndefined();
		expect( script.rides ).toBe( 1 );

	} );

	it( 'rides on alone once the player has not stepped in for half a minute', () => {

		const ways = { pass: () => true, ride: ( npcId, gate, stage ) => stage === 'call' ? 'board' : stage === 'ride' ? 'alight' : 'done' };
		const { bridge, controller } = setup( { ways, interiorRoutes: tower() } );
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		controller.hold( { npcId: npc.npcId, timeMin: MON_9, position: [ 560, 1, 255 ], heading: 0, place: { kind: 'parcel', id: 'p_r1' } } );
		controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_r1' }, target: { position: [ 566, 9, 270 ], parcelId: 'p_r1', floor: 2 } } );
		// The player waits on the landing, 3 m from the car's middle.
		const landing = [ 562, 1, 259 ];
		for ( let index = 0; index < 20; index ++ ) controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: landing } );
		expect( controller.serialize().follow.route.ride ).toMatchObject( { stage: 'ride', held: true } );
		controller.updateFollow( { timeMin: MON_9 + 0.6, deltaSeconds: 0.5, playerPosition: landing } );
		expect( controller.serialize().follow.route.ride?.held ).toBeUndefined();

	} );

	it( "walks a lift's shaft as drawn where no lift runs there, and through every door where no ways are given", () => {

		for ( const ways of [ { pass: () => true, ride: () => null }, null ] ) {

			const { bridge, controller } = setup( { ...( ways ? { ways } : {} ), interiorRoutes: tower() } );
			const npc = held( bridge, controller );
			controller.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: [ 566, 9, 270 ], parcelId: 'p_r1' }, untilMin: MON_9 + 30 } );
			for ( let step = 0; step < 2000 && ! controller.errandsUnderway[ 0 ].arrived; step ++ ) {

				controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ 0, 0, 0 ] } );

			}
			expect( controller.errandsUnderway[ 0 ].arrived ).toBe( true );

		}

	} );

	it( 'sits a person on an errand where they were sent, keeps them there through a talk and walks them back into their day when it is over', () => {

		const { bridge, controller } = setup( { interiorRoutes: indoor( [ 'p_cafe' ] ) } );
		const npc = held( bridge, controller );
		const seat = [ 303, 1, 254 ];
		controller.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: seat, parcelId: 'p_cafe', floor: 0, heading: 1, seated: true }, untilMin: MON_9 + 10 } );
		for ( let step = 0; step < 40; step ++ ) controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 0.5, playerPosition: CAFE_ANCHOR } );
		expect( controller.actor( npc.npcId ) ).toMatchObject( { mode: 'errand', animation: 'sit', position: seat, heading: 1 } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( true );

		controller.beginConversation( { npcId: npc.npcId, timeMin: MON_9 + 2, position: seat, heading: 1, place: { kind: 'parcel', id: 'p_cafe' }, seated: true } );
		expect( controller.endConversation( { timeMin: MON_9 + 3 } ) ).toMatchObject( { mode: 'errand', animation: 'sit' } );
		expect( controller.serialize().errands.map( ( errand ) => errand.npcId ) ).toEqual( [ npc.npcId ] );

		const restored = setup( { interiorRoutes: indoor( [ 'p_cafe' ] ) }, bridge );
		restored.controller.restore( controller.serialize() );
		restored.controller.updateFollow( { timeMin: MON_9 + 10, deltaSeconds: 0.5, playerPosition: CAFE_ANCHOR } );
		expect( restored.controller.serialize().errands ).toBeUndefined();
		expect( restored.controller.actor( npc.npcId ).mode ).not.toBe( 'errand' );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 10 ).interrupted ).toBe( false );

	} );

	it( 'leads the player to a person wherever they stand, follows them as they move, and stops a step short of them', () => {

		const { bridge, controller } = setup();
		const leader = held( bridge, controller );
		const person = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } );
		controller.hold( { npcId: person.npcId, timeMin: MON_9, position: [ 250, 1, 404 ], heading: 0, place: { kind: 'parcel', id: 'p_clinic' } } );
		controller.startLead( { npcId: leader.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' }, target: { npcId: person.npcId } } );
		const walk = ( until ) => {

			for ( let step = 0; step < 2000 && controller.companion.phase !== until; step ++ ) {

				const at = controller.actor( leader.npcId ).position;
				controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ] } );

			}

		};
		walk( 'arrived' );
		expect( controller.companion.phase ).toBe( 'arrived' );
		const there = controller.actor( leader.npcId ).position;
		expect( Math.hypot( there[ 0 ] - 250, there[ 2 ] - 404 ) ).toBeLessThan( 2.5 );

	} );

	it( 'shows a building from its doorstep while it cannot be walked and leads on inside once it can', () => {

		const covered = new Set();
		const interiorRoutes = { ...indoor( [] ), covers: ( id ) => covered.has( id ), route: indoor( [ 'p_r1' ] ).route };
		const { bridge, controller } = setup( { interiorRoutes } );
		const leader = held( bridge, controller );
		const door = [ 562, 1, 262 ];
		controller.startLead( { npcId: leader.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_r1' }, target: { position: door, parcelId: 'p_r1', floor: 0 } } );
		expect( controller.serialize().follow ).toMatchObject( { pending: true, route: { destination: [ 560, 1, 247 ] } } );
		const step = () => {

			const at = controller.actor( leader.npcId ).position;
			controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ at[ 0 ] + 1, at[ 1 ], at[ 2 ] ] } );

		};
		for ( let count = 0; count < 600 && controller.serialize().follow.route.cursor < controller.serialize().follow.route.distanceMeters - 0.01; count ++ ) step();
		step();
		expect( controller.companion.phase ).toBe( 'arrived' );
		covered.add( 'p_r1' );
		const again = setup( { interiorRoutes } );
		const second = held( again.bridge, again.controller );
		again.controller.startLead( { npcId: second.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_r1' }, target: { position: door, parcelId: 'p_r1', floor: 0 } } );
		expect( again.controller.serialize().follow ).toMatchObject( { route: { parcelId: 'p_r1', destination: door } } );
		expect( again.controller.serialize().follow.pending ).toBeUndefined();

	} );

	it( 'walks a visible scheduled body to where its schedule moved it instead of jumping', () => {

		const { bridge, controller } = setup( { interiorRoutes: indoor( [ 'p_cafe' ] ) } );
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const work = npc.routine.find( ( entry ) => entry.activity === 'working' && entry.days.includes( 0 ) );
		const shown = controller.appear( { npcId: npc.npcId, timeMin: work.startMin + 5 } );
		const far = [ shown.position[ 0 ] + 0, shown.position[ 1 ], shown.position[ 2 ] ];
		// The body stands three metres off its post, as a talk could leave it.
		controller.hold( { npcId: npc.npcId, timeMin: work.startMin + 5, position: [ far[ 0 ] - 3, far[ 1 ], far[ 2 ] ], heading: 0, place: { kind: 'parcel', id: 'p_cafe' } } );
		controller.releaseHold( { npcId: npc.npcId, timeMin: work.startMin + 5 } );
		const [ state ] = controller.updateVisible( { timeMin: work.startMin + 6, playerPosition: far, maxDistance: 100 } );
		expect( state.mode ).toBe( 'resuming' );
		expect( state.position[ 0 ] ).toBeCloseTo( far[ 0 ] - 3 );

	} );

	it( 'runs to keep up with a running player when the pace runs, and never above a walk when it does not', () => {

		for ( const [ runs, animation ] of [ [ true, 'run' ], [ false, 'walk' ] ] ) {

			const { bridge, controller } = setup();
			const npc = held( bridge, controller );
			controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: [ 305, 1, 250 ], pace: { giveUpBeyond: 60, giveUpAfterMin: 3, runs } } );
			let actor;
			for ( let step = 0; step < 6; step ++ ) {

				actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ 305 + step * 2, 1, 250 + 30 + step * 2 ] } );

			}
			expect( actor.animation ).toBe( animation );

		}

	} );

} );

function setup( options = {}, existing = null ) {

	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const networks = network();
	const bridge = existing ?? SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], doorstep: doorstep( parcel ), heading: 0,
		anchors: parcel.id === 'p_cafe' ? FIXTURE_INTERIORS.p_cafe.anchors.map( ( anchor ) => ( { id: anchor.id, position: [ ...CAFE_ANCHOR ], heading: 0, floor: 0 } ) ) : []
	} ) );
	return { bridge, controller: new NpcContinuity( { simulation: bridge, routes: new WalkRoutes( networks ), places, ...options } ) };

}

/** A cafe worker held at their counter inside the cafe. */
function held( bridge, controller ) {

	const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
	controller.hold( { npcId: npc.npcId, timeMin: MON_9, position: [ ...CAFE_ANCHOR ], heading: 0, place: { kind: 'parcel', id: 'p_cafe' } } );
	return npc;

}

/** Interior routes over the listed buildings: a step aside, then straight on. */
function indoor( parcelIds ) {

	return {
		covers: ( parcelId ) => parcelIds.includes( parcelId ),
		route: ( parcelId, from, to ) => Math.hypot( ...to.map( ( value, axis ) => value - from[ axis ] ) ) < 1e-6 ? null
			: { path3: [ from, [ from[ 0 ] + 1, from[ 1 ], from[ 2 ] ], to ] }
	};

}

/** A tower at p_r1 whose upper floors are reached by one lift: in from the door to its landing, the car, up the shaft, out and on. */
function tower() {

	return {
		covers: ( parcelId ) => parcelId === 'p_r1' || parcelId === 'p_cafe',
		route( parcelId, from, to ) {

			if ( parcelId === 'p_cafe' ) return { path3: [ from, to ] };
			if ( Math.abs( to[ 1 ] - from[ 1 ] ) < 0.5 ) return { path3: [ from, to ] };
			const landing = [ 562, from[ 1 ], 259 ];
			const path3 = [ from, landing, [ 562, from[ 1 ], 262 ], [ 562, to[ 1 ], 262 ], [ 562, to[ 1 ], 259 ], to ];
			const along = [ 0 ];
			for ( let index = 1; index < path3.length; index ++ ) along.push( along.at( - 1 ) + Math.hypot( ...path3[ index ].map( ( value, axis ) => value - path3[ index - 1 ][ axis ] ) ) );
			return { path3, gates: [ { kind: 'lift', parcelId, shaft: 'elev-0', fromFloor: 0, toFloor: 2, from: along[ 1 ], board: along[ 2 ], alight: along[ 3 ], to: along[ 4 ] } ] };

		}
	};

}

function network() {

	const hub = { id: 'hub', x: 500, y: 1, z: 240, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = doorstep( parcel ).filter( ( value, axis ) => axis !== 1 );
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
