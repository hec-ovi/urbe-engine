import { describe, expect, it, vi } from 'vitest';
import { HydrologyAdapter, HydrologyError } from './index.js';
import { HYDROLOGY_FIXTURES, MATERIAL_BINDINGS_FIXTURE, materialsFixture } from './fixtures/hydrology.js';

describe( 'HydrologyAdapter', () => {

	it( 'keeps a legacy no-water blueprint at zero objects and zero material work', () => {

		const materials = materialsFixture();
		expect( HydrologyAdapter.build( { meta: { version: '0.14.0' } } ) ).toBeNull();
		expect( HydrologyAdapter.build( { meta: { version: '0.14.0' } }, materials ) ).toBeNull();
		expect( HydrologyAdapter.build( { hydrology: null }, materials ) ).toBeNull();
		expect( materials.trace ).toEqual( { resolved: [], built: [] } );

	} );

	it.each( HYDROLOGY_FIXTURES )( 'builds exact $type surfaces and shoreline bands', ( plan ) => {

		const materials = materialsFixture();
		const runtime = HydrologyAdapter.build( { hydrology: plan }, materials );
		const body = plan.bodies[ 0 ];
		expect( runtime.group.name ).toBe( 'hydrology' );
		expect( runtime.group.children.map( ( child ) => child.name ) ).toEqual( [
			`hydrology:water:${body.id}`, `hydrology:shoreline:${body.shorelines[ 0 ].id}`
		] );
		expect( runtime.handoff ).toMatchObject( {
			version: '1', seedId: plan.seedId, type: plan.type,
			waterSurfaces: [ { polygon: body.surfaces[ 0 ], elevation: body.elevation, depth: body.depth, materialKey: body.materialKey } ],
			groundExclusions: [ { polygon: body.surfaces[ 0 ], elevation: body.elevation } ]
		} );
		expect( runtime.handoff.shorelineBands.map( ( item ) => item.polygon ) ).toEqual( body.shorelines[ 0 ].band );
		expect( runtime.summary ).toEqual( {
			objects: 2, triangles: 10, waterSurfaces: 1, shorelineBands: 4, groundExclusions: 1,
			crossings: plan.structures.length
		} );
		expect( materials.trace.resolved ).toEqual( [ MATERIAL_BINDINGS_FIXTURE[ body.materialKey ].key ] );
		expect( materials.trace.built ).toEqual( [ [
			MATERIAL_BINDINGS_FIXTURE[ body.materialKey ].key, MATERIAL_BINDINGS_FIXTURE[ body.materialKey ].variantId
		] ] );
		runtime.dispose();

	} );

	it( 'triangulates within exact bounds, upward, at the published elevation with world UVs', () => {

		const plan = HYDROLOGY_FIXTURES[ 0 ];
		const runtime = HydrologyAdapter.build( { hydrology: plan }, materialsFixture() );
		const mesh = runtime.group.getObjectByName( `hydrology:water:${plan.bodies[ 0 ].id}` );
		const position = mesh.geometry.getAttribute( 'position' );
		const normal = mesh.geometry.getAttribute( 'normal' );
		const uv = mesh.geometry.getAttribute( 'uv' );
		const xs = [];
		const zs = [];
		for ( let index = 0; index < position.count; index ++ ) {

			xs.push( position.getX( index ) );
			zs.push( position.getZ( index ) );
			expect( position.getY( index ) ).toBeCloseTo( plan.bodies[ 0 ].elevation, 6 );
			expect( normal.getY( index ) ).toBeCloseTo( 1, 6 );
			expect( uv.getX( index ) ).toBeCloseTo( position.getX( index ), 6 );
			expect( uv.getY( index ) ).toBeCloseTo( - position.getZ( index ), 6 );

		}
		expect( [ Math.min( ...xs ), Math.max( ...xs ), Math.min( ...zs ), Math.max( ...zs ) ] ).toEqual( [ 10, 40, 10, 40 ] );
		expect( mesh.geometry.index?.count ?? position.count ).toBe( 6 );
		runtime.dispose();

	} );

	it( 'derives stable backend-neutral motion and reflection parameters from seed identity', () => {

		const plan = HYDROLOGY_FIXTURES[ 2 ];
		const left = HydrologyAdapter.build( { hydrology: plan }, materialsFixture() );
		const right = HydrologyAdapter.build( { hydrology: structuredClone( plan ) }, materialsFixture() );
		const otherPlan = structuredClone( plan );
		otherPlan.seedId = 'hydro-6678abcd';
		const other = HydrologyAdapter.build( { hydrology: otherPlan }, materialsFixture() );
		expect( JSON.stringify( right.handoff ) ).toBe( JSON.stringify( left.handoff ) );
		expect( other.handoff.waterSurfaces[ 0 ].motion ).not.toEqual( left.handoff.waterSurfaces[ 0 ].motion );
		left.update( { elapsedSeconds: 19.25 } );
		right.update( { elapsedSeconds: 19.25 } );
		const leftMap = left.group.children[ 0 ].material.normalMap;
		const rightMap = right.group.children[ 0 ].material.normalMap;
		expect( leftMap.offset.toArray() ).toEqual( rightMap.offset.toArray() );
		expect( left.group.children[ 0 ].material.userData.hydrology.reflection ).toEqual( left.handoff.waterSurfaces[ 0 ].reflection );
		expectCode( () => left.update( { elapsedSeconds: - 1 } ), 'E_HYDRO_INPUT' );
		left.dispose();
		right.dispose();
		other.dispose();

	} );

	it( 'hands bridge and tunnel records through unchanged and keeps water out of colliders', () => {

		const plan = HYDROLOGY_FIXTURES[ 1 ];
		const runtime = HydrologyAdapter.build( { hydrology: plan }, materialsFixture() );
		expect( runtime.handoff.crossings ).toEqual( plan.structures );
		expect( runtime.handoff.crossings ).not.toBe( plan.structures );
		expect( runtime.handoff.crossings.map( ( item ) => item.kind ) ).toEqual( [ 'bridge', 'tunnel' ] );
		expect( runtime ).not.toHaveProperty( 'colliderGeometry' );
		expect( runtime.handoff.groundExclusions ).toHaveLength( 1 );
		runtime.dispose();

	} );

	it.each( [
		[ 'missing binding', {}, materialsFixture().factory ],
		[ 'unresolved entry', MATERIAL_BINDINGS_FIXTURE, materialsFixture( { unresolved: true } ).factory ],
		[ 'missing maps', MATERIAL_BINDINGS_FIXTURE, materialsFixture( { missingMaps: true } ).factory ],
		[ 'factory fallback', MATERIAL_BINDINGS_FIXTURE, materialsFixture( { fallback: true } ).factory ]
	] )( 'fails closed for %s material data', ( _label, bindings, factory ) => {

		expectCode( () => HydrologyAdapter.build( { hydrology: HYDROLOGY_FIXTURES[ 0 ] }, { bindings, factory } ), 'E_HYDRO_MATERIAL' );

	} );

	it( 'fails closed for malformed, non-finite, clockwise and self-intersecting water', () => {

		const malformed = structuredClone( HYDROLOGY_FIXTURES[ 0 ] );
		malformed.bodies[ 0 ].elevation = Infinity;
		expectCode( () => HydrologyAdapter.build( { hydrology: malformed }, materialsFixture() ), 'E_HYDRO_INPUT' );

		const clockwise = structuredClone( HYDROLOGY_FIXTURES[ 0 ] );
		clockwise.bodies[ 0 ].surfaces[ 0 ].reverse();
		clockwise.bodies[ 0 ].shorelines[ 0 ].path.reverse();
		expectCode( () => HydrologyAdapter.build( { hydrology: clockwise }, materialsFixture() ), 'E_HYDRO_INPUT' );

		const crossed = structuredClone( HYDROLOGY_FIXTURES[ 0 ] );
		crossed.bodies[ 0 ].surfaces[ 0 ] = [ [ 10, 10 ], [ 40, 10 ], [ 15, 40 ], [ 40, 35 ], [ 10, 30 ] ];
		crossed.bodies[ 0 ].shorelines[ 0 ].path = crossed.bodies[ 0 ].surfaces[ 0 ].map( ( point ) => [ ...point ] );
		expectCode( () => HydrologyAdapter.build( { hydrology: crossed }, materialsFixture() ), 'E_HYDRO_INPUT' );

	} );

	it( 'disposes every owned resource once and rejects later updates', () => {

		const runtime = HydrologyAdapter.build( { hydrology: HYDROLOGY_FIXTURES[ 0 ] }, materialsFixture() );
		const resources = runtime.group.children.map( ( mesh ) => ( {
			geometry: vi.spyOn( mesh.geometry, 'dispose' ),
			material: vi.spyOn( mesh.material, 'dispose' ),
			normal: vi.spyOn( mesh.material.normalMap, 'dispose' )
		} ) );
		runtime.dispose();
		runtime.dispose();
		expect( runtime.group.children ).toHaveLength( 0 );
		for ( const resource of resources ) {

			expect( resource.geometry ).toHaveBeenCalledTimes( 1 );
			expect( resource.material ).toHaveBeenCalledTimes( 1 );
			expect( resource.normal ).toHaveBeenCalledTimes( 1 );

		}
		expectCode( () => runtime.update( { elapsedSeconds: 1 } ), 'E_HYDRO_DISPOSED' );

	} );

} );

function expectCode( run, code ) {

	try {

		run();
		throw new Error( 'Expected hydrology failure' );

	} catch ( error ) {

		expect( error ).toBeInstanceOf( HydrologyError );
		expect( error.code ).toBe( code );

	}

}
