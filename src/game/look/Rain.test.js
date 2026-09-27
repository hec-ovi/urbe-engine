import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FALL, RAIN_BOX, RAIN_LIGHT, Rain } from './Rain.js';
import { luminance } from '../light/Color.js';

const OPEN = { indoors: false, covered: false };
const street = ( lux, color = new THREE.Color( 1, 0.62, 0.3 ) ) => ( { color, lux } );

it( 'lays a fixed field of streaks inside one box, in one draw that stays in the world', () => {

	const rain = new Rain( 500 );
	const origins = rain.mesh.geometry.getAttribute( 'rainOrigin' ).array;
	expect( origins ).toEqual( new Rain( 500 ).mesh.geometry.getAttribute( 'rainOrigin' ).array );
	expect( rain.mesh.geometry.getAttribute( 'position' ).count ).toBe( 1000 );
	for ( let i = 0; i < origins.length; i += 3 ) {

		expect( origins[ i ] ).toBeGreaterThanOrEqual( 0 ); expect( origins[ i ] ).toBeLessThan( RAIN_BOX.width );
		expect( origins[ i + 1 ] ).toBeGreaterThanOrEqual( 0 ); expect( origins[ i + 1 ] ).toBeLessThan( RAIN_BOX.height );
		expect( origins[ i + 2 ] ).toBeGreaterThanOrEqual( 0 ); expect( origins[ i + 2 ] ).toBeLessThan( RAIN_BOX.width );

	}
	// Drops wrap around the eye in the shader; the object never follows it, or walking would carry the rain along.
	const camera = new THREE.PerspectiveCamera();
	camera.position.set( 120, 1.7, - 40 );
	rain.update( camera, OPEN, street( 10 ), 1 / 60 );
	expect( rain.mesh.position.toArray() ).toEqual( [ 0, 0, 0 ] );
	expect( rain.center.value.x ).toBe( 120 );
	expect( rain.center.value.z ).toBe( - 40 );
	expect( rain.center.value.y ).toBeGreaterThan( 1.7 );
	expect( rain.mesh.frustumCulled ).toBe( false );
	expect( rain.mesh.material.depthWrite ).toBe( false );
	expect( rain.mesh.material.blending ).toBe( THREE.AdditiveBlending );

} );

it( 'falls with the world clock, within one box height, and holds while the world holds', () => {

	const rain = new Rain( 10 ), camera = new THREE.PerspectiveCamera();
	rain.update( camera, OPEN, street( 5 ), 0.5 );
	expect( rain.fallen.value ).toBeCloseTo( FALL * 0.5 );
	const before = rain.fallen.value;
	rain.update( camera, OPEN, street( 5 ), 0 );
	expect( rain.fallen.value ).toBe( before );
	for ( let i = 0; i < 3600; i ++ ) rain.update( camera, OPEN, street( 5 ), 1 );
	expect( rain.fallen.value ).toBeGreaterThanOrEqual( 0 );
	expect( rain.fallen.value ).toBeLessThan( RAIN_BOX.height );

} );

it( 'shows under street light, fades toward skyglow in the dark, clears around an eye under cover and hides indoors', () => {

	const rain = new Rain( 10 ), camera = new THREE.PerspectiveCamera();
	rain.update( camera, OPEN, street( 0, new THREE.Color( 0, 0, 0 ) ), 0.1 );
	expect( luminance( rain.light.value ) ).toBeCloseTo( RAIN_LIGHT.base );
	expect( rain.light.value.b ).toBeGreaterThan( rain.light.value.r );

	rain.update( camera, OPEN, street( 20 ), 0.1 );
	expect( luminance( rain.light.value ) ).toBeCloseTo( RAIN_LIGHT.base + 20 * RAIN_LIGHT.perLux );
	// A sodium lamp warms the streaks without turning the rain orange.
	expect( rain.light.value.r ).toBeGreaterThan( rain.light.value.b );
	expect( rain.light.value.b / rain.light.value.r ).toBeGreaterThan( 0.5 );
	for ( const channel of rain.light.value.toArray() ) expect( Number.isFinite( channel ) ).toBe( true );
	expect( rain.mesh.visible ).toBe( true );

	rain.update( camera, { covered: true }, street( 20 ), 0.1 );
	expect( rain.mesh.visible ).toBe( true );
	expect( rain.dry.value ).toBeGreaterThan( 1 );
	rain.update( camera, { indoors: true }, street( 20 ), 0.1 );
	expect( rain.mesh.visible ).toBe( false );
	rain.update( camera, OPEN, street( 20 ), 0.1 );
	expect( rain.dry.value ).toBe( 0 );

} );
