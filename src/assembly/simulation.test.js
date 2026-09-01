import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { runCreateSimulation } from './simulationRunner.js';

const ATLAS_SAMPLE = new URL( '../../../atlas/samples/city-urbe.json', import.meta.url );

describe( 'simulation wiring', () => {

	it( 'same seed and interaction order give identical instances', async () => {

		const blueprint = JSON.parse( readFileSync( ATLAS_SAMPLE, 'utf8' ) );
		const coffeeShop = blueprint.parcels.find( ( p ) => p.type === 'coffee_shop' );

		const interact = async () => {

			const sim = await runCreateSimulation( { seed: 'urbe', blueprint } );
			const vendor = sim.getNPCVendor( { parcelId: coffeeShop.id, timeMin: 780 } );
			const reserved = sim.reserveNPC( { name: { given: 'Vesna', family: 'Okonkwo' }, type: vendor.type } );
			const partner = vendor.family.find( ( m ) => ! m.instantiated );
			const third = partner ? sim.instantiate( { npcId: partner.npcId } ) : null;

			return JSON.stringify( [ vendor, reserved, third ] );

		};

		expect( await interact() ).toBe( await interact() );

	} );

} );
