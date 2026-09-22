import { expect, it } from 'vitest';
import { MeshStandardNodeMaterial, PerspectiveCamera } from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import { ExteriorScenery } from '../game/city/ExteriorScenery.js';
import { FloorSlicer } from './FloorSlicer.js';

it( 'keeps exterior visibility and floor slicing active together on the same material', () => {

	const outline = [ [ 10, 20 ], [ 18, 20 ], [ 18, 28 ], [ 10, 28 ] ];
	const floors = [
		{ index: 0, outline, elevation: 0, height: 4 },
		{ index: 1, outline, elevation: 4, height: 4 }
	];
	const scenery = new ExteriorScenery( { floors } );
	const material = scenery.attach( new MeshStandardNodeMaterial() );
	const slicer = new FloorSlicer( floors );
	slicer.attach( material );
	const mask = material.maskNode;
	slicer.attach( material );
	expect( material.maskNode ).toBe( mask );
	expect( slicer.cut.groupNode ).toBe( renderGroup );
	const nodes = [];
	mask.traverse( node => nodes.push( node ) );
	expect( nodes ).toContain( scenery.visible );
	expect( nodes ).toContain( slicer.cut );
	expect( nodes.some( node => node.op === '&&' ) ).toBe( true );
	expect( nodes.some( node => node.op === '<=' ) ).toBe( true );

	const camera = new PerspectiveCamera();
	camera.position.set( 9, 1.7, 22 );
	scenery.visible.update( { camera } );
	slicer.apply( '0' );
	expect( scenery.visible.value ).toBe( true );
	expect( slicer.cut.value ).toBeCloseTo( 3.95 );

	camera.position.set( 12, 1.7, 22 );
	scenery.visible.update( { camera } );
	slicer.apply( '1' );
	expect( scenery.visible.value ).toBe( false );
	expect( slicer.cut.value ).toBeCloseTo( 7.95 );

	camera.position.set( 9, 1.7, 22 );
	scenery.visible.update( { camera } );
	slicer.apply( 'full' );
	expect( scenery.visible.value ).toBe( true );
	expect( slicer.cut.value ).toBeGreaterThan( 8 );
	expect( material.maskNode ).toBe( mask );

} );
