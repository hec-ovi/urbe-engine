import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { EnvironmentProbe } from './EnvironmentProbe.js';

/** A renderer that only counts the face renders and remembers what it drew. */
function renderer() {

	const seen = { renders: 0, target: null, hidden: [], mrt: null };
	return {
		seen,
		coordinateSystem: THREE.WebGPUCoordinateSystem,
		xr: { enabled: false },
		reversedDepthBuffer: false,
		autoClear: true,
		getRenderTarget: () => seen.target,
		getMRT: () => seen.mrt, setMRT: next => { seen.mrt = next; },
		setRenderTarget: ( target ) => { seen.target = target; },
		render: ( scene ) => { expect( seen.mrt ).toBeNull(); seen.renders ++; seen.hidden.push( scene.getObjectByName( 'crowd' ).visible ); }
	};

}

function probe() {

	const scene = new THREE.Scene();
	const crowd = new THREE.Group();
	crowd.name = 'crowd';
	scene.add( crowd );
	const r = renderer();
	const convolved = [];
	const p = new EnvironmentProbe( r, scene, { probeSize: 8, probeInterval: 10 }, null, ( renderer, texture, previous ) => {

		expect( renderer.getMRT() ).toBeNull();
		expect( renderer.toneMapping ).toBe( THREE.NoToneMapping );
		const target = previous ?? { texture: { id: convolved.length }, dispose: () => { throw new Error( 'Resident environment was disposed' ); } };
		convolved.push( target );
		return target;

	} );
	p.exclude( crowd );
	return { p, r, scene, crowd, convolved };

}

describe( 'EnvironmentProbe', () => {

	it( 'stands a resident environment from the start, bakes the loading probe a face per ask of the budget, then rebakes one face per frame once the player moved and stands still', async () => {

		const { p, r, scene, crowd, convolved } = probe();

		// Built, not yet baked: the scene already reflects the one texture
		// every bake will write into, so nothing compiled now is built again.
		expect( convolved ).toHaveLength( 1 );
		expect( scene.environment ).toBe( convolved[ 0 ].texture );
		expect( r.seen.target ).toBeNull();

		r.seen.mrt = { emissive: true };
		let asked = 0;
		const faces = [];
		await p.bakeAsync( new THREE.Vector3( 0, 1, 0 ), { slice: { step: async () => { asked ++; } }, onProgress: ( done, total ) => faces.push( [ done, total ] ) }, - Infinity );
		expect( r.seen.mrt ).toEqual( { emissive: true } );

		expect( r.seen.renders ).toBe( 6 );
		expect( asked ).toBe( 6 );
		expect( faces ).toEqual( [ [ 1, 6 ], [ 2, 6 ], [ 3, 6 ], [ 4, 6 ], [ 5, 6 ], [ 6, 6 ] ] );
		// the excluded groups are hidden only while the faces render
		expect( r.seen.hidden ).toEqual( [ false, false, false, false, false, false ] );
		expect( crowd.visible ).toBe( true );
		expect( r.seen.target ).toBeNull();
		expect( scene.environment ).toBe( convolved[ 0 ].texture );
		expect( convolved[ 1 ] ).toBe( convolved[ 0 ] );

		const far = new THREE.Vector3( 30, 1, 0 );
		p.update( far, false );
		expect( p.baking ).toBe( false );

		p.update( far, true );
		expect( p.baking ).toBe( true );

		for ( let i = 0; i < 5; i ++ ) p.update( far, false );
		expect( r.seen.renders ).toBe( 11 );
		expect( scene.environment ).toBe( convolved[ 0 ].texture );

		p.update( far, false );
		expect( r.seen.renders ).toBe( 12 );
		expect( p.baking ).toBe( false );
		expect( scene.environment ).toBe( convolved[ 0 ].texture );
		expect( convolved[ 2 ] ).toBe( convolved[ 0 ] );

		// the same spot asks for nothing more
		p.update( far, true );
		expect( p.baking ).toBe( false );

	} );

	it( 'draws each face in the frame\'s render context, into a square target made like the frame\'s, and copies it into the cube, preparing nothing', async () => {

		const scene = new THREE.Scene();
		const crowd = new THREE.Group();
		crowd.name = 'crowd';
		scene.add( crowd );
		const frame = { renderTarget: new THREE.RenderTarget( 200, 100, { type: THREE.HalfFloatType, samples: 4, count: 2 } ), mrt: { id: 'frame outputs' } };
		const draws = [];
		let target = null, mrt = 'frame';
		const r = {
			coordinateSystem: THREE.WebGPUCoordinateSystem, xr: { enabled: false }, reversedDepthBuffer: false, autoClear: true,
			toneMapping: THREE.AgXToneMapping,
			getRenderTarget: () => target, setRenderTarget: ( next, face ) => { target = next; draws.face = face; },
			getMRT: () => mrt, setMRT: ( next ) => { mrt = next; },
			render: ( drawn ) => draws.push( {
				quad: Boolean( drawn.isQuadMesh ), target, face: draws.face, mrt, crowd: drawn.getObjectByName?.( 'crowd' )?.visible,
				tone: r.toneMapping
			} )
		};
		const p = new EnvironmentProbe( r, scene, { probeSize: 8, probeInterval: 10 }, null, ( renderer, texture, previous ) => previous ?? { texture: {}, dispose() {} } );
		p.exclude( crowd );
		p.share( frame );

		expect( await p.prepare( { sibling: () => { throw new Error( 'a shared probe builds no graphs' ); } } ) ).toBe( 0 );
		p.bake( new THREE.Vector3( 0, 1, 0 ), - Infinity );

		expect( draws ).toHaveLength( 12 );
		for ( let face = 0; face < 6; face ++ ) {

			const [ drawn, copied ] = draws.slice( face * 2, face * 2 + 2 );
			// The face with the frame's outputs, the crowd left out.
			expect( drawn ).toMatchObject( { quad: false, target: p.face2d, mrt: frame.mrt, crowd: false, tone: THREE.NoToneMapping } );
			// Then copied into its cube face.
			expect( copied ).toMatchObject( { quad: true, target: p.cube, face, mrt: null } );

		}
		// Made like the frame's target, which is what makes the render context the frame's.
		expect( [ p.face2d.width, p.face2d.height ] ).toEqual( [ 8, 8 ] );
		expect( p.face2d.samples ).toBe( 4 );
		expect( p.face2d.textures ).toHaveLength( 2 );
		expect( p.face2d.texture.type ).toBe( THREE.HalfFloatType );
		expect( target ).toBeNull();
		expect( mrt ).toBe( 'frame' );
		expect( r.toneMapping ).toBe( THREE.AgXToneMapping );
		expect( crowd.visible ).toBe( true );

		// Its own graphs on request, paced by the caller, then its own faces again.
		const passes = [];
		const budget = { step: async () => {} };
		await p.prepare( { sibling: ( options ) => ( { warmAll: async ( object, { skip } ) => { passes.push( { options, object, skipsCrowd: skip( crowd ) } ); return 1; } } ) }, undefined, { own: true, budget } );
		expect( passes ).toEqual( [ { options: { camera: p.camera.children[ 0 ], renderTarget: p.cube, mrt: null, budget }, object: scene, skipsCrowd: true } ] );
		p.unshare();
		draws.length = 0;
		p.bake( new THREE.Vector3( 0, 1, 0 ), - Infinity );
		expect( draws ).toHaveLength( 6 );
		expect( draws.every( ( drawn ) => drawn.target === p.cube && drawn.mrt === null && ! drawn.quad ) ).toBe( true );

	} );

	it( 'prepares the faces\' own graphs through a sibling of the frame warm-up, against the cube and without the excluded groups', async () => {

		const { p, scene, crowd } = probe();
		const passes = [];
		const warmup = { sibling: ( options ) => ( { warmAll: async ( object, { skip, onProgress } ) => { passes.push( { options, object, skipsCrowd: skip( crowd ), skipsScene: skip( scene ) } ); onProgress( 3, 3 ); } } ) };
		const progress = [];

		await p.prepare( warmup, ( done, total ) => progress.push( [ done, total ] ) );

		expect( passes ).toHaveLength( 1 );
		expect( passes[ 0 ].options ).toEqual( { camera: p.camera.children[ 0 ], renderTarget: p.cube, mrt: null } );
		expect( passes[ 0 ].object ).toBe( scene );
		expect( passes[ 0 ].skipsCrowd ).toBe( true );
		expect( passes[ 0 ].skipsScene ).toBe( false );
		expect( progress ).toEqual( [ [ 3, 3 ] ] );

	} );

} );
