import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { EnvironmentProbe } from './EnvironmentProbe.js';

/** A renderer that only counts the face renders and remembers what it drew. */
function renderer() {

	const seen = { renders: 0, target: null, hidden: [] };
	return {
		seen,
		coordinateSystem: THREE.WebGPUCoordinateSystem,
		xr: { enabled: false },
		reversedDepthBuffer: false,
		autoClear: true,
		getRenderTarget: () => seen.target,
		setRenderTarget: ( target ) => { seen.target = target; },
		render: ( scene ) => { seen.renders ++; seen.hidden.push( scene.getObjectByName( 'crowd' ).visible ); }
	};

}

function probe() {

	const scene = new THREE.Scene();
	const crowd = new THREE.Group();
	crowd.name = 'crowd';
	scene.add( crowd );
	const r = renderer();
	const convolved = [];
	const p = new EnvironmentProbe( r, scene, { probeSize: 8, probeInterval: 10 }, null, () => {

		const target = { texture: { id: convolved.length }, dispose: () => {} };
		convolved.push( target );
		return target;

	} );
	p.exclude( crowd );
	return { p, r, scene, crowd, convolved };

}

describe( 'EnvironmentProbe', () => {

	it( 'bakes the loading probe in one go, with the excluded groups hidden only while rendering', () => {

		const { p, r, scene, crowd, convolved } = probe();

		p.bake( new THREE.Vector3( 0, 1, 0 ) );

		expect( r.seen.renders ).toBe( 6 );
		expect( r.seen.hidden ).toEqual( [ false, false, false, false, false, false ] );
		expect( crowd.visible ).toBe( true );
		expect( r.seen.target ).toBeNull();
		expect( scene.environment ).toBe( convolved[ 0 ].texture );

	} );

	it( 'rebakes one face per frame once the player has moved far enough and stands still', () => {

		const { p, r, scene, convolved } = probe();
		p.bake( new THREE.Vector3( 0, 1, 0 ), - Infinity );
		const far = new THREE.Vector3( 30, 1, 0 );

		p.update( far, false );
		expect( p.baking ).toBe( false );

		p.update( far, true );
		expect( p.baking ).toBe( true );
		expect( r.seen.renders ).toBe( 6 );

		for ( let i = 0; i < 5; i ++ ) p.update( far, false );
		expect( r.seen.renders ).toBe( 11 );
		expect( scene.environment ).toBe( convolved[ 0 ].texture );

		p.update( far, false );
		expect( r.seen.renders ).toBe( 12 );
		expect( p.baking ).toBe( false );
		expect( scene.environment ).toBe( convolved[ 1 ].texture );

		// the same spot asks for nothing more
		p.update( far, true );
		expect( p.baking ).toBe( false );

	} );

} );
