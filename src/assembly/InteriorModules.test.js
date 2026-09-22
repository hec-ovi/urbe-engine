import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteriorModules } from './InteriorModules.js';

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

	it( 'rejects a prebuilt module set whose catalog names missing geometry', async () => {

		rmSync( join( modulesDir, 'wall.glb' ) );
		await expect( publish() ).rejects.toMatchObject( { code: 'E_INTERIOR_FAILED', message: expect.stringContaining( 'missing model wall.glb' ) } );

	} );

	const publish = () => new InteriorModules( modulesDir, propsDir ).publish();

} );
