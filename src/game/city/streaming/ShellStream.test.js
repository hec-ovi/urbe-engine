import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ShellStream } from './ShellStream.js';

const material = { key: 'cyberpunk/concrete/poor', variantId: 'weathered' };
const record = ( id, x, top = 12 ) => ( {
	id, center: [ x + 5, 0, 5 ], floorCount: top / 3, basementCount: 0,
	bounds: { min: [ x, 0, 0 ], max: [ x + 10, top + 1, 10 ] },
	bands: [ { bottom: 0, top, outline: [ [ x, 0 ], [ x + 10, 0 ], [ x + 10, 10 ], [ x, 10 ] ], material } ],
	roof: { elevation: top, outline: [ [ x, 0 ], [ x + 10, 0 ], [ x + 10, 10 ], [ x, 10 ] ],
		parapetHeight: 1, material, parapetMaterial: material }
} );
const source = ( id, hasInterior = false ) => ( { parcelId: id, hasInterior } );

function fixture( { scenic = null, ...overrides } = {} ) {

	const sources = new Map( [ [ 'home', source( 'home', true ) ], [ 'near', source( 'near' ) ] ] );
	const dispose = vi.fn();
	const shared = new THREE.MeshStandardMaterial();
	const factory = { build: vi.fn( () => shared ) };
	const loader = { load: vi.fn( async buildings => {

		const geometry = new THREE.BoxGeometry();
		geometry.addEventListener( 'dispose', dispose );
		const group = new THREE.Group();
		group.add( new THREE.Mesh( geometry, shared ) );
		if ( scenic ) group.add( new THREE.Mesh( new THREE.BoxGeometry(), scenic ) );
		return { group, doors: [], entrances: [], shellColliders: new Map(), centers: new Map(), triangles: buildings.size * 12 };

	} ) };
	const loadBuildings = vi.fn( async ids => new Map( ids.map( id => [ id, source( id ) ] ) ) );
	const stream = new ShellStream( {
		catalog: { version: '1.0.0', seed: 'test', buildings: [ record( 'home', 0 ), record( 'near', 200 ), record( 'far', 1000, 240 ) ] },
		factory, buildings: sources, loadBuildings, loader, onError: vi.fn(), ...overrides
	} );
	return { stream, sources, loadBuildings, loader, factory, shared, dispose };

}

describe( 'ShellStream public admission', () => {

	it( 'retains interiors, releases distant full shells, and reloads original sources on return', async () => {

		const scenic = new THREE.MeshBasicMaterial();
		scenic.userData.ownedScenicMaterial = true;
		scenic.map = new THREE.Texture();
		const scenicDisposal = vi.fn(), mapDisposal = vi.fn();
		scenic.addEventListener( 'dispose', scenicDisposal );
		scenic.map.addEventListener( 'dispose', mapDisposal );
		const { stream, sources, loadBuildings, dispose, shared } = fixture( { scenic } );
		const materialDisposal = vi.fn();
		shared.addEventListener( 'dispose', materialDisposal );
		await stream.load( { x: 0, z: 0 } );
		expect( sources.size ).toBe( 2 );
		expect( loadBuildings ).not.toHaveBeenCalled();
		stream.update( { x: 1000, z: 0 } );
		await stream.settled();
		expect( [ ...sources.keys() ].sort() ).toEqual( [ 'far', 'home' ] );
		expect( loadBuildings ).toHaveBeenCalledExactlyOnceWith( [ 'far' ] );
		expect( dispose ).toHaveBeenCalledTimes( 1 );
		stream.update( { x: 0, z: 0 } );
		await stream.settled();
		expect( loadBuildings ).toHaveBeenLastCalledWith( [ 'near' ] );
		expect( sources.has( 'far' ) ).toBe( false );
		await stream.dispose();
		expect( dispose ).toHaveBeenCalledTimes( 4 );
		// A cell owns the scenic materials it built and releases them; the
		// shared factory material and its maps outlive every cell.
		expect( scenicDisposal ).toHaveBeenCalled();
		expect( mapDisposal ).not.toHaveBeenCalled();
		expect( materialDisposal ).not.toHaveBeenCalled();

	} );

	it( 'prepares before visibility and discards stale work without host admission', async () => {

		let release;
		const admitted = vi.fn(), removed = vi.fn();
		const { stream } = fixture( { added: admitted, removed } );
		await stream.load( { x: 0, z: 0 } );
		admitted.mockClear();
		stream.prepare = vi.fn( cell => cell.ids.includes( 'far' )
			? new Promise( resolve => { release = resolve; } ) : Promise.resolve() );
		stream.update( { x: 1000, z: 0 } );
		await vi.waitFor( () => expect( release ).toBeTypeOf( 'function' ) );
		stream.update( { x: 0, z: 0 } );
		release();
		await stream.settled();
		expect( admitted ).not.toHaveBeenCalled();
		expect( removed.mock.calls[ 0 ][ 0 ].ids ).toEqual( [ 'far' ] );
		await stream.dispose();

	} );

	it( 'builds the cell whose files are here while a nearer cell is still reading, one cell at a time', async () => {

		let release;
		const reading = new Promise( resolve => { release = resolve; } );
		const admitted = [], building = [];
		let inside = 0;
		const loader = {
			// The nearest cell's files are still coming; the one beyond it is ready.
			open: vi.fn( async buildings => { if ( buildings.has( 'home' ) ) await reading; } ),
			load: vi.fn( async () => {

				building.push( ++ inside );
				await Promise.resolve();
				inside --;
				return { group: new THREE.Group(), doors: [], entrances: [], shellColliders: new Map(), centers: new Map(), triangles: 0 };

			} )
		};
		const { stream } = fixture( { loader, added: cell => admitted.push( cell.ids[ 0 ] ) } );
		const loaded = stream.load( { x: 0, z: 0 } );

		await vi.waitFor( () => expect( admitted ).toEqual( [ 'near' ] ) );
		release();
		await loaded;

		// The cell that stepped aside rejoins once its files are here, and no two
		// cells ever built at the same time.
		expect( admitted ).toEqual( [ 'near', 'home' ] );
		expect( Math.max( ...building ) ).toBe( 1 );
		await stream.dispose();

	} );

	it( 'renders the authored distant silhouette with outward triangles and exact material variants', async () => {

		const tower = record( 'far', 1000, 240 );
		tower.bands[ 0 ].topOutline = [ [ 1002, 2 ], [ 1008, 2 ], [ 1008, 8 ], [ 1002, 8 ] ];
		tower.roof.outline = tower.bands[ 0 ].topOutline;
		const { stream, factory } = fixture( { catalog: { version: '1.0.0', seed: 'test', buildings: [ record( 'home', 0 ), record( 'near', 200 ), tower ] } } );
		await stream.load( { x: 0, z: 0 } );
		const distant = stream.group.getObjectByName( 'distant-shells' );
		const geometry = distant.children[ 0 ].geometry;
		geometry.computeBoundingBox();
		expect( geometry.boundingBox.min.x ).toBe( 1000 );
		expect( geometry.boundingBox.max.y ).toBe( 241 );
		// A tapered band carries its own upper outline into the silhouette.
		const upper = [];
		for ( let i = 0; i < geometry.getAttribute( 'position' ).count; i ++ ) {

			if ( geometry.getAttribute( 'position' ).getY( i ) === 240 ) upper.push( geometry.getAttribute( 'position' ).getX( i ) );

		}
		expect( Math.min( ...upper ) ).toBe( 1002 );
		expect( Math.max( ...upper ) ).toBe( 1008 );
		expect( factory.build ).toHaveBeenCalledWith( material.key, material.variantId );
		const p = geometry.getAttribute( 'position' ), n = geometry.getAttribute( 'normal' );
		for ( let i = 0; i < p.count; i += 3 ) {

			const a = new THREE.Vector3().fromBufferAttribute( p, i );
			const b = new THREE.Vector3().fromBufferAttribute( p, i + 1 ).sub( a );
			const c = new THREE.Vector3().fromBufferAttribute( p, i + 2 ).sub( a );
			expect( b.cross( c ).dot( new THREE.Vector3().fromBufferAttribute( n, i ) ) ).toBeGreaterThan( 0 );

		}
		await stream.dispose();

	} );

	it( 'reports source failures and keeps distant geometry available', async () => {

		const error = new Error( 'unavailable shell' ), onError = vi.fn();
		const { stream } = fixture( { loadBuildings: async () => { throw error; }, onError } );
		await stream.load( { x: 0, z: 0 } );
		stream.update( { x: 1000, z: 0 } );
		await stream.settled();
		expect( onError ).toHaveBeenCalledExactlyOnceWith( error );
		expect( stream.group.getObjectByName( 'distant-shells' ).children.length ).toBeGreaterThan( 0 );
		await stream.dispose();

	} );

	it( 'rejects invalid spatial settings and positions', () => {

		expect( () => fixture( { loadRadius: - 1 } ) ).toThrow( 'E_SHELL_SETTINGS' );
		const { stream } = fixture();
		expect( () => stream.update( { x: NaN, z: 0 } ) ).toThrow( 'E_SHELL_POSITION' );

	} );

} );
