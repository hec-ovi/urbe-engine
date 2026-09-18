import { expect, it } from 'vitest';
import { Neon } from './Neon.js';
import { CityLights } from '../light/CityLights.js';
import { Vector3 } from 'three/webgpu';

it( 'publishes authored facade and room emitters as real bounded light slots', () => {

	const accent = { kind: 'accent', edge: 0, position: [ 2, 5.8, 0 ], normal: [ 0, - 1 ], size: [ 5, 0.12, 0.1 ],
		standoff: 0.02, color: '#99fff0', lumens: 1400, range: 14 };
	const room = { position: [ 1, 7, 2 ], color: '#99fff0', lumens: 2400, range: 12 };
	const blueprint = {
		bounds: { height: 20 }, signage: [], screens: [], lights: [ accent ],
		floors: [ { elevation: 4.5, height: 4.5, outline: [], openings: [ { id: 'window', scenery: { lights: [ room, { ...room, lumens: 0 } ] } } ] } ]
	};
	const building = { parcelId: 'tower', hasInterior: false, blueprint };
	const atlas = { parcels: [ { id: 'tower', type: 'residential', tier: 'mid' } ] };
	const buildings = new Map( [ [ 'tower', building ] ] );

	// The accent keeps its authored flux, range and color; the dark room emits nothing.
	const { glows } = new Neon( atlas, buildings, {} ).build();
	expect( glows ).toHaveLength( 2 );
	const facade = glows.find( ( glow ) => glow.lumens === accent.lumens );
	const emitter = glows.find( ( glow ) => glow.lumens === room.lumens );
	expect( [ facade.lumens, facade.range, facade.color.getHexString() ] ).toEqual( [ 1400, 14, '99fff0' ] );
	expect( emitter.position.toArray() ).toEqual( room.position );

	const pool = new CityLights( glows, 1 );
	pool.update( new Vector3( 1, 5, 2 ), 1 );
	expect( pool.group.children ).toHaveLength( 1 );
	expect( pool.group.children[ 0 ].power ).toBeCloseTo( room.lumens );
	expect( pool.group.children[ 0 ].distance ).toBe( room.range );

	// A parcel with a real interior lights its own rooms instead.
	building.hasInterior = true;
	expect( new Neon( atlas, buildings, {} ).build().glows.map( ( glow ) => glow.lumens ) ).toEqual( [ accent.lumens ] );

} );
