import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomLights } from './RoomLights.js';
import { RoomFillNode } from './RoomFillNode.js';

const tier = { roomSlots: 2, roomSpots: 2, roomStrips: 1 };

/** A room as RoomLights sees it: numbers and fixtures. */
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
		} ]
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

	it( 'gives the nearest rooms a slot, keeping the same light ids', () => {

		const lights = new RoomLights( factory, tier );
		const near = [ room( 'a', 0, 2000 ), room( 'b', 5, 1000 ), room( 'c', 9, 800 ) ];
		const ids = () => lights.slots.flatMap( ( slot ) => slot.members.map( ( light ) => light.id ) );

		lights.update( near, new THREE.Vector3(), 1 );
		const first = ids();

		expect( lights.slots[ 0 ].room ).toBe( near[ 0 ] );
		expect( lights.slots[ 1 ].room ).toBe( near[ 1 ] );

		lights.update( [ room( 'd', 40, 500 ), near[ 0 ] ], new THREE.Vector3( 40, 0, 0 ), 1 );

		expect( ids() ).toEqual( first );
		expect( lights.slots[ 0 ].room.id ).toBe( 'd' );

	} );

	it( 'writes a room fixture into its slot in candela over its own cone', () => {

		const lights = new RoomLights( factory, tier );
		const only = room( 'a', 0, 1800 );

		lights.update( [ only ], new THREE.Vector3(), 1 );

		const spot = lights.slots[ 0 ].spots[ 0 ];
		const steradians = 2 * Math.PI * ( 1 - Math.cos( THREE.MathUtils.degToRad( 100 ) / 2 ) );

		expect( spot.intensity ).toBeCloseTo( 1800 / steradians, 2 );
		expect( spot.decay ).toBe( 2 );

		// A fixture's reach is the surface it faces, and three's window term
		// falls to zero at the cutoff, so the cutoff stands past that reach:
		// the floor under a downlight keeps its inverse-square value instead
		// of exactly nothing.
		const window = ( distance ) => ( 1 - ( distance / spot.distance ) ** 4 ) ** 2;
		expect( spot.distance ).toBeGreaterThan( 4 );
		expect( window( 4 ) ).toBeGreaterThan( 0.9 );
		// Unused lights in the pool go dark rather than being removed.
		expect( lights.slots[ 0 ].spots[ 1 ].intensity ).toBe( 0 );
		expect( lights.slots[ 1 ].spots[ 0 ].intensity ).toBe( 0 );

	} );

	it( 'aims a vertical colored capsule lens from its published face', () => {

		const lights = new RoomLights( factory, tier );
		const pod = room( 'pod', 0, 70 );
		pod.fixtures[ 0 ] = { ...pod.fixtures[ 0 ], kind: 'strip', length: 0.5,
			color: new THREE.Color( 0.025, 0.72, 1 ), axis: new THREE.Vector3( 0, 1, 0 ), direction: new THREE.Vector3( 1, 0, 0 ) };
		lights.update( [ pod ], new THREE.Vector3(), 1 );
		const source = lights.slots[ 0 ].strips[ 0 ];

		expect( new THREE.Vector3( 1, 0, 0 ).applyEuler( source.rotation ).distanceTo( new THREE.Vector3( 0, 1, 0 ) ) ).toBeLessThan( 1e-12 );
		const normal = new THREE.Vector3( 0, 0, - 1 ).applyEuler( source.rotation );
		expect( normal.x ).toBeCloseTo( 1 );
		expect( normal.y ).toBeCloseTo( 0 );
		expect( source.power ).toBeCloseTo( 70 );
		expect( source.color.toArray() ).toEqual( [ 0.025, 0.72, 1 ] );

	} );

	it( 'lights every room material from one pool of every slot\'s lights, with the fill read per copy', () => {

		const lights = new RoomLights( factory, tier );
		const key = 'cyberpunk/plaster/mid';

		const first = lights.materialFor( key );

		expect( lights.materialFor( key ) ).toBe( first );
		expect( first.lightsNode ).toBe( lights.pool.lightsNode );
		// A standard material loses `lightsNode` in the conversion the renderer
		// does for it, and the room comes out lit by the city instead of by
		// itself, which at night means not at all.
		expect( first.isNodeMaterial ).toBe( true );

		// The pool is the spots and strips of every slot and the per-copy fill:
		// no fill light of its own, which would light every room with every other's.
		const members = lights.pool.lightsNode.getLights();
		expect( members.filter( ( light ) => light.isLight ) ).toEqual( lights.slots.flatMap( ( slot ) => slot.members ) );
		expect( members.some( ( light ) => light.isHemisphereLight ) ).toBe( false );
		expect( members.filter( ( light ) => light instanceof RoomFillNode ) ).toHaveLength( 1 );

		// A source keeps its identity and its maps; an unlit one stays unlit.
		const source = new THREE.MeshStandardMaterial( { emissiveIntensity: 180, alphaTest: 0.5 } );
		const worn = lights.materialFor( key, source );
		expect( worn ).toBe( lights.materialFor( key, source ) );
		expect( worn ).not.toBe( first );
		expect( worn.emissiveIntensity ).toBe( 180 );
		expect( worn.alphaTest ).toBe( 0.5 );
		expect( lights.materialFor( key, new THREE.MeshBasicMaterial() ).lightsNode ).toBe( null );

	} );

} );
