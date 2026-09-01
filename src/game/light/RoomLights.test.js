import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomLights } from './RoomLights.js';

const tier = { roomSlots: 2, roomSpots: 2, roomStrips: 1 };

/** A room as RoomLights sees it: numbers, fixtures, and a binding it wears. */
function room( id, x, flux ) {

	return {
		id,
		center: new THREE.Vector3( x, 0, 0 ),
		area: 60,
		albedo: new THREE.Color( 0.5, 0.5, 0.5 ),
		floorAlbedo: new THREE.Color( 0.3, 0.3, 0.3 ),
		flux,
		color: new THREE.Color( 1, 0.8, 0.6 ),
		fixtures: [ {
			kind: 'spot', position: new THREE.Vector3( x, 2.6, 0 ), lumens: flux,
			color: new THREE.Color( 1, 0.8, 0.6 ), range: 4, beamDeg: 100,
			diffuse: 0.4, length: 0, angleDeg: 0, facing: 'down'
		} ],
		binding: null,
		worn: [],
		wear( binding ) {

			this.binding = binding;
			this.worn.push( binding.index );

		}
	};

}

const factory = { build: () => new THREE.MeshStandardNodeMaterial() };

/**
 * The load-bearing promise: a room's light set never changes the light objects
 * it is made of. A lights node hashes light ids into the shader cache key, so
 * a set built fresh per room would compile a shader at every doorway. The
 * rooms move through the slots, the slots never move.
 */
describe( 'RoomLights', () => {

	it( 'keeps the same light ids as rooms come and go', () => {

		const lights = new RoomLights( factory, tier );
		const a = room( 'a', 0, 2000 );
		const b = room( 'b', 5, 1000 );
		const c = room( 'c', 40, 500 );

		const ids = () => lights.slots.flatMap( ( slot ) => slot.members.map( ( light ) => light.id ) );

		lights.update( [ a, b ], new THREE.Vector3(), 1 );
		const first = ids();

		lights.update( [ c, a ], new THREE.Vector3( 40, 0, 0 ), 1 );

		expect( ids() ).toEqual( first );

	} );

	it( 'gives the nearest rooms a slot and everything else the dim set', () => {

		const lights = new RoomLights( factory, tier );
		const near = [ room( 'a', 0, 2000 ), room( 'b', 5, 1000 ), room( 'c', 9, 800 ) ];

		lights.update( near, new THREE.Vector3(), 1 );

		expect( near[ 0 ].binding ).toBe( lights.slots[ 0 ] );
		expect( near[ 1 ].binding ).toBe( lights.slots[ 1 ] );
		expect( near[ 2 ].binding ).toBe( lights.dim );

	} );

	it( 'writes a room fixture into its slot in candela over its own cone', () => {

		const lights = new RoomLights( factory, tier );
		const only = room( 'a', 0, 1800 );

		lights.update( [ only ], new THREE.Vector3(), 1 );

		const spot = lights.slots[ 0 ].spots[ 0 ];
		const steradians = 2 * Math.PI * ( 1 - Math.cos( THREE.MathUtils.degToRad( 100 ) / 2 ) );

		expect( spot.intensity ).toBeCloseTo( 1800 / steradians, 2 );
		expect( spot.distance ).toBe( 4 );
		expect( spot.decay ).toBe( 2 );
		// Unused lights in the pool go dark rather than being removed.
		expect( lights.slots[ 0 ].spots[ 1 ].intensity ).toBe( 0 );
		expect( lights.slots[ 1 ].fill.intensity ).toBe( 0 );

	} );

	it( 'compiles one material per binding and key, not one per room', () => {

		const lights = new RoomLights( factory, tier );
		const key = 'cyberpunk/plaster/mid';

		const first = lights.materialFor( lights.slots[ 0 ], key );

		expect( lights.materialFor( lights.slots[ 0 ], key ) ).toBe( first );
		expect( lights.materialFor( lights.slots[ 1 ], key ) ).not.toBe( first );
		expect( first.lightsNode ).toBe( lights.slots[ 0 ].lightsNode );

	} );

} );
