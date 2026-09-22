import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { LitWindows } from './LitWindows.js';
import { pointInRing } from '../ground/Polygons.js';

function fixture( { hasInterior = false, outline = [ [ 0, 0 ], [ 20, 0 ], [ 20, 10 ], [ 0, 10 ] ] } = {} ) {

	const floor = {
		elevation: 3, height: 3.5, outline,
		openings: Array.from( { length: 8 }, ( _, i ) => ( {
			id: `w${i}`, kind: 'window', edge: 0, offset: i * 2.4 + 0.65, width: 1.8, height: 2, sill: 0.8
		} ) )
	};
	const atlas = { meta: { seed: 'night' }, parcels: [ { id: 'shell', type: 'residential' } ] };
	const buildings = new Map( [ [ 'shell', { hasInterior, blueprint: { facade: { wallDepth: 0.55 }, floors: [ floor ] } } ] ] );
	const map = new THREE.Texture();
	const factory = {
		build: vi.fn( () => ( { map } ) ),
		resolver: { resolve: vi.fn( ( key ) => ( { aspect: key.includes( 'office-wide' ) ? [ 2, 1 ] : [ 1, 1 ] } ) ) }
	};
	return { windows: new LitWindows( atlas, buildings, factory ), floor, factory, buildings };

}

describe( 'shell window rooms', () => {

	it( 'builds one textured box per window, a metre deep behind the glazing plane', () => {

		const { windows, factory, floor } = fixture();
		const group = windows.build();
		expect( factory.build ).toHaveBeenCalledWith( 'cyberpunk/window-room-wall/mid', 'plain' );
		expect( group.children ).toHaveLength( 5 );
		const rooms = group.getObjectByName( 'lit-windows:window-room-wall:plain' );
		const lamps = group.getObjectByName( 'lit-windows:fixtures' );
		expect( group.children.filter( ( mesh ) => mesh !== lamps )
			.reduce( ( sum, mesh ) => sum + mesh.geometry.getAttribute( 'position' ).count, 0 ) ).toBe( 8 * 30 );
		const roomVertices = rooms.geometry.getAttribute( 'position' );
		for ( let i = 0; i < roomVertices.count; i += 3 ) {

			expect( [ 0, 1, 2 ].every( ( j ) => Math.abs( roomVertices.getZ( i + j ) - 0.61 ) < 1e-5 ) ).toBe( false );

		}
		expect( lamps.geometry.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );
		expect( lamps.geometry.getAttribute( 'position' ).count ).toBeLessThanOrEqual( 8 * 30 );
		for ( const mesh of group.children ) {

			expect( mesh.material.emissiveNode ).toBeTruthy();
			const p = mesh.geometry.getAttribute( 'position' );
			for ( let i = 0; i < p.count; i ++ ) {

				expect( pointInRing( p.getX( i ), p.getZ( i ), floor.outline ) ).toBe( true );
				expect( p.getZ( i ) ).toBeGreaterThanOrEqual( 0.55 - 1e-6 );
				expect( p.getZ( i ) ).toBeLessThanOrEqual( 1.55 + 1e-6 );
				expect( p.getY( i ) ).toBeGreaterThan( floor.elevation );
				expect( p.getY( i ) ).toBeLessThan( floor.elevation + floor.height );

			}

		}
		windows.dispose();

		// The metre is measured from the published glazing, not from the lining,
		// however deep the shell wall around it is.
		const deep = fixture();
		deep.buildings.get( 'shell' ).blueprint.facade.wallDepth = 4;
		deep.floor.openings = [ { ...deep.floor.openings[ 0 ], glazing: {
			offset: 0.65, width: 1.8, sill: 0.8, height: 2, glassDepth: 0.2, housingBackDepth: 0.29
		} } ];
		const depths = deep.windows.build().children.flatMap( mesh => {

			const positions = mesh.geometry.getAttribute( 'position' );
			return Array.from( { length: positions.count }, ( _, i ) => positions.getZ( i ) );

		} );
		expect( Math.min( ...depths ) ).toBeCloseTo( 0.2 );
		expect( Math.max( ...depths ) ).toBeCloseTo( 1.2 );
		deep.windows.dispose();

	} );

	it( 'builds no fallback room where the shell already answers for the window', () => {

		// An authored exterior room node, a disabled run, a
		// door, a basement window and opaque glazing each leave the shell alone.
		const authored = fixture();
		authored.floor.openings.forEach( opening => { opening.scenery = { nodeId: 'scenery:1' }; } );
		expect( authored.windows.build().children ).toHaveLength( 0 );
		expect( authored.factory.build ).not.toHaveBeenCalled();

		const shell = fixture();
		expect( shell.windows.build( { enabled: false } ).children ).toHaveLength( 0 );
		shell.floor.openings.forEach( ( opening ) => { opening.kind = 'door'; } );
		expect( shell.windows.build().children ).toHaveLength( 0 );
		shell.floor.openings[ 0 ].kind = 'window';
		shell.floor.elevation = - 3;
		expect( shell.windows.build().children ).toHaveLength( 0 );

		const opaque = fixture();
		const key = 'cyberpunk/window-glass-opaque/rich';
		opaque.floor.openings.forEach( ( opening ) => { opening.material = key; } );
		opaque.factory.resolver = { resolve: vi.fn( () => ( { physical: { transmission: 0 } } ) ) };
		expect( opaque.windows.build().children ).toHaveLength( 0 );
		expect( opaque.factory.resolver.resolve ).toHaveBeenCalledWith( key );
		opaque.factory.resolver.resolve.mockReturnValue( { physical: { transmission: 0.78 } } );
		expect( opaque.windows.build().children.length ).toBeGreaterThan( 0 );
		opaque.windows.dispose();

	} );

	it( 'keeps fallback room images outside furnished buildings and removes them from the interior view', () => {

		const { windows } = fixture( { hasInterior: true } );
		const group = windows.build();
		expect( group.children.length ).toBeGreaterThan( 0 );
		const camera = new THREE.PerspectiveCamera();
		for ( const [ position, visible ] of [ [ [ 2, 4.7, - 2 ], true ], [ [ 2, 4.7, 2 ], false ], [ [ 2, 4.7, - 2 ], true ] ] ) {

			camera.position.set( ...position );
			camera.updateMatrixWorld();
			for ( const mesh of group.children ) {

				mesh.material.maskNode.update( { camera } );
				expect( mesh.material.maskNode.value ).toBe( visible );

			}

		}
		windows.dispose();

	} );

	it( 'omits a box that cannot fit behind the shell', () => {

		const { windows, floor } = fixture( { outline: [ [ 0, 0 ], [ 20, 0 ], [ 20, 8 ], [ 10, 8 ], [ 10, 0.5 ], [ 9, 0.5 ], [ 9, 8 ], [ 0, 8 ] ] } );
		floor.openings = [ { id: 'notch', kind: 'window', edge: 0, offset: 8, width: 3, sill: 0.8, height: 2 } ];
		expect( windows.build().children ).toHaveLength( 0 );
		const narrow = fixture( { outline: [ [ 0, 0 ], [ 20, 0 ], [ 20, 0.5 ], [ 0, 0.5 ] ] } );
		expect( narrow.windows.build().children ).toHaveLength( 0 );

	} );

} );
