import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';

const rectangle = ( x, z, width, depth ) => [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];
const prism = ( role, polygon, bottom, top ) => ( { role, polygon, bottom, top } );
const factory = { build( key, variantId ) {

	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;

} };
const build = atlas => new GroundBuilder( atlas, factory ).build();

function fixture() {

	const parts = [
		prism( 'joint', rectangle( 0, 0, 2, 1 ), 0, 0.18 ),
		prism( 'panel', rectangle( 0.006, 0.006, 0.988, 0.988 ), 0.18, 0.2 ),
		prism( 'panel', rectangle( 1.006, 0.006, 0.988, 0.988 ), 0.18, 0.2 ),
		prism( 'curb', rectangle( 0, - 0.2, 2, 0.2 ), - 0.03, 0.2 ),
		prism( 'gutter', rectangle( 0, - 0.48, 2, 0.28 ), - 0.008, 0 ),
		prism( 'gutter-lip', rectangle( 0, - 0.5, 2, 0.02 ), - 0.008, 0.02 ),
		prism( 'roadway', rectangle( 0, - 1.5, 2, 1 ), - 0.2, 0 ),
		prism( 'guardrail', rectangle( 0, 0.4, 2, 0.08 ), 0.2, 1.2 )
	];
	const placements = [ 0, 1, 2, 3 ].map( turn => ( { moduleId: 'two-panels', blockId: `b${turn}`, origin: [ 10 + turn * 10, 30 ],
		turn, count: 2, step: 2, finish: turn % 2 ? 'industrial' : 'maintained' } ) );
	return { meta: { seed: '0' }, streets: { construction: { modules: { version: '1.0.0', definitions: [ { id: 'two-panels', parts } ], placements } } },
		volumetric: { ground: placements.map( placement => ( { surface: 'sidewalk', polygon: rectangle( ...placement.origin, 4, 1 ),
			top: 0.2, bottom: 0, moduleBlockId: placement.blockId } ) ) } };

}

describe( 'GroundBuilder physical modules', () => {

	it( 'shares physical prism geometry through all quarter turns and repeats with matching indexed collision', () => {

		const atlas = fixture(), original = structuredClone( atlas );
		const result = build( atlas );
		const meshes = result.group.children.filter( object => object.isMesh );
		expect( meshes ).toHaveLength( 12 );
		expect( meshes.every( mesh => mesh.isInstancedMesh && mesh.count === 4 ) ).toBe( true );
		expect( meshes.some( mesh => mesh.name === 'ground:sidewalk' || mesh.userData.groundModule.role === 'guardrail' ) ).toBe( false );
		const rendered = [];
		for ( const mesh of meshes ) {

			const { role, familyId } = mesh.userData.groundModule;
			expect( mesh.geometry ).toBe( meshes.find( other => other.userData.groundModule.role === role && other !== mesh ).geometry );
			const p = mesh.geometry.getAttribute( 'position' ), uv = mesh.geometry.getAttribute( 'uv' ), normal = mesh.geometry.getAttribute( 'normal' );
			for ( let i = 0; i < p.count; i ++ ) if ( Math.abs( normal.getY( i ) ) === 1 ) {

				expect( uv.getX( i ) ).toBeCloseTo( p.getX( i ), 6 );
				expect( uv.getY( i ) ).toBeCloseTo( - p.getZ( i ), 6 );

			}
			let instance = 0;
			for ( const placement of atlas.streets.construction.modules.placements.filter( item => item.finish === familyId ) ) {

				for ( let repeat = 0; repeat < placement.count; repeat ++ ) {

					const matrix = new THREE.Matrix4();
					mesh.getMatrixAt( instance ++, matrix );
					const x = 0.47 + repeat * placement.step, z = 0.31;
					const [ dx, dz ] = [ [ x, z ], [ - z, x ], [ - x, - z ], [ z, - x ] ][ placement.turn ];
					const world = new THREE.Vector3( 0.47, 0.2, 0.31 ).applyMatrix4( matrix );
					expect( world.x ).toBeCloseTo( placement.origin[ 0 ] + dx, 12 );
					expect( world.y ).toBe( 0.2 );
					expect( world.z ).toBeCloseTo( placement.origin[ 1 ] + dz, 12 );
					rendered.push( ...triangles( mesh.geometry, matrix ) );

				}

			}

		}
		expect( result.colliderGeometry.index ).toBeTruthy();
		expect( triangles( result.colliderGeometry ).sort() ).toEqual( rendered.sort() );
		expect( atlas ).toEqual( original );

	} );

	it( 'keeps real panel recesses and a 2 cm gutter lip with native finish bindings', () => {

		const atlas = fixture();
		atlas.streets.construction.modules.placements = [ { ...atlas.streets.construction.modules.placements[ 0 ], origin: [ 0, 0 ], count: 1 } ];
		atlas.volumetric.ground = [ { surface: 'sidewalk', moduleBlockId: 'b0', polygon: rectangle( 0, - 1.5, 2, 2.5 ), top: 0.2, bottom: 0 } ];
		const result = build( atlas );
		const selected = Object.fromEntries( result.group.children.filter( mesh => mesh.isMesh ).map( mesh => [ mesh.userData.groundModule.role, mesh.material.userData ] ) );
		expect( selected ).toEqual( {
			panel: { key: 'cyberpunk/street-precast-maintained/mid', variantId: 'finish' },
			curb: { key: 'cyberpunk/street-precast-maintained/mid', variantId: 'finish' },
			joint: { key: 'cyberpunk/street-joint/mid', variantId: 'maintained' },
			gutter: { key: 'cyberpunk/street-graphite-maintained/mid', variantId: 'finish' },
			'gutter-lip': { key: 'cyberpunk/street-graphite-maintained/mid', variantId: 'finish' },
			roadway: { key: 'cyberpunk/street-road/mid', variantId: 'maintained' }
		} );
		const collider = new THREE.Mesh( result.colliderGeometry, new THREE.MeshBasicMaterial() );
		for ( const [ x, z, expected ] of [ [ 0.5, 0.5, 0.2 ], [ 1, 0.5, 0.18 ], [ 0.5, - 0.1, 0.2 ], [ 0.5, - 0.3, 0 ], [ 0.5, - 0.49, 0.02 ] ] ) {

			const ray = new THREE.Raycaster( new THREE.Vector3( x, 2, z ), new THREE.Vector3( 0, - 1, 0 ) );
			expect( ray.intersectObject( result.group, true )[ 0 ].point.y ).toBeCloseTo( expected, 6 );
			expect( ray.intersectObject( collider )[ 0 ].point.y ).toBeCloseTo( expected, 6 );

		}

	} );

	it( 'uses native land finishes in module cities and retains station openings outside module reservations', () => {

		const atlas = fixture();
		atlas.volumetric.ground.push( { surface: 'open', polygon: rectangle( 0, 0, 4, 4 ), top: 0.2, bottom: 0 } );
		atlas.transit = { subwayStations: [ { shafts: [ { footprint: rectangle( 1, 1, 2, 2 ), bottom: - 4, top: 0.2 } ] } ] };
		const result = build( atlas ), land = result.group.getObjectByName( 'ground:open' );
		expect( land.material.userData.key ).toMatch( /^cyberpunk\/street-precast-/ );
		const ray = new THREE.Raycaster( new THREE.Vector3( 2, 2, 2 ), new THREE.Vector3( 0, - 1, 0 ) );
		expect( ray.intersectObject( result.group, true ) ).toHaveLength( 0 );
		expect( ray.intersectObject( new THREE.Mesh( result.colliderGeometry, new THREE.MeshBasicMaterial() ) ) ).toHaveLength( 0 );

	} );

	it( 'rejects incomplete definitions and invalid placement inputs before creating any material', () => {

		for ( const mutate of [
			atlas => { delete atlas.streets.construction.modules; },
			( _, modules ) => { modules.version = '2.0.0'; },
			( _, modules ) => { modules.definitions.push( modules.definitions[ 0 ] ); },
			( _, modules ) => { modules.definitions[ 0 ].parts[ 0 ].top = NaN; },
			( _, modules ) => { modules.definitions[ 0 ].parts[ 0 ].role = 'unknown'; },
			( _, modules ) => { modules.placements[ 0 ].moduleId = 'missing'; },
			( _, modules ) => { modules.placements[ 0 ].origin = [ Infinity, 0 ]; },
			( _, modules ) => { modules.placements[ 0 ].turn = 0.5; },
			( _, modules ) => { modules.placements[ 0 ].count = 1.5; },
			( _, modules ) => { modules.placements[ 0 ].step = 0; },
			( _, modules ) => { modules.placements[ 0 ].finish = 'missing'; },
			atlas => { atlas.volumetric.ground[ 0 ].moduleBlockId = 'missing'; }
		] ) {

			const atlas = fixture();
			mutate( atlas, atlas.streets.construction.modules );
			let calls = 0;
			expect( () => new GroundBuilder( atlas, { build() { calls ++; } } ).build() ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );
			expect( calls ).toBe( 0 );

		}

	} );

} );

function triangles( geometry, matrix = new THREE.Matrix4() ) {

	const result = [], p = geometry.getAttribute( 'position' ), index = geometry.index.array;
	for ( let i = 0; i < index.length; i += 3 ) result.push( [ 0, 1, 2 ].map( offset => new THREE.Vector3().fromBufferAttribute( p, index[ i + offset ] )
		.applyMatrix4( matrix ).toArray().map( value => Math.round( value * 1e5 ) / 1e5 ).join( ',' ) ).sort().join( ';' ) );
	return result;

}
