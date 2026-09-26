import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteriorModules } from './InteriorModules.js';
import { sha256 } from './JsonFile.js';

describe( 'shared Interior geometry publication', () => {

	let root;
	let modulesDir;
	let propsDir;
	const originalStore = process.env.URBE_SHARED_DIR;

	beforeEach( () => {

		root = mkdtempSync( join( tmpdir(), 'interior-resources-' ) );
		modulesDir = join( root, 'modules' );
		propsDir = join( root, 'props' );
		mkdirSync( modulesDir );
		mkdirSync( propsDir );
		process.env.URBE_SHARED_DIR = join( root, 'shared' );
		writeFileSync( join( modulesDir, 'modules.json' ), JSON.stringify( { version: 1, grid: 0.5, modules: [ {
			id: 'wall', file: 'wall.glb', size: [ 1, 1, 1 ], origin: [ 0, 0, 0 ],
			materialSlots: [ 'cyberpunk/metal/mid' ], triangles: 12, bytes: 4
		} ] } ) );
		writeFileSync( join( modulesDir, 'wall.glb' ), 'wall' );
		writeFileSync( join( propsDir, 'catalog.json' ), JSON.stringify( { assets: [ { id: 'sink', modelUri: 'sink.glb' } ] } ) );
		writeFileSync( join( propsDir, 'sink.glb' ), 'sink' );

	} );

	afterEach( () => {

		rmSync( root, { recursive: true, force: true } );
		if ( originalStore === undefined ) delete process.env.URBE_SHARED_DIR; else process.env.URBE_SHARED_DIR = originalStore;

	} );

	it( 'changes shared identity when model bytes change without changing either catalog or file size', async () => {

		const first = await publish();
		writeFileSync( join( propsDir, 'sink.glb' ), 'SINK' );
		const furniture = await publish();
		expect( furniture.props.sha256 ).toBe( first.props.sha256 );
		expect( furniture.modules.sha256 ).toBe( first.modules.sha256 );
		expect( furniture.props.shared ).not.toBe( first.props.shared );
		writeFileSync( join( modulesDir, 'wall.glb' ), 'WALL' );
		const room = await publish();
		expect( room.modules.sha256 ).toBe( first.modules.sha256 );
		expect( room.modules.shared ).not.toBe( furniture.modules.shared );
		expect( readFileSync( join( process.env.URBE_SHARED_DIR, first.props.shared, 'sink.glb' ), 'utf8' ) ).toBe( 'sink' );
		expect( await publish() ).toEqual( room );

	} );

	it( 'restores missing catalogs and models and replaces corrupted bytes in an existing shared set', async () => {

		const original = await publish();
		const directory = join( process.env.URBE_SHARED_DIR, original.modules.shared );
		rmSync( join( directory, 'catalog.json' ) );
		rmSync( join( directory, 'wall.glb' ) );
		writeFileSync( join( directory, 'sink.glb' ), 'bad!' );
		expect( await publish() ).toEqual( original );
		expect( existsSync( join( directory, 'catalog.json' ) ) ).toBe( true );
		expect( readFileSync( join( directory, 'wall.glb' ), 'utf8' ) ).toBe( 'wall' );
		expect( readFileSync( join( directory, 'sink.glb' ), 'utf8' ) ).toBe( 'sink' );

	} );

	it( 'leaves out the local-only models this machine lacks with one warning, and fails on any other missing model', async () => {

		const sink = { id: 'sink', modelUri: 'sink.glb', availability: 'local-only' };
		const absent = [ 'sofa', 'bed' ].map( ( id ) => ( { id, modelUri: `models/${id}.glb`, availability: 'local-only' } ) );
		const source = JSON.stringify( { version: 1, assets: [ sink, ...absent ] } );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const catalogOf = ( { props } ) => readFileSync( join( process.env.URBE_SHARED_DIR, props.shared, props.file ) );

		writeFileSync( join( propsDir, 'catalog.json' ), source );

		try {

			// The world binds the catalog it publishes: the furniture this machine can draw.
			const partial = await publish();
			const published = catalogOf( partial );
			expect( JSON.parse( published ) ).toEqual( { version: 1, assets: [ sink ] } );
			expect( partial.props.sha256 ).toBe( sha256( published ) );
			expect( existsSync( join( process.env.URBE_SHARED_DIR, partial.props.shared, 'models' ) ) ).toBe( false );
			expect( warn.mock.calls ).toEqual( [ [ expect.stringMatching( /^interior furniture: 2 local-only models .*: sofa, bed$/ ) ] ] );

			// Once the machine holds them, the catalog travels as Interior wrote it.
			mkdirSync( join( propsDir, 'models' ) );
			for ( const { modelUri } of absent ) writeFileSync( join( propsDir, modelUri ), modelUri );
			const complete = await publish();
			expect( catalogOf( complete ).toString( 'utf8' ) ).toBe( source );
			expect( complete.props.shared ).not.toBe( partial.props.shared );
			expect( warn ).toHaveBeenCalledOnce();

		} finally { warn.mockRestore(); }

		writeFileSync( join( propsDir, 'catalog.json' ), JSON.stringify( { assets: [ sink, { id: 'chair', modelUri: 'models/chair.glb', availability: 'redistributable' } ] } ) );
		await expect( publish() ).rejects.toMatchObject( { code: 'E_INTERIOR_FAILED', message: expect.stringContaining( 'furniture chair names a missing model models/chair.glb' ) } );

	} );

	it( 'rejects a prebuilt module set whose catalog names missing geometry', async () => {

		rmSync( join( modulesDir, 'wall.glb' ) );
		await expect( publish() ).rejects.toMatchObject( { code: 'E_INTERIOR_FAILED', message: expect.stringContaining( 'missing model wall.glb' ) } );

	} );

	const publish = () => new InteriorModules( modulesDir, propsDir ).publish();

} );
