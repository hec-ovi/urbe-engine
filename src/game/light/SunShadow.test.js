import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SunShadow, fit } from './SunShadow.js';

const high = { sunShadow: 2048, sunShadowReach: 140 };
const noon = new THREE.Vector3( 0.3, 0.8, 0.2 ).normalize();

function camera( x, z, yaw = 0 ) {

	const view = new THREE.PerspectiveCamera();
	view.position.set( x, 1.7, z );
	view.rotation.set( 0, yaw, 0 );
	view.updateMatrixWorld();

	return view;

}

describe( 'SunShadow', () => {

	it( 'lets the renderer draw shadow maps only on a tier that pays for the sun\'s', () => {

		for ( const [ tier, enabled ] of [ [ { sunShadow: 0 }, false ], [ high, true ] ] ) {

			const renderer = { shadowMap: { enabled: ! enabled, type: null } };
			SunShadow.prepare( renderer, tier );
			expect( renderer.shadowMap.enabled ).toBe( enabled );

		}
		// A renderer stand-in with no shadow map at all is left alone.
		expect( () => SunShadow.prepare( {}, high ) ).not.toThrow();

	} );

	it( 'casts for the whole run on its tier, and not at all on one without it', () => {

		const off = new SunShadow( new THREE.DirectionalLight(), { sunShadow: 0 } );
		expect( off.key.castShadow ).toBe( false );
		expect( off.pass() ).toBeNull();
		off.update( camera( 0, 0 ), noon, 1 );
		expect( off.key.shadow.needsUpdate ).toBe( false );

		const sun = new SunShadow( new THREE.DirectionalLight(), high );
		expect( sun.key.castShadow ).toBe( true );
		expect( sun.key.shadow.mapSize.x ).toBe( 2048 );
		expect( sun.key.shadow.autoUpdate ).toBe( false );
		expect( sun.key.shadow.camera.right - sun.key.shadow.camera.left ).toBe( 140 );

	} );

	it( 'draws its map by day only, fading in with the daylight, and keeps the key\'s direction', () => {

		const sun = new SunShadow( new THREE.DirectionalLight(), high );

		// The moon casts nothing: no map, no weight, castShadow untouched.
		sun.update( camera( 100, 200 ), noon, 0 );
		expect( sun.key.shadow.needsUpdate ).toBe( false );
		expect( sun.key.shadow.intensity ).toBe( 0 );
		expect( sun.key.castShadow ).toBe( true );

		sun.update( camera( 100, 200 ), noon, 0.25 );
		const dawn = sun.key.shadow.intensity;
		expect( dawn ).toBeGreaterThan( 0 );
		expect( dawn ).toBeLessThan( 1 );
		expect( sun.key.shadow.needsUpdate ).toBe( true );

		// Full day at the same square only changes the weight. The map stays.
		sun.update( camera( 100, 200 ), noon, 1 );
		expect( sun.key.shadow.intensity ).toBe( 1 );
		expect( sun.key.shadow.needsUpdate ).toBe( false );

		// The fitted square has not moved, so the near city is not drawn again.
		sun.update( camera( 100, 200 ), noon, 1 );
		expect( sun.key.shadow.needsUpdate ).toBe( false );
		sun.update( camera( 160, 260 ), noon, 1 );
		expect( sun.key.shadow.needsUpdate ).toBe( true );
		sun.update( camera( 100, 200 ), noon, 1 );

		// The key stands along the sun from the ground ahead of the camera.
		const along = sun.key.position.clone().sub( sun.key.target.position ).normalize();
		expect( along.distanceTo( noon ) ).toBeLessThan( 1e-9 );
		// Snapped to the light's texels, it stands within one of the ground.
		expect( Math.abs( sun.key.target.position.y ) ).toBeLessThan( 140 / 2048 );
		// A camera looking down -z has the map's centre ahead of it.
		expect( sun.key.target.position.z ).toBeLessThan( 200 );
		expect( Math.hypot( sun.key.target.position.x - 100, sun.key.target.position.z - 158 ) ).toBeLessThan( 1 );

	} );

	it( 'moves the map in whole texels as the light sees it', () => {

		const texel = 140 / 2048;
		const light = new THREE.Matrix4().lookAt( noon, new THREE.Vector3(), new THREE.Vector3( 0, 1, 0 ) );
		const across = ( point ) => point.clone().applyMatrix4( light.clone().transpose() );
		const first = across( fit( new THREE.Vector3(), camera( 10, 10 ), 140, 2048, noon ) );

		for ( const step of [ 0.01, 0.37, 2.5, 13.1 ] ) {

			const next = across( fit( new THREE.Vector3(), camera( 10 + step, 10 - step / 3 ), 140, 2048, noon ) );
			for ( const axis of [ 'x', 'y' ] ) {

				const texels = ( next[ axis ] - first[ axis ] ) / texel;
				expect( Math.abs( texels - Math.round( texels ) ) ).toBeLessThan( 1e-6 );

			}

		}
		// Less than half a texel of walking leaves it where it was.
		const still = across( fit( new THREE.Vector3(), camera( 10 + texel / 10, 10 ), 140, 2048, noon ) );
		expect( still.x ).toBeCloseTo( first.x, 9 );

	} );

	it( 'hands a warm-up the pass it compiles casters against: its camera, its one material, a map of its formats', () => {

		const sun = new SunShadow( new THREE.DirectionalLight(), high );
		const pass = sun.pass();

		expect( pass.camera ).toBe( sun.key.shadow.camera );
		expect( pass.material.isShadowPassMaterial ).toBe( true );
		expect( pass.target.depthTexture ).toBeInstanceOf( THREE.DepthTexture );
		expect( pass.target.texture.type ).toBe( sun.key.shadow.mapType );
		expect( sun.pass().target ).toBe( pass.target );
		expect( sun.key.shadow.shadowNode ).toBe( sun.node );

	} );

} );
