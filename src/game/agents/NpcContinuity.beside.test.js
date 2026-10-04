import { describe, expect, it } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from './NpcContinuity.js';
import { WalkRoutes } from './WalkRoutes.js';

const MON_9 = 9 * 60;
const FRAME = 1 / 30;
/** The player facing and walking east along the street, as a body's heading. */
const EAST = Math.PI / 2;
const NORTH = 0;

/**
 * A companion walks with the player: level with them a metre to the side
 * where the pavement holds two, behind them where it does not, at the
 * player's own pace up to their sprint and faster while it is behind, and
 * stands beside them turned the way they face when they stop.
 */
describe( 'a companion walking with the player', () => {

	it( 'walks level with the player a metre to the side, keeps their pace from a walk to a sprint, and stops beside them facing their way', () => {

		const { controller, npcId } = setup();
		const player = [ 560, 3, 250 ];
		const frame = ( heading = EAST ) => controller.updateFollow( { timeMin: MON_9, deltaSeconds: FRAME, playerPosition: [ ...player ], playerHeading: heading } );
		controller.startFollow( { npcId, timeMin: MON_9, playerPosition: player } );
		let actor;
		for ( let index = 0; index < 6000 && controller.companion.phase !== 'waiting'; index ++ ) actor = frame();
		expect( controller.companion.phase ).toBe( 'waiting' );
		// Beside the player, level with them, on the pavement; turned the way they face.
		expect( Math.abs( actor.position[ 0 ] - player[ 0 ] ) ).toBeLessThan( 0.2 );
		expect( Math.abs( Math.abs( actor.position[ 2 ] - player[ 2 ] ) - 1 ) ).toBeLessThan( 0.15 );
		for ( let index = 0; index < 30; index ++ ) actor = frame();
		expect( angle( actor.heading, EAST ) ).toBeLessThan( 0.1 );
		expect( actor.animation ).toBe( 'idle' );
		const side = Math.sign( actor.position[ 2 ] - player[ 2 ] );

		// The player walks off: the companion walks beside them on the same side.
		const walk = ( pace, seconds ) => {

			const trail = [];
			for ( let index = 0; index < seconds / FRAME; index ++ ) {

				player[ 0 ] += pace * FRAME;
				actor = frame();
				trail.push( [ ...actor.position ] );

			}
			return trail;

		};
		walk( 1.4, 6 );
		expect( actor.animation ).toBe( 'walk' );
		expect( Math.abs( actor.position[ 0 ] - player[ 0 ] ) ).toBeLessThan( 0.6 );
		expect( Math.sign( actor.position[ 2 ] - player[ 2 ] ) ).toBe( side );

		// Sprinting at the player's top speed: it runs too, and never falls far behind.
		const sprint = walk( 8, 6 );
		expect( actor.animation ).toBe( 'run' );
		const lag = sprint.slice( 60 ).map( ( at, index ) => 8 * ( index + 61 ) * FRAME - ( at[ 0 ] - sprint[ 0 ][ 0 ] ) );
		expect( Math.max( ...lag ) ).toBeLessThan( 6 );
		const lastSecond = sprint.at( - 1 )[ 0 ] - sprint.at( - 31 )[ 0 ];
		expect( lastSecond ).toBeGreaterThan( 7.5 );
		expect( lastSecond ).toBeLessThan( 8 * 1.25 );

		// The player stops: it eases in beside them, without passing them, and turns their way.
		const before = actor.position[ 0 ];
		let furthest = - Infinity;
		for ( let index = 0; index < 4 / FRAME; index ++ ) {

			actor = frame();
			furthest = Math.max( furthest, actor.position[ 0 ] );

		}
		expect( furthest ).toBeLessThan( player[ 0 ] + 0.3 );
		expect( actor.position[ 0 ] ).toBeGreaterThanOrEqual( before );
		expect( Math.abs( actor.position[ 0 ] - player[ 0 ] ) ).toBeLessThan( 0.3 );
		expect( Math.abs( Math.abs( actor.position[ 2 ] - player[ 2 ] ) - 1 ) ).toBeLessThan( 0.2 );
		expect( actor.animation ).toBe( 'idle' );
		expect( angle( actor.heading, EAST ) ).toBeLessThan( 0.1 );

	} );

	it( 'catches up faster than the player while it is behind, and eases into their pace once it is with them', () => {

		const { controller, npcId } = setup();
		const player = [ 560, 3, 250 ];
		const frame = () => controller.updateFollow( { timeMin: MON_9, deltaSeconds: FRAME, playerPosition: [ ...player ], playerHeading: EAST } );
		controller.startFollow( { npcId, timeMin: MON_9, playerPosition: player } );
		let actor;
		for ( let index = 0; index < 6000 && controller.companion.phase !== 'waiting'; index ++ ) actor = frame();
		// The player is suddenly twelve metres on and walks: the companion has ground to make up.
		player[ 0 ] += 12;
		const speeds = [];
		let together = 0;
		for ( let index = 0; index < 60 / FRAME && together < 8 / FRAME; index ++ ) {

			player[ 0 ] += 1.4 * FRAME;
			const before = actor.position;
			actor = frame();
			speeds.push( Math.hypot( actor.position[ 0 ] - before[ 0 ], actor.position[ 2 ] - before[ 2 ] ) / FRAME );
			together = Math.abs( actor.position[ 0 ] - player[ 0 ] ) < 1 ? together + 1 : 0;

		}
		expect( together ).toBe( 8 / FRAME );
		// Behind, it went faster than the player's walk; with them, at it, never much over it.
		expect( Math.max( ...speeds ) ).toBeGreaterThan( 1.4 * 1.15 );
		const withThem = speeds.slice( - 60 );
		for ( const speed of withThem ) expect( speed ).toBeLessThan( 1.4 * 1.25 );
		expect( withThem.reduce( ( sum, speed ) => sum + speed, 0 ) / withThem.length ).toBeCloseTo( 1.4, 1 );
		expect( Math.abs( actor.position[ 0 ] - player[ 0 ] ) ).toBeLessThan( 0.6 );

	} );

	it( 'drops behind the player where the pavement is too narrow for two, and faces them standing', () => {

		const { controller, npcId } = setup();
		// On the narrow lane north off the street, facing north.
		const player = [ 800, 3, 300 ];
		controller.startFollow( { npcId, timeMin: MON_9, playerPosition: player } );
		let actor;
		for ( let index = 0; index < 9000 && controller.companion.phase !== 'waiting'; index ++ ) {

			actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: FRAME, playerPosition: player, playerHeading: NORTH } );

		}
		expect( controller.companion.phase ).toBe( 'waiting' );
		expect( Math.hypot( actor.position[ 0 ] - player[ 0 ], actor.position[ 2 ] - player[ 2 ] ) ).toBeCloseTo( 1.8, 1 );
		expect( Math.abs( actor.position[ 0 ] - player[ 0 ] ) ).toBeLessThan( 0.1 );
		expect( angle( actor.heading, Math.atan2( player[ 0 ] - actor.position[ 0 ], player[ 2 ] - actor.position[ 2 ] ) ) ).toBeLessThan( 0.05 );

	} );

} );

function angle( a, b ) {

	return Math.abs( Math.atan2( Math.sin( a - b ), Math.cos( a - b ) ) );

}

function setup() {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], heading: 0, anchors: []
	} ) );
	const controller = new NpcContinuity( { simulation: bridge, routes: new WalkRoutes( networks ), places } );
	const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
	return { controller, npcId: npc.npcId };

}

/**
 * The fixture's entries joined at a hub, a flat street six metres wide
 * running east from it, and a lane a metre and a bit wide north off the
 * street's far end.
 */
function network() {

	const hub = { id: 'hub', x: 500, y: 3, z: 250, kind: 'corner' };
	const east = { id: 'east', x: 900, y: 3, z: 250, kind: 'corner' };
	const north = { id: 'north', x: 800, y: 3, z: 450, kind: 'corner' };
	const bend = { id: 'bend', x: 800, y: 3, z: 250, kind: 'corner' };
	const nodes = [ hub, east, north, bend ];
	const edges = [
		{ id: 'street-a', from: hub.id, to: bend.id, kind: 'sidewalk', width: 6, path: [ [ 500, 250 ], [ 800, 250 ] ], path3: [ [ 500, 3, 250 ], [ 800, 3, 250 ] ] },
		{ id: 'street-b', from: bend.id, to: east.id, kind: 'sidewalk', width: 6, path: [ [ 800, 250 ], [ 900, 250 ] ], path3: [ [ 800, 3, 250 ], [ 900, 3, 250 ] ] },
		{ id: 'lane', from: bend.id, to: north.id, kind: 'sidewalk', width: 1.2, path: [ [ 800, 250 ], [ 800, 450 ] ], path3: [ [ 800, 3, 250 ], [ 800, 3, 450 ] ] }
	];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = parcel.access.point;
		nodes.push( { id, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( {
			id: `walk-${parcel.id}`, from: id, to: hub.id, kind: 'access', width: 2,
			path: [ [ x, z ], [ hub.x, hub.z ] ],
			path3: [ [ x, 1, z ], [ hub.x, hub.y, hub.z ] ]
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
