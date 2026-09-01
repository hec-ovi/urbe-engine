import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CityLights } from './CityLights.js';

const fixture = ( x, lumens, color ) => ( {
	position: new THREE.Vector3( x, 6, 0 ),
	lumens,
	color: new THREE.Color( color ),
	range: 20
} );

/**
 * Two promises. Every fixture is lit at the flux the world published for it, in
 * the units three wants, so one exposure works city-wide. And where the backend
 * can only carry a handful, the handful is the nearest ones, chosen without
 * ever removing a light from the scene.
 */
describe( 'CityLights', () => {

	it( 'lights each fixture at its published flux, with inverse-square falloff', () => {

		const lights = new CityLights( [ fixture( 0, 12000, 0xffffff ) ], 8 );
		const light = lights.lights[ 0 ];

		// power is lumens; three converts to the candela the shader wants.
		expect( light.power ).toBeCloseTo( 12000, 3 );
		expect( light.intensity ).toBeCloseTo( 12000 / ( 4 * Math.PI ), 3 );
		expect( light.decay ).toBe( 2 );
		// A clustered light with a zero radius is binned nowhere and emits
		// nothing at all, silently.
		expect( light.distance ).toBe( 20 );
		expect( light.castShadow ).toBe( false );

	} );

	it( 'keeps the nearest fixtures lit when the backend cannot carry them all', () => {

		const lights = new CityLights(
			[ fixture( 0, 1000 ), fixture( 50, 1000 ), fixture( 100, 1000 ) ],
			2
		);

		lights.update( new THREE.Vector3( 100, 0, 0 ), 1 );

		expect( lights.lights.map( ( l ) => l.visible ) ).toEqual( [ false, true, true ] );
		expect( lights.count ).toBe( 2 );

	} );

	it( 'reads back the colour of the light filling the air, weighted by flux', () => {

		const lights = new CityLights( [
			fixture( 0, 9000, 0xff0000 ),
			fixture( 3, 1000, 0x0000ff )
		], 8 );

		const air = lights.airColor( new THREE.Vector3( 0, 0, 0 ) );

		expect( air.color.r ).toBeGreaterThan( air.color.b );
		expect( air.lux ).toBeGreaterThan( 0 );

	} );

	it( 'reports no air colour where no fixture reaches', () => {

		const lights = new CityLights( [ fixture( 0, 9000, 0xff0000 ) ], 8 );
		const air = lights.airColor( new THREE.Vector3( 500, 0, 0 ) );

		expect( air.lux ).toBe( 0 );

	} );

} );
