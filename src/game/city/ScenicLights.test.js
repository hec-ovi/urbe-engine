import { expect, it } from 'vitest';
import { Neon } from './Neon.js';
import { CityLights } from '../light/CityLights.js';
import { Vector3 } from 'three/webgpu';

it( 'passes authored room emitters through Neon into real bounded light slots', () => {
	const light = { position: [ 1, 7, 2 ], color: '#99fff0', lumens: 2400, range: 12 };
	const blueprint = {
		bounds: { height: 10 }, signage: [], lights: [], screens: [],
		floors: [ { elevation: 4.5, height: 4.5, outline: [], openings: [ { id: 'window', scenery: { lights: [ light, { ...light, lumens: 0 } ] } } ] } ]
	};
	const building = { parcelId: 'tower', hasInterior: false, blueprint };
	const atlas = { parcels: [ { id: 'tower', type: 'residential', tier: 'mid' } ] };
	const buildings = new Map( [ [ 'tower', building ] ] );
	const { glows } = new Neon( atlas, buildings, {} ).build();
	expect( glows ).toHaveLength( 1 );
	expect( glows[ 0 ].position.toArray() ).toEqual( light.position );
	const pool = new CityLights( glows, 1 );
	pool.update( new Vector3( 1, 5, 2 ), 1 );
	expect( pool.group.children ).toHaveLength( 1 );
	expect( pool.group.children[ 0 ].power ).toBeCloseTo( light.lumens );
	expect( pool.group.children[ 0 ].distance ).toBe( light.range );
	building.hasInterior = true;
	expect( new Neon( atlas, buildings, {} ).build().glows ).toHaveLength( 0 );
} );
