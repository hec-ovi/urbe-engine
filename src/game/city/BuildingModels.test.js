import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { ShellStream } from './streaming/ShellStream.js';
import { releaseShell } from './streaming/ReleaseShell.js';

const factory = { resolver: { resolve: () => null }, build: () => new THREE.MeshStandardMaterial() };
const tree = ( kind = 'ornamental-tree', position = [ 10, 2, 20 ] ) => ( { kind, position, size: [ 4, 8, 2 ], rotation: Math.PI / 2 } );
const source = ( instances ) => ( { parcelId: 'p', shellUrl: '/p.glb', hasInterior: false, blueprint: {
	bounds: { footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ], height: 12 }, floors: [], modelInstances: instances
} } );

function fixture( instances, options ) {
	const assets = [];
	const transport = { loadAsync: vi.fn( async url => {
		const scene = new THREE.Group();
		if ( url === '/p.glb' ) return { scene };
		const map = new THREE.Texture( { close: vi.fn() } );
		const material = new THREE.MeshStandardMaterial( { map, transparent: true } );
		const geometry = new THREE.BoxGeometry( 2, 4, 1 ).translate( 0.5, 2, 0 );
		const disposed = { map: vi.fn(), material: vi.fn(), geometry: vi.fn() };
		for ( const [ key, value ] of Object.entries( { map, material, geometry } ) ) value.addEventListener( 'dispose', disposed[ key ] );
		scene.add( new THREE.Mesh( geometry, material ) );
		assets.push( { map, material, geometry, disposed } );
		return { scene };
	} ) };
	return { assets, transport, buildings: new Map( [ [ 'p', source( instances ) ] ] ), loader: new BuildingsLoader( factory, transport, options ) };
}

function streaming( setup, overrides = {} ) {
	const material = { key: 'cyberpunk/concrete/mid', variantId: 'native' };
	const outline = setup.buildings.get( 'p' ).blueprint.bounds.footprint;
	return new ShellStream( { catalog: { version: '1.0.0', seed: 'plants', buildings: [ {
		id: 'p', center: [ 5, 0, 5 ], bounds: { min: [ 0, 0, 0 ], max: [ 10, 12, 10 ] },
		floorCount: 4, basementCount: 0, bands: [ { bottom: 0, top: 12, outline, material } ],
		roof: { elevation: 12, outline, parapetHeight: 0, material, parapetMaterial: material }
	} ] }, factory, buildings: new Map( setup.buildings ), loader: setup.loader,
	loadBuildings: async () => new Map( setup.buildings ), onError: vi.fn(), ...overrides } );
}

describe( 'authored building model instances', () => {
	it( 'loads catalog sources once, preserves maps, fits rooted proportions and reports explicitly unmapped kinds', async () => {
		const setup = fixture( [ tree(), tree( 'ornamental-tree', [ 30, 0, 40 ] ), tree( 'shrub' ), tree( 'palm' ) ], { modelAssets: { palm: null } } );
		const city = await setup.loader.load( setup.buildings );
		expect( setup.transport.loadAsync.mock.calls.map( ( [ url ] ) => url ) ).toEqual( [
			'/models/street-props/tree_3d_model_fir_spruce_pine.glb', '/models/street-props/maple_tree.glb', '/p.glb'
		] );
		const mesh = city.group.getObjectByName( 'building-model:pine:0' );
		expect( mesh.count ).toBe( 2 );
		expect( mesh.material.map ).toBe( setup.assets[ 0 ].map );
		expect( mesh.material.alphaTest ).toBe( 0.45 );
		expect( mesh.geometry.getAttribute( 'uv' ).count ).toBe( 36 );
		const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
		mesh.getMatrixAt( 0, matrix );
		matrix.decompose( position, rotation, scale );
		expect( position.toArray() ).toEqual( [ 10, 2, 20 ] );
		expect( scale.x ).toBeCloseTo( scale.y );
		expect( scale.z ).toBeCloseTo( scale.y );
		const local = mesh.geometry.boundingBox.clone().applyMatrix4( new THREE.Matrix4().makeScale( scale.x, scale.y, scale.z ) );
		expect( local.max.x ).toBeCloseTo( 2 );
		expect( local.min.y ).toBe( 0 );
		expect( local.max.y ).toBeLessThanOrEqual( 8 );
		expect( Math.abs( local.min.z ) ).toBeLessThanOrEqual( 1 );
		expect( new THREE.Vector3( 1, 0, 0 ).applyQuaternion( rotation ).z ).toBeCloseTo( - 1 );
		expect( city.unresolvedModelInstances ).toEqual( [ { parcelId: 'p', index: 3, kind: 'palm' } ] );
		expect( city.triangles ).toBe( 36 );
		expect( city.shellColliders.get( 'p' ) ).toBeNull();
		const disposedInstances = vi.fn(), disposedPart = vi.fn(), disposedMaterial = vi.fn();
		mesh.addEventListener( 'dispose', disposedInstances );
		mesh.geometry.addEventListener( 'dispose', disposedPart );
		mesh.material.addEventListener( 'dispose', disposedMaterial );
		releaseShell( city );
		city.disposeModelInstances();
		for ( const dispose of [ disposedInstances, disposedPart, disposedMaterial, ...Object.values( setup.assets[ 0 ].disposed ) ] ) expect( dispose ).toHaveBeenCalledTimes( 1 );
		expect( setup.assets[ 0 ].map.source.data.close ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'maps tall planting to existing pine and rejects invalid placement, mapping and transport errors', async () => {
		const override = fixture( [ tree( 'palm' ) ] );
		const city = await override.loader.load( override.buildings );
		expect( city.unresolvedModelInstances ).toEqual( [] );
		expect( city.group.getObjectByName( 'building-model:pine:0' ) ).toBeTruthy();
		releaseShell( city );
		const invalid = fixture( [ { ...tree(), size: [ 4, - 1, 2 ] } ] );
		await expect( invalid.loader.load( invalid.buildings ) ).rejects.toThrow( 'E_BUILDING_MODEL' );
		const missing = fixture( [ tree() ], { modelAssets: { 'ornamental-tree': 'unknown' } } );
		await expect( missing.loader.load( missing.buildings ) ).rejects.toThrow( 'E_BUILDING_MODEL' );
		const failed = fixture( [ tree(), tree( 'shrub' ) ] );
		failed.transport.loadAsync.mockImplementationOnce( failed.transport.loadAsync.getMockImplementation() ).mockRejectedValueOnce( new Error( 'missing model' ) );
		await expect( failed.loader.load( failed.buildings ) ).rejects.toThrow( 'E_PROP_ASSET' );
		expect( failed.assets[ 0 ].disposed.map ).toHaveBeenCalledTimes( 1 );
		const shellFailed = fixture( [ tree() ] );
		shellFailed.transport.loadAsync.mockImplementationOnce( shellFailed.transport.loadAsync.getMockImplementation() ).mockRejectedValueOnce( new Error( 'shell unavailable' ) );
		await expect( shellFailed.loader.load( shellFailed.buildings ) ).rejects.toThrow( 'shell unavailable' );
		expect( shellFailed.assets[ 0 ].disposed.map ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'releases a model cell after stale or failed preparation without making it visible', async () => {
		const setup = fixture( [ tree() ] );
		let resume;
		const stream = streaming( setup, { prepare: cell => cell.ids.length ? new Promise( resolve => { resume = resolve; } ) : Promise.resolve() } );
		stream.update( { x: 0, z: 0 } );
		await vi.waitFor( () => expect( resume ).toBeTypeOf( 'function' ) );
		stream.update( { x: 1500, z: 0 } );
		resume();
		await stream.settled();
		expect( setup.assets[ 0 ].disposed.map ).toHaveBeenCalledTimes( 1 );
		expect( stream.group.getObjectByName( 'building-models' ) ).toBeUndefined();
		await stream.dispose();
		const failed = fixture( [ tree() ] );
		const broken = streaming( failed, { prepare: async () => { throw new Error( 'pipeline failed' ); } } );
		await expect( broken.load( { x: 0, z: 0 } ) ).rejects.toThrow( 'E_SHELL_LOAD' );
		expect( failed.assets[ 0 ].disposed.map ).toHaveBeenCalledTimes( 1 );
		await broken.dispose();
	} );
} );
