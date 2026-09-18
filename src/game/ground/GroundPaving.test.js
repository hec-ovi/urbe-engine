import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';
import catalog from '../../../../materials/bindings/street-styles.json' with { type: 'json' };

vi.mock( '../../../../materials/bindings/street-styles.json', async importOriginal => ( {
	default: structuredClone( ( await importOriginal() ).default )
} ) );
const styles = structuredClone( catalog.styles );
beforeEach( () => { catalog.styles = structuredClone( styles ); } );

const factory = { build: ( key, variantId ) => {
	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;
} };

function fixture( { angle = 0.317, pitch = [ 2.3, 1.1 ], joint = [ 0.022, 0.014 ], band = 'walking' } = {} ) {
	const frame = { id: 'f0', origin: [ 12.345, - 6.789 ], u: [ Math.cos( angle ), Math.sin( angle ) ], gridStep: 0.001 };
	const point = ( c, r ) => {
		const du = c * pitch[ 0 ];
		const dv = r * pitch[ 1 ];
		return [ ( frame.origin[ 0 ] + frame.u[ 0 ] * du ) - frame.u[ 1 ] * dv,
			( frame.origin[ 1 ] + frame.u[ 1 ] * du ) + frame.u[ 0 ] * dv ].map( value => Math.round( value * 1000 ) / 1000 );
	};
	const module = { id: 'slab', pitch, joint };
	const layout = { id: 'l0', familyId: 'industrial', modules: [ module ], bands: {} };
	const region = { id: 'p0', layoutId: 'l0', frameId: 'f0', band,
		owner: { kind: 'run', runId: 'r0', edgeId: 'e0', side: 'left', station: [ 0, 2 * pitch[ 0 ] ] } };
	const cover = { surface: band === 'curb' ? 'curb' : 'sidewalk', top: 0.23, bottom: - 0.06,
		polygon: [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 2, 1 ], [ 1, 1 ], [ 1, 2 ], [ 0, 2 ], [ 0, 1 ] ].map( ( [ c, r ] ) => point( c, r ) ),
		construction: { regionId: 'p0', part: { kind: 'grid', moduleId: 'slab', cells: [ { row: 0, from: 0, to: 2 }, { row: 1, from: 0, to: 1 } ] } } };
	return { point, frame, module, region, cover, atlas: {
		meta: { seed: '0' }, streets: { construction: { paving: { version: '1.0.0', layouts: [ layout ], frames: [ frame ], regions: [ region ] } } },
		volumetric: { ground: [ cover ] }
	} };
}

const meshes = result => result.group.children.filter( mesh => mesh.userData.groundConstruction );
const build = atlas => new GroundBuilder( atlas, factory ).build();

/** A 1.1.0 world with a source-bound region, a road cover and the named roadway layout. */
function modern( roadwayLayoutId ) {
	const { atlas, cover, region } = fixture();
	Object.assign( atlas.streets.construction.paving, { version: '1.1.0', roadwayLayoutId,
		sources: [ { id: 'source', surface: cover.surface, top: cover.top, bottom: cover.bottom } ] } );
	region.sourceId = 'source';
	atlas.volumetric.ground.push( { surface: 'roadway', polygon: [ [ 30, 0 ], [ 40, 0 ], [ 40, 5 ], [ 30, 5 ] ], top: 0, bottom: - 0.1 } );
	return atlas;
}

/** Construction input must fail closed before the factory is ever asked for a material. */
function rejects( atlas ) {
	let calls = 0;
	expect( () => new GroundBuilder( atlas, { build() { calls ++; } } ).build() ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );
	return calls === 0;
}

describe( 'GroundBuilder fitted paving', () => {

	it( 'exhausts the supplied rotated L-shaped cells once with separate bodies and joints', () => {
		const { atlas, frame, cover, module } = fixture();
		const built = build( atlas );
		const rendered = meshes( built );
		expect( rendered ).toHaveLength( 2 );
		const triangles = rendered.flatMap( mesh => topTriangles( mesh.geometry ) );
		const area = polygonArea( cover.polygon );
		expect( sumArea( triangles ) ).toBeCloseTo( area, 5 );
		const ownerTriangles = topTriangles( built.colliderGeometry );
		expect( sumArea( ownerTriangles ) ).toBeCloseTo( area, 5 );
		for ( const triangle of triangles ) {
			expect( ownerTriangles.reduce( ( area, owner ) => area + overlapArea( triangle, owner ), 0 ) ).toBeCloseTo( polygonArea( triangle ), 5 );
			expect( cross( triangle[ 0 ], triangle[ 1 ], triangle[ 2 ] ) ).toBeLessThan( 0 );
		}
		for ( const triangle of ownerTriangles ) expect( cross( triangle[ 0 ], triangle[ 1 ], triangle[ 2 ] ) ).toBeLessThan( 0 );
		for ( let i = 0; i < triangles.length; i ++ ) {
			for ( let j = i + 1; j < triangles.length; j ++ ) expect( overlapArea( triangles[ i ], triangles[ j ] ), JSON.stringify( { first: triangles[ i ], second: triangles[ j ] } ) ).toBeLessThan( 1e-8 );
		}
		const body = rendered.find( mesh => mesh.userData.groundConstruction.finish === 'pavingBody' );
		const fraction = ( 1 - module.joint[ 0 ] / module.pitch[ 0 ] ) * ( 1 - module.joint[ 1 ] / module.pitch[ 1 ] );
		expect( sumArea( topTriangles( body.geometry ) ) ).toBeCloseTo( area * fraction, 5 );
		for ( const mesh of rendered ) {
			const position = mesh.geometry.getAttribute( 'position' );
			const uv = mesh.geometry.getAttribute( 'uv' );
			for ( let i = 0; i < position.count; i ++ ) {
				const x = position.getX( i ) - frame.origin[ 0 ];
				const z = position.getZ( i ) - frame.origin[ 1 ];
				expect( position.getY( i ) ).toBeCloseTo( cover.top, 7 );
				expect( uv.getX( i ) ).toBeCloseTo( x * frame.u[ 0 ] + z * frame.u[ 1 ], 5 );
				expect( uv.getY( i ) ).toBeCloseTo( x * frame.u[ 1 ] - z * frame.u[ 0 ], 5 );
			}
		}
		// Collision is the owner polygon, not the much denser slab rendering.
		expect( built.colliderGeometry.getAttribute( 'position' ).count ).toBeLessThan( triangles.length * 3 );
	} );

	it( 'takes complete finish families and solid roles from published layouts independently of seed', () => {
		const { atlas, cover, frame } = fixture( { angle: 0, joint: [ 0, 0 ] } );
		const paving = atlas.streets.construction.paving;
		paving.layouts.push( { ...paving.layouts[ 0 ], id: 'l1', familyId: 'maintained' } );
		paving.regions[ 0 ].band = 'border';
		const roles = [ 'body', 'joint', 'border', 'curb', 'crossing-field', 'approach', 'corner-infill' ];
		roles.forEach( ( role, i ) => {
			const id = `solid${i}`;
			paving.regions.push( { ...paving.regions[ 0 ], id, layoutId: 'l1', band: 'circulation' } );
			atlas.volumetric.ground.push( { ...cover, polygon: [ [ 20 + i * 2, 0 ], [ 21 + i * 2, 0 ], [ 21 + i * 2, 1 ], [ 20 + i * 2, 1 ] ],
				construction: { regionId: id, part: { kind: 'solid', role } } } );
		} );
		const selected = result => meshes( result ).map( mesh => ( { ...mesh.material.userData, finish: mesh.userData.groundConstruction.finish } ) );
		const first = selected( build( atlas ) );
		atlas.meta.seed = 'a different family seed';
		expect( selected( build( atlas ) ) ).toEqual( first );
		expect( first ).toEqual( expect.arrayContaining( [
			{ key: 'cyberpunk/street-graphite-industrial/mid', variantId: 'finish', finish: 'border' },
			{ key: 'cyberpunk/street-precast-maintained/mid', variantId: 'finish', finish: 'pavingBody' },
			{ key: 'cyberpunk/street-joint/mid', variantId: 'maintained', finish: 'joint' },
			{ key: 'cyberpunk/street-graphite-maintained/mid', variantId: 'finish', finish: 'border' },
			{ key: 'cyberpunk/street-precast-maintained/mid', variantId: 'finish', finish: 'curb' }
		] ) );
		expect( first ).toHaveLength( 5 );
		const body = meshes( build( atlas ) ).find( mesh => mesh.userData.groundConstruction.finish === 'pavingBody' );
		expect( sumArea( topTriangles( body.geometry ) ) ).toBeCloseTo( 4, 5 );
		expect( body.geometry.getAttribute( 'uv' ).getX( 0 ) ).toBeCloseTo( 20 - frame.origin[ 0 ], 5 );
	} );

	it( 'takes the roadway family from a declared override and keeps the seeded road without one', () => {
		catalog.styles.find( style => style.id === 'salvaged' ).constructionSurfaces.road = { kind: 'street-road-salvaged', variant: 'finish' };
		const declared = modern( 'road-layout' );
		const paving = declared.streets.construction.paving;
		paving.layouts.push( { ...paving.layouts[ 0 ], id: 'road-layout', familyId: 'salvaged' } );
		const override = build( declared ).group.getObjectByName( 'ground:roadway' );
		expect( override.material.userData ).toEqual( { key: 'cyberpunk/street-road-salvaged/mid', variantId: 'finish' } );
		expect( override.userData.groundConstruction ).toEqual( { familyId: 'salvaged', finish: 'road' } );

		// Without an override the seeded road stands, and paving and collision do not move.
		const atlas = modern( 'l0' );
		const legacy = structuredClone( atlas );
		legacy.streets.construction.paving.version = '1.0.0';
		const seeded = build( atlas ), reference = build( legacy );
		const road = seeded.group.getObjectByName( 'ground:roadway' );
		expect( road.material.userData ).toEqual( reference.group.getObjectByName( 'ground:roadway' ).material.userData );
		expect( road.userData.groundConstruction ).toBeUndefined();
		expect( meshes( seeded ).map( mesh => mesh.material.userData ) ).toEqual( meshes( reference ).map( mesh => mesh.material.userData ) );
		expect( seeded.colliderGeometry.getAttribute( 'position' ).array ).toEqual( reference.colliderGeometry.getAttribute( 'position' ).array );
	} );

	it( 'rejects invalid families, dimensions, cell references and road overrides before creating materials', () => {
		const mutations = [
			data => { data.atlas.streets.construction.paving.layouts[ 0 ].familyId = 'absent'; },
			data => { data.cover.construction.part.moduleId = 'absent'; },
			data => { data.module.joint[ 0 ] = data.module.pitch[ 0 ]; },
			data => { data.module.baseCells = [ 0, 2 ]; },
			data => { data.frame.u = [ 2, 0 ]; },
			data => { data.cover.construction.part.cells[ 1 ] = { row: 0, from: 1, to: 3 }; },
			data => { data.cover.top = NaN; },
			data => { data.cover.construction.part = { kind: 'solid', role: 'absent' }; }
		];
		for ( const mutate of mutations ) {
			const data = fixture();
			mutate( data );
			expect( rejects( data.atlas ) ).toBe( true );
		}
		// A modern world with an unknown roadway layout, and one with a malformed override.
		expect( rejects( modern( 'missing' ) ) ).toBe( true );
		catalog.styles.find( style => style.id === 'industrial' ).constructionSurfaces.road = { kind: 'street-road' };
		expect( rejects( modern( 'l0' ) ) ).toBe( true );
	} );

} );

function triangles( geometry ) {
	const p = geometry.getAttribute( 'position' );
	const indices = geometry.index?.array ?? Array.from( { length: p.count }, ( _, i ) => i );
	const result = [];
	for ( let i = 0; i < indices.length; i += 3 ) result.push( [ 0, 1, 2 ].map( j => {
		const v = indices[ i + j ];
		return [ p.getX( v ), p.getY( v ), p.getZ( v ) ];
	} ) );
	return result;
}
const topTriangles = geometry => triangles( geometry ).filter( triangle => triangle.every( p => p[ 1 ] === triangle[ 0 ][ 1 ] ) ).map( triangle => triangle.map( ( [ x, , z ] ) => [ x, z ] ) );
const polygonArea = ring => Math.abs( ring.reduce( ( area, p, i ) => {
	const q = ring[ ( i + 1 ) % ring.length ];
	return area + p[ 0 ] * q[ 1 ] - q[ 0 ] * p[ 1 ];
}, 0 ) ) / 2;
const sumArea = list => list.reduce( ( sum, triangle ) => sum + polygonArea( triangle ), 0 );

/** Convex clipping measures real triangle overlap rather than sampled coverage. */
function overlapArea( first, second ) {
	let polygon = first;
	const orientation = Math.sign( cross( second[ 0 ], second[ 1 ], second[ 2 ] ) );
	for ( let i = 0; i < 3 && polygon.length; i ++ ) {
		const a = second[ i ];
		const b = second[ ( i + 1 ) % 3 ];
		const output = [];
		for ( let j = 0; j < polygon.length; j ++ ) {
			const p = polygon[ j ];
			const q = polygon[ ( j + 1 ) % polygon.length ];
			const dp = orientation * cross( a, b, p );
			const dq = orientation * cross( a, b, q );
			if ( dp >= 0 ) output.push( p );
			if ( ( dp >= 0 ) !== ( dq >= 0 ) ) {
				const t = dp / ( dp - dq );
				output.push( [ p[ 0 ] + t * ( q[ 0 ] - p[ 0 ] ), p[ 1 ] + t * ( q[ 1 ] - p[ 1 ] ) ] );
			}
		}
		polygon = output;
	}
	return polygon.length >= 3 ? polygonArea( polygon ) : 0;
}
const cross = ( a, b, c ) => ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );
