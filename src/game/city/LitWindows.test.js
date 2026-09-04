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
	const factory = {
		build: vi.fn( () => ( { map } ) ),
		resolver: { resolve: vi.fn( ( key ) => ( { aspect: key.includes( 'office-wide' ) ? [ 2, 1 ] : [ 1, 1 ] } ) ) }
	};
	return { windows: new LitWindows( atlas, buildings, factory ), atlas, floor, map, factory, buildings };

}

describe( 'shell window rooms', () => {

	it( 'builds textured recessed rooms and visible ceiling strips in bounded draws', () => {

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
			const backKind = variant === 'apartment' ? 'window-room' : 'window-room-office-wide';
			const backs = factory.build.mock.calls.filter( ( [ key ] ) => key === `cyberpunk/${backKind}/mid` );
			expect( backs.length ).toBeGreaterThan( 0 );
			for ( const [ , id ] of backs ) expect( variant === 'apartment' ? [ 'apartment' ] : [ 'office-a', 'office-b', 'office-c' ] ).toContain( id );
			for ( const kind of [ 'wall', 'floor', 'ceiling' ] ) {

				expect( factory.build ).toHaveBeenCalledWith( `cyberpunk/window-room-${kind}/mid`, 'plain' );

			}
			for ( const plate of group.children.filter( ( mesh ) => mesh.name !== 'lit-windows:fixtures' ) ) {

				const uv = plate.geometry.getAttribute( 'uv' );
				const p = plate.geometry.getAttribute( 'position' );
				for ( const value of uv.array ) {

					expect( value ).toBeGreaterThanOrEqual( 0 );
					expect( value ).toBeLessThanOrEqual( 1 );

				}
				const distance = ( a, b ) => Math.hypot( p.getX( a ) - p.getX( b ), p.getY( a ) - p.getY( b ), p.getZ( a ) - p.getZ( b ) );
				for ( let i = 0; i < p.count; i += 6 ) {

					expect( ( uv.getX( i + 1 ) - uv.getX( i ) ) / ( uv.getY( i + 1 ) - uv.getY( i + 2 ) ) )
						.toBeCloseTo( distance( i + 1, i ) / distance( i + 2, i + 1 ) / ( plate.name.includes( 'office-wide' ) ? 2 : 1 ), 5 );

				}

			}
			windows.dispose();

		}

	} );

	it( 'gives unlit upper rooms opaque black surfaces and excludes ground floors completely', () => {

		const upper = fixture();
		const ground = fixture();
		ground.floor.elevation = 0;
		const up = upper.windows.build();
		const down = ground.windows.build();
		const count = ( group ) => ( group.getObjectByName( 'lit-windows:fixtures' )?.geometry.getAttribute( 'position' ).count ?? 0 ) / 30;
		expect( down.children ).toHaveLength( 0 );
		expect( ground.factory.build ).not.toHaveBeenCalled();
		const rooms = up.getObjectByName( 'lit-windows:window-room-wall:plain' );
		expect( rooms.material.transparent ).toBe( false );
		const colors = rooms.geometry.getAttribute( 'color' ).array;
		let blackTriangles = 0;
		for ( let i = 0; i < colors.length; i += 9 ) if ( colors.slice( i, i + 9 ).every( ( value ) => value === 0 ) ) blackTriangles ++;
		expect( blackTriangles ).toBe( ( 8 - count( up ) ) * 10 );
		upper.windows.dispose();
		ground.windows.dispose();

	} );

	it( 'divides long facade openings into room bays no wider than five metres', () => {

		const { windows, floor, atlas, buildings, factory } = fixture( { outline: [ [ 0, 0 ], [ 40, 0 ], [ 40, 10 ], [ 0, 10 ] ] } );
		atlas.parcels[ 0 ].type = 'corpo';
		floor.openings = [ { id: 'wide', kind: 'window', edge: 0, offset: 1, width: 30, height: 2, sill: 0.8 } ];
		buildings.get( 'shell' ).blueprint.floors = [ floor, { ...floor, elevation: 6.5 }, { ...floor, elevation: 10 } ];
		const group = windows.build();
		const surfaces = group.children.filter( ( mesh ) => mesh.name !== 'lit-windows:fixtures' );
		expect( surfaces.reduce( ( sum, mesh ) => sum + mesh.geometry.getAttribute( 'position' ).count, 0 ) ).toBe( 18 * 30 );
		expect( factory.build.mock.calls.filter( ( [ key ] ) => key === 'cyberpunk/window-room-office-wide/mid' )
			.map( ( [ , id ] ) => id ).sort() ).toEqual( [ 'office-a', 'office-b', 'office-c' ] );
		expect( group.children.length ).toBeLessThanOrEqual( 8 );
		for ( const mesh of surfaces ) {

			const p = mesh.geometry.getAttribute( 'position' );
			for ( let i = 0; i < p.count; i += 6 ) {

				const x = Array.from( { length: 6 }, ( _, j ) => p.getX( i + j ) );
				expect( Math.max( ...x ) - Math.min( ...x ) ).toBeLessThanOrEqual( 5 );

			}

		}
		windows.dispose();

	} );

	it( 'seals oblique edge rays from an unlit bay against bright neighboring scenery', () => {

		for ( const housingDepth of [ 0.13, 0.7 ] ) {

			const { windows, floor } = fixture();
			const glazing = { offset: 2.065, sill: 0.865, width: 3.37, height: 1.87, glassDepth: 0.04, housingBackDepth: housingDepth };
			floor.openings = [ { id: 'w0', kind: 'window', edge: 0, offset: 2, width: 3.5, height: 2, sill: 0.8, glazing } ];
			const group = windows.build();
			const scene = new THREE.Group();
			const neighbor = new THREE.Mesh( new THREE.PlaneGeometry( 40, 20 ), new THREE.MeshBasicMaterial( { side: THREE.DoubleSide, color: 0xffffff } ) );
			neighbor.position.set( 10, 5, 8 );
			scene.add( group, neighbor );
			scene.updateMatrixWorld( true );
			for ( const mesh of group.children ) {

				for ( const attribute of Object.values( mesh.geometry.attributes ) ) expect( Array.from( attribute.array ).every( Number.isFinite ) ).toBe( true );

			}
			const bottom = floor.elevation + glazing.sill;
			const middle = glazing.offset + glazing.width / 2;
			const edges = [
				{ origin: [ 6, 1.84, - 3 ], target: ( inset ) => [ glazing.offset + inset, bottom + 0.6, housingDepth ] },
				{ origin: [ 0, 1.84, - 3 ], target: ( inset ) => [ glazing.offset + glazing.width - inset, bottom + 0.6, housingDepth ] },
				{ origin: [ middle, bottom + 4, - 3 ], target: ( inset ) => [ middle, bottom + inset, housingDepth ] },
				{ origin: [ middle, bottom - 3, - 3 ], target: ( inset ) => [ middle, bottom + glazing.height - inset, housingDepth ] }
			];
			for ( const edge of edges ) {

				const origin = new THREE.Vector3( ...edge.origin );
				for ( const inset of [ 0.002, 0.01, 0.03 ] ) {

					const target = new THREE.Vector3( ...edge.target( inset ) );
					const hit = new THREE.Raycaster( origin, target.sub( origin ).normalize() ).intersectObject( scene, true )[ 0 ];
					expect( hit?.object ).not.toBe( neighbor );
					expect( hit?.object.geometry.getAttribute( 'color' ).getX( hit.face.a ) ).toBe( 0 );

				}

			}
			windows.dispose();
			neighbor.geometry.dispose();
			neighbor.material.dispose();

		}

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
		expect( other.build().children.map( ( mesh ) => Array.from( mesh.geometry.getAttribute( 'color' ).array ) ) ).not.toEqual( before );
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
