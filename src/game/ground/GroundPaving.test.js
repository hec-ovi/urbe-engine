import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';

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
			{ key: 'cyberpunk/street-border/mid', variantId: 'industrial', finish: 'border' },
			{ key: 'cyberpunk/street-paving-body/mid', variantId: 'maintained', finish: 'pavingBody' },
			{ key: 'cyberpunk/street-joint/mid', variantId: 'maintained', finish: 'joint' },
			{ key: 'cyberpunk/street-border/mid', variantId: 'maintained', finish: 'border' },
			{ key: 'cyberpunk/street-curb/mid', variantId: 'maintained', finish: 'curb' }
		] ) );
		expect( first ).toHaveLength( 5 );
		const body = meshes( build( atlas ) ).find( mesh => mesh.userData.groundConstruction.finish === 'pavingBody' );
		expect( sumArea( topTriangles( body.geometry ) ) ).toBeCloseTo( 4, 5 );
		expect( body.geometry.getAttribute( 'uv' ).getX( 0 ) ).toBeCloseTo( 20 - frame.origin[ 0 ], 5 );
	} );

	it( 'carries curb joints down the exact exposed boundary without interior skirts', () => {
		const { atlas, cover, point } = fixture( { angle: 0.62, pitch: [ 2, 0.15 ], joint: [ 0.02, 0 ], band: 'curb' } );
		cover.polygon = [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 2, 1 ], [ 1, 1 ], [ 0, 1 ] ].map( ( [ c, r ] ) => point( c, r ) );
		cover.construction.part.cells = [ { row: 0, from: 0, to: 2 } ];
		atlas.volumetric.ground.push( { surface: 'roadway', top: 0, bottom: - 0.1,
			polygon: [ point( 0, 0 ), point( 0, - 20 ), point( 2, - 20 ), point( 2, 0 ), point( 1, 0 ) ] } );
		const rendered = meshes( build( atlas ) );
		const faces = rendered.flatMap( mesh => verticalTriangles( mesh.geometry ) );
		const length = distance( point( 0, 0 ), point( 1, 0 ) ) + distance( point( 1, 0 ), point( 2, 0 ) );
		expect( surfaceArea( faces ) ).toBeCloseTo( length * ( cover.top - cover.bottom ), 5 );
		const joints = rendered.find( mesh => mesh.userData.groundConstruction.finish === 'joint' );
		expect( surfaceArea( verticalTriangles( joints.geometry ) ) ).toBeCloseTo( length * 0.01 * ( cover.top - cover.bottom ), 5 );
		for ( const mesh of rendered ) {
			const p = mesh.geometry.getAttribute( 'position' );
			const uv = mesh.geometry.getAttribute( 'uv' );
			const normal = mesh.geometry.getAttribute( 'normal' );
			for ( let i = 0; i < p.count; i += 4 ) {
				if ( Math.abs( normal.getY( i ) ) > 0.5 ) continue;
				expect( Math.abs( uv.getX( i + 1 ) - uv.getX( i ) ) ).toBeCloseTo( Math.hypot( p.getX( i + 1 ) - p.getX( i ), p.getZ( i + 1 ) - p.getZ( i ) ), 5 );
			}
		}
	} );

	it( 'rejects invalid families, dimensions and cell references before creating materials', () => {
		const mutations = [
			data => { data.atlas.streets.construction.paving.layouts[ 0 ].familyId = 'absent'; },
			data => { data.cover.construction.part.moduleId = 'absent'; },
			data => { data.module.joint[ 0 ] = data.module.pitch[ 0 ]; },
			data => { data.frame.u = [ 2, 0 ]; },
			data => { data.cover.construction.part.cells[ 1 ] = { row: 0, from: 1, to: 3 }; },
			data => { data.cover.top = NaN; },
			data => { data.cover.construction.part = { kind: 'solid', role: 'absent' }; }
		];
		for ( const mutate of mutations ) {
			const data = fixture();
			mutate( data );
			let calls = 0;
			expect( () => new GroundBuilder( data.atlas, { build() { calls ++; } } ).build() ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );
			expect( calls ).toBe( 0 );
		}
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
const verticalTriangles = geometry => triangles( geometry ).filter( triangle => triangle.some( p => p[ 1 ] !== triangle[ 0 ][ 1 ] ) );
const distance = ( a, b ) => Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
const polygonArea = ring => Math.abs( ring.reduce( ( area, p, i ) => {
	const q = ring[ ( i + 1 ) % ring.length ];
	return area + p[ 0 ] * q[ 1 ] - q[ 0 ] * p[ 1 ];
}, 0 ) ) / 2;
const sumArea = list => list.reduce( ( sum, triangle ) => sum + polygonArea( triangle ), 0 );
const surfaceArea = list => list.reduce( ( sum, [ a, b, c ] ) => {
	const u = b.map( ( value, i ) => value - a[ i ] );
	const v = c.map( ( value, i ) => value - a[ i ] );
	return sum + Math.hypot( u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ) / 2;
}, 0 );

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
