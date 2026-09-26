import { describe, expect, it } from 'vitest';
import { createSimulation, FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../simulation/dist/index.js';
import { TalkBoundary } from './TalkBoundary.js';

const boundary = new TalkBoundary();

/** A walk graph joining every parcel entry to one hub, so routines carry walks with path3 edges. */
function walkNetwork() {

	const hub = { id: 'hub', x: 500, y: 3, z: 250, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const [ x, z ] = parcel.access.point;
		nodes.push( { id: `entry-${parcel.id}`, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( {
			id: `walk-${parcel.id}`, from: `entry-${parcel.id}`, to: hub.id, kind: 'access', width: 2,
			path: [ [ x, z ], [ hub.x, hub.z ] ], path3: [ [ x, 1, z ], [ hub.x, hub.y, hub.z ] ]
		} );

	}
	return { walk: { nodes, edges }, transit: { routes: [] } };

}

/** Every kind of person the Simulation establishes: building, station and vehicle workers, crowd people and their family. */
function people( sim ) {

	const found = [
		sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: 540 } ),
		sim.getNPCVendor( { parcelId: 'p_office', timeMin: 540 } ),
		sim.getNPCVendor( { role: 'platform_staff', timeMin: 540 } ),
		sim.getNPCVendor( { role: 'driver', timeMin: 540 } ),
		...sim.crowd( 1080, { kind: 'city' } ).agents.slice( 0, 6 ).map( ( agent ) => sim.instantiate( { crowdId: agent.crowdId, timeMin: 1080 } ) )
	];
	const family = found.flatMap( ( npc ) => npc.family ).slice( 0, 4 ).map( ( member ) => sim.instantiate( { npcId: member.npcId } ) );
	return [ ...found, ...family ];

}

describe( 'talk request contract', () => {

	it( 'admits every NPC the Simulation build establishes, with its behavior across the week', () => {

		const sims = [
			createSimulation( { seed: 'talk-drift', blueprint: FIXTURE_BLUEPRINT, interiors: FIXTURE_INTERIORS } ),
			createSimulation( { seed: 'talk-drift-walks', blueprint: FIXTURE_BLUEPRINT, interiors: FIXTURE_INTERIORS, networks: walkNetwork() } )
		];
		const npcs = sims.flatMap( ( sim ) => people( sim ).map( ( npc ) => ( { sim, npc } ) ) );
		const seen = new Set( npcs.flatMap( ( { npc } ) => [
			...Object.keys( npc ), ...npc.routine.flatMap( ( entry ) => Object.keys( entry ) )
		] ) );
		// The people reach the optional fields too, so drift in any of them fails here.
		for ( const field of [ 'age', 'traits', 'job', 'transitJob', 'walk', 'transitLeg' ] ) expect( seen ).toContain( field );

		for ( const { sim, npc } of npcs ) {

			for ( let timeMin = 0; timeMin < 7 * 1440; timeMin += 150 ) {

				const request = { out: '/out/games/drift', npc, behavior: sim.behaviorAt( npc.npcId, timeMin ), line: 'Hello.', timeMin, quests: [] };
				expect( () => boundary.input( request ) ).not.toThrow();

			}

		}

	} );

	it( 'closes the npc, offers and guide shapes', () => {

		const sim = createSimulation( { seed: 'talk-drift', blueprint: FIXTURE_BLUEPRINT, interiors: FIXTURE_INTERIORS } );
		const npc = sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: 540 } );
		const request = { out: '/out/w', npc, behavior: sim.behaviorAt( npc.npcId, 540 ), line: 'Hi', timeMin: 540 };
		expect( boundary.input( { ...request,
			offers: { follow: true, places: [ { placeId: 'p_rest', name: 'The Rusty Anchor' } ] },
			guide: { placeId: 'p_rest', kind: 'parcel', name: 'The Rusty Anchor', notes: [ 'A police line crosses the door.' ] }
		} ) ).toBeTruthy();
		for ( const invalid of [
			{ ...request, npc: { ...npc, mood: 'tired' } },
			{ ...request, npc: { ...npc, traits: [ 'calm', 'calm' ] } },
			{ ...request, npc: { ...npc, age: 41.5 } },
			{ ...request, offers: { follow: true, ride: true } },
			{ ...request, guide: { placeId: 'p_rest', kind: 'route' } }
		] ) expect( () => boundary.input( invalid ) ).toThrow( /does not match its contract/ );

	} );

	it( 'closes the stream events', () => {

		for ( const event of [
			{ type: 'delta', text: 'Ask ' }, { type: 'sentence', index: 0, text: 'Ask at the bar.' },
			{ type: 'offer', kind: 'follow' }, { type: 'offer', kind: 'lead', placeId: 'p_rest', name: 'The Rusty Anchor' },
			{ type: 'done', reply: 'Ask at the bar.' }, { type: 'error', error: 'model server 500 at x' }
		] ) expect( boundary.event( event ) ).toBe( event );
		for ( const event of [
			{ type: 'delta', text: '' }, { type: 'offer', kind: 'lead' }, { type: 'done', reply: 'x', offers: [] }, { type: 'usage' }
		] ) expect( () => boundary.event( event ) ).toThrow( /does not match its contract/ );

	} );

} );
