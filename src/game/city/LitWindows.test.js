import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { LitWindows } from './LitWindows.js';
import { pointInRing } from '../ground/Polygons.js';

function fixture( { hasInterior = false, seed = 'night', outline = [ [ 0, 0 ], [ 20, 0 ], [ 20, 10 ], [ 0, 10 ] ] } = {} ) {

	const floor = {
		elevation: 3, height: 3.5, outline,
		openings: Array.from( { length: 8 }, ( _, i ) => ( {
			id: `w${i}`, kind: 'window', edge: 0, offset: i * 2.4 + 0.65, width: 1.8, height: 2, sill: 0.8
		} ) )
	};
	const atlas = { meta: { seed }, parcels: [ { id: 'shell', type: 'residential' } ] };
	const buildings = new Map( [ [ 'shell', { hasInterior, blueprint: { facade: { wallDepth: 0.55 }, floors: [ floor ] } } ] ] );
	const map = new THREE.Texture();
	const factory = { build: vi.fn( () => ( { map } ) ) };
	return { windows: new LitWindows( atlas, buildings, factory ), atlas, floor, map, factory, buildings };

}

describe( 'shell window rooms', () => {

	it( 'builds textured recessed rooms and visible ceiling strips in bounded draws', () => {

		const { windows, factory, floor } = fixture();
		const group = windows.build();
		expect( factory.build ).toHaveBeenCalledWith( 'cyberpunk/plaster/mid', 'plain' );
		expect( group.children ).toHaveLength( 3 );
		const rooms = group.getObjectByName( 'lit-windows:rooms' );
		const lamps = group.getObjectByName( 'lit-windows:fixtures' );
		const plate = group.getObjectByName( 'lit-windows:plate:apartment' );
		expect( rooms.geometry.getAttribute( 'position' ).count + plate.geometry.getAttribute( 'position' ).count ).toBe( 8 * 30 );
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
				expect( p.getZ( i ) ).toBeGreaterThanOrEqual( 0.6 );
				expect( p.getZ( i ) ).toBeLessThanOrEqual( 3.21 );
				expect( p.getY( i ) ).toBeGreaterThan( floor.elevation );
				expect( p.getY( i ) ).toBeLessThan( floor.elevation + floor.height );

			}

		}
		windows.dispose();

	} );

	it( 'selects exact room images by use and crops them without stretching or repeating', () => {

		for ( const [ type, variant ] of [ [ 'corpo', 'office' ], [ 'residential', 'apartment' ], [ 'commerce', 'lobby' ] ] ) {

			const { windows, atlas, factory } = fixture();
			atlas.parcels[ 0 ].type = type;
			const group = windows.build();
			expect( factory.build ).toHaveBeenCalledWith( 'cyberpunk/window-room/mid', variant );
			const plate = group.getObjectByName( `lit-windows:plate:${variant}` );
			const uv = plate.geometry.getAttribute( 'uv' );
			const p = plate.geometry.getAttribute( 'position' );
			for ( const value of uv.array ) {

				expect( value ).toBeGreaterThanOrEqual( 0 );
				expect( value ).toBeLessThanOrEqual( 1 );

			}
			const width = Math.hypot( p.getX( 1 ) - p.getX( 0 ), p.getZ( 1 ) - p.getZ( 0 ) );
			const height = p.getY( 2 ) - p.getY( 1 );
			expect( ( uv.getX( 1 ) - uv.getX( 0 ) ) / ( uv.getY( 1 ) - uv.getY( 2 ) ) ).toBeCloseTo( width / height, 5 );
			expect( uv.getY( 0 ) ).toBe( 1 );
			expect( uv.getY( 2 ) ).toBe( 0 );
			windows.dispose();

		}

	} );

	it( 'gives unlit rooms opaque black surfaces and fewer ground-floor lit bays', () => {

		const upper = fixture();
		const ground = fixture();
		ground.floor.elevation = 0;
		const up = upper.windows.build();
		const down = ground.windows.build();
		const count = ( group ) => ( group.getObjectByName( 'lit-windows:fixtures' )?.geometry.getAttribute( 'position' ).count ?? 0 ) / 30;
		expect( count( down ) ).toBeLessThan( count( up ) );
		const rooms = up.getObjectByName( 'lit-windows:rooms' );
		expect( rooms.material.transparent ).toBe( false );
		const colors = rooms.geometry.getAttribute( 'color' ).array;
		let blackTriangles = 0;
		for ( let i = 0; i < colors.length; i += 9 ) if ( colors.slice( i, i + 9 ).every( ( value ) => value === 0 ) ) blackTriangles ++;
		expect( blackTriangles ).toBe( ( 8 - count( up ) ) * 10 );
		upper.windows.dispose();
		ground.windows.dispose();

	} );

	it( 'omits scenic rooms behind material-declared opaque glazing', () => {

		const { windows, floor, factory } = fixture();
		const key = 'cyberpunk/window-glass-opaque/rich';
		floor.openings.forEach( ( opening ) => { opening.material = key; } );
		factory.resolver = { resolve: vi.fn( () => ( { physical: { transmission: 0 } } ) ) };
		expect( windows.build().children ).toHaveLength( 0 );
		expect( factory.resolver.resolve ).toHaveBeenCalledWith( key );
		expect( factory.build ).not.toHaveBeenCalled();
		factory.resolver.resolve.mockReturnValue( { physical: { transmission: 0.78 } } );
		expect( windows.build().children.length ).toBeGreaterThan( 0 );
		windows.dispose();

	} );

	it( 'preserves seed identity, varies lighting between seeds and releases owned resources on rebuild', () => {

		const { windows, map } = fixture();
		const first = windows.build();
		const before = first.children.map( ( mesh ) => Array.from( mesh.geometry.getAttribute( 'color' ).array ) );
		const geometries = first.children.map( ( mesh ) => vi.spyOn( mesh.geometry, 'dispose' ) );
		const materials = first.children.map( ( mesh ) => vi.spyOn( mesh.material, 'dispose' ) );
		const textureDispose = vi.spyOn( map, 'dispose' );
		const again = windows.build();
		expect( again.children.map( ( mesh ) => Array.from( mesh.geometry.getAttribute( 'color' ).array ) ) ).toEqual( before );
		for ( const dispose of [ ...geometries, ...materials ] ) expect( dispose ).toHaveBeenCalledOnce();
		expect( textureDispose ).not.toHaveBeenCalled();
		const other = fixture( { seed: 'other-night' } ).windows;
		expect( Array.from( other.build().children[ 0 ].geometry.getAttribute( 'color' ).array ) ).not.toEqual( before[ 0 ] );
		windows.dispose();
		other.dispose();
		expect( again.children ).toHaveLength( 0 );

	} );

	it( 'keeps manifest interiors and disabled runs clear and ignores doors and basement windows', () => {

		const real = fixture( { hasInterior: true } );
		expect( real.windows.build().children ).toHaveLength( 0 );
		expect( real.factory.build ).not.toHaveBeenCalled();
		const shell = fixture();
		expect( shell.windows.build( { enabled: false } ).children ).toHaveLength( 0 );
		shell.floor.openings.forEach( ( opening ) => { opening.kind = 'door'; } );
		expect( shell.windows.build().children ).toHaveLength( 0 );
		shell.floor.openings[ 0 ].kind = 'window';
		shell.floor.elevation = - 3;
		expect( shell.windows.build().children ).toHaveLength( 0 );

	} );

	it( 'rejects rooms crossing a courtyard notch or unable to fit behind the shell', () => {

		const { windows, floor } = fixture( { outline: [ [ 0, 0 ], [ 20, 0 ], [ 20, 8 ], [ 10, 8 ], [ 10, 0.5 ], [ 9, 0.5 ], [ 9, 8 ], [ 0, 8 ] ] } );
		floor.openings = [ { id: 'notch', kind: 'window', edge: 0, offset: 8, width: 3, sill: 0.8, height: 2 } ];
		expect( windows.build().children ).toHaveLength( 0 );
		const narrow = fixture( { outline: [ [ 0, 0 ], [ 20, 0 ], [ 20, 0.5 ], [ 0, 0.5 ] ] } );
		expect( narrow.windows.build().children ).toHaveLength( 0 );

	} );

} );
