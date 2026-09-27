import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FALL, RAIN_BOX, RAIN_LIGHT, RAIN_RENDER_ORDER, Rain, dropAt } from './Rain.js';
import { luminance } from '../light/Color.js';

const OPEN = { indoors: false, covered: false };
const SODIUM = new THREE.Color( 1, 0.62, 0.3 );
const street = ( lux, color = SODIUM ) => ( { color, lux } );
const SIZE = [ RAIN_BOX.width, RAIN_BOX.height, RAIN_BOX.width ];

function origins( rain ) {

	const array = rain.mesh.geometry.getAttribute( 'rainOrigin' ).array;
	const list = [];
	for ( let i = 0; i < array.length; i += 6 ) list.push( new THREE.Vector3().fromArray( array, i ) );
	return list;

}

function inBox( point, center ) {

	return point.toArray().every( ( value, axis ) => value >= center.getComponent( axis ) - SIZE[ axis ] / 2 - 1e-9
		&& value < center.getComponent( axis ) + SIZE[ axis ] / 2 + 1e-9 );

}

it( 'lays a fixed field of streaks inside one box, in one draw that stays in the world and draws after other transparent surfaces', () => {

	const rain = new Rain( 500 );
	expect( rain.mesh.geometry.getAttribute( 'rainOrigin' ).array ).toEqual( new Rain( 500 ).mesh.geometry.getAttribute( 'rainOrigin' ).array );
	expect( rain.mesh.geometry.getAttribute( 'position' ).count ).toBe( 1000 );
	for ( const origin of origins( rain ) ) expect( inBox( origin, new THREE.Vector3( ...SIZE ).multiplyScalar( 0.5 ) ) ).toBe( true );
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
	// Sorted by its origin-bound object, the rain would draw before closer paint or glass that then covers it.
	expect( rain.mesh.renderOrder ).toBe( RAIN_RENDER_ORDER );
	expect( RAIN_RENDER_ORDER ).toBeGreaterThan( 1 );

} );

it( 'keeps every drop in its world place while the eye walks, wrapping only what leaves the box', () => {

	const rain = new Rain( 400 ), fallen = 5.5;
	const center = new THREE.Vector3( 483.2, 5.7, - 217.9 );
	let before = origins( rain ).map( ( origin ) => dropAt( origin, fallen, center ) );
	let wrapped = 0;
	// A walk of small steps and one long stride, each shorter than half the box.
	for ( const step of [ [ 0.7, 0, 0.3 ], [ - 1.4, 0.2, 2.1 ], [ 9, 0, - 7 ], [ 17.9, 0, 0 ], [ 0, - 7.9, 0 ] ] ) {

		center.add( new THREE.Vector3( ...step ) );
		const after = origins( rain ).map( ( origin ) => dropAt( origin, fallen, center ) );
		after.forEach( ( drop, index ) => {

			expect( inBox( drop, center ) ).toBe( true );
			if ( inBox( before[ index ], center ) ) {

				expect( drop.distanceTo( before[ index ] ) ).toBeLessThan( 1e-9 );
				return;

			}
			// Left behind on one side, it comes back exactly one box away on the other.
			wrapped ++;
			const moved = drop.clone().sub( before[ index ] ).toArray();
			moved.forEach( ( metres, axis ) => expect( [ 0, SIZE[ axis ] ] ).toContainEqual( Math.round( Math.abs( metres ) * 1e6 ) / 1e6 ) );

		} );
		before = after;

	}
	expect( wrapped ).toBeGreaterThan( 0 );

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
	// A drop falls straight down by what it fell, wrapping at the bottom of the box.
	const origin = new THREE.Vector3( 3, 12, 7 ), center = new THREE.Vector3( 18, 8, 18 );
	expect( dropAt( origin, 2, center ).toArray() ).toEqual( [ 3, 10, 7 ] );
	expect( dropAt( origin, 13, center ).toArray() ).toEqual( [ 3, 15, 7 ] );

} );

it( 'follows the air light at the eye within a bounded range, eased, and tinted only a little', () => {

	const camera = new THREE.PerspectiveCamera();
	const settled = ( lux, color ) => {

		const rain = new Rain( 10 );
		rain.update( camera, OPEN, street( lux, color ), 1 / 60 );
		return rain;

	};
	expect( luminance( settled( 0, new THREE.Color( 0, 0, 0 ) ).light.value ) ).toBeCloseTo( RAIN_LIGHT.base );
	expect( settled( 0, new THREE.Color( 0, 0, 0 ) ).light.value.b ).toBeGreaterThan( settled( 0, new THREE.Color( 0, 0, 0 ) ).light.value.r );

	// Under a 24000 lm lamp on a 6.4 m pole the air holds about 86 lux; mid-block between lamps 30 m apart, about 15.
	const lamp = luminance( settled( 86 ).light.value ), block = luminance( settled( 15 ).light.value );
	expect( lamp ).toBeGreaterThan( block );
	expect( lamp / block ).toBeLessThan( 2.5 );
	expect( luminance( settled( 1e6 ).light.value ) ).toBeLessThan( 1100 );

	// A sodium lamp warms the streaks without turning the rain orange.
	const warm = settled( 20 ).light.value;
	expect( warm.r ).toBeGreaterThan( warm.b );
	expect( warm.b / warm.r ).toBeGreaterThan( 0.5 );
	for ( const channel of warm.toArray() ) expect( Number.isFinite( channel ) ).toBe( true );

	// Walking out from under the lamp dims the rain over about a second, not in one frame; a held world holds it.
	const rain = settled( 86 );
	rain.update( camera, OPEN, street( 15 ), 1 / 60 );
	expect( luminance( rain.light.value ) ).toBeGreaterThan( lamp * 0.95 );
	rain.update( camera, OPEN, street( 15 ), 0 );
	const held = luminance( rain.light.value );
	rain.update( camera, OPEN, street( 15 ), 0 );
	expect( luminance( rain.light.value ) ).toBe( held );
	for ( let frame = 0; frame < 60; frame ++ ) rain.update( camera, OPEN, street( 15 ), 1 / 60 );
	expect( luminance( rain.light.value ) / block ).toBeLessThan( 1.15 );

} );

it( 'clears the air around an eye under cover, hides indoors and takes the street light again at the door', () => {

	const rain = new Rain( 10 ), camera = new THREE.PerspectiveCamera();
	rain.update( camera, OPEN, street( 20 ), 0.1 );
	expect( rain.mesh.visible ).toBe( true );
	rain.update( camera, { covered: true }, street( 20 ), 0.1 );
	expect( rain.mesh.visible ).toBe( true );
	expect( rain.dry.value ).toBeGreaterThan( 1 );
	// A lit room's air never reaches the rain; stepping out shows the street's own at once.
	rain.update( camera, { indoors: true }, { color: new THREE.Color( 1, 1, 1 ), lux: 400 }, 0.1 );
	expect( rain.mesh.visible ).toBe( false );
	rain.update( camera, OPEN, street( 2 ), 1 / 60 );
	expect( rain.dry.value ).toBe( 0 );
	expect( luminance( rain.light.value ) ).toBeCloseTo( RAIN_LIGHT.base + RAIN_LIGHT.perRootLux * Math.sqrt( 2 ) );

} );
