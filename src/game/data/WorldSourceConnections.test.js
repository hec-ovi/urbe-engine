import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runConnections } from '../../assembly/connectionsRunner.js';
import { WorldSource } from './WorldSource.js';

vi.mock( '../../assembly/connectionsRunner.js', () => ( { runConnections: vi.fn( async () => document ) } ) );

const atlas = { meta: { seed: 'city', version: '0.17.0' }, parcels: [] };
const document = {
	meta: { seed: 'city', atlasSeed: 'city', version: '0.9.0' },
	links: [], apertures: [], linkRefs: [], layers: [],
	networks: {
		walk: {
			nodes: [ { id: 'a', x: 0, y: 0.15, z: 0, kind: 'sidewalk' }, { id: 'b', x: 2, y: 0.15, z: 0, kind: 'sidewalk' } ],
			edges: [ { id: 'ab', from: 'a', to: 'b', kind: 'sidewalk', width: 2, level: 0.15,
				path: [ [ 0, 0 ], [ 2, 0 ] ], path3: [ [ 0, 0.15, 0 ], [ 2, 0.15, 0 ] ] } ]
		},
		road: { lanes: [] }, signals: [], transit: { routes: [] }, air: { corridors: [] }
	}
};
const serialize = ( value ) => `${JSON.stringify( value )}\n`;
const hash = ( text ) => createHash( 'sha256' ).update( text ).digest( 'hex' );

describe( 'WorldSource assembled Connections', () => {

	afterEach( () => { vi.unstubAllGlobals(); vi.clearAllMocks(); } );

	it( 'loads the exact source-bound document without generating or fetching a sample blueprint', async () => {

		const fixture = serve();
		const world = await fixture.source.load();
		expect( world.connections ).toEqual( document );
		expect( world.atlas ).toEqual( atlas );
		expect( runConnections ).not.toHaveBeenCalled();
		expect( fetch.mock.calls.filter( ( [ url ] ) => url.endsWith( '/connections.json' ) ) ).toHaveLength( 1 );
		expect( fetch.mock.calls.filter( ( [ url ] ) => url.endsWith( '/blueprint.json' ) ) ).toHaveLength( 1 );
		expect( fetch ).not.toHaveBeenCalledWith( '/atlas/city.json' );

	} );

	it.each( [
		[ 'missing file', ( f ) => f.files.delete( '/out/city/connections.json' ), 'HTTP 404' ],
		[ 'HTML response', ( f ) => f.files.set( '/out/city/connections.json', () => new Response( '<html>', { headers: { 'content-type': 'text/html' } } ) ), 'expected JSON' ],
		[ 'corrupt bytes', ( f ) => f.files.set( '/out/city/connections.json', `${serialize( document )} ` ), 'Connections byte hash' ],
		[ 'invalid JSON', ( f ) => f.replaceConnections( '{' ), 'invalid JSON' ],
		[ 'invalid movement schema', ( f ) => {
			const invalid = structuredClone( document );
			delete invalid.networks.walk.edges[ 0 ].path3;
			f.replaceConnections( serialize( invalid ) );
		}, 'path3' ],
		[ 'different source seed', ( f ) => f.replaceConnections( serialize( { ...document, meta: { ...document.meta, atlasSeed: 'other' } } ) ), 'source seeds' ],
		[ 'changed geometry with the same identity', ( f ) => f.files.set( '/out/city/blueprint.json', serialize( { ...atlas, bounds: { width: 400 } } ) ), 'blueprint byte hash' ],
		[ 'changed blueprint whitespace', ( f ) => f.files.set( '/out/city/blueprint.json', JSON.stringify( atlas, null, 2 ) ), 'blueprint byte hash' ],
		[ 'missing carried blueprint', ( f ) => f.files.delete( '/out/city/blueprint.json' ), 'blueprint.json' ]
	] )( 'rejects %s without generation', async ( _name, change, message ) => {

		const fixture = serve();
		change( fixture );
		await expect( fixture.source.load() ).rejects.toThrow( message );
		expect( runConnections ).not.toHaveBeenCalled();
		expect( fetch ).not.toHaveBeenCalledWith( '/atlas/city.json' );

	} );

	it( 'retains generation and the sample fallback only for manifests without an artifact reference', async () => {

		const fixture = serve();
		delete fixture.manifest.connections;
		fixture.files.delete( '/out/city/blueprint.json' );
		const world = await fixture.source.load();
		expect( world.connections ).toEqual( document );
		expect( runConnections ).toHaveBeenCalledExactlyOnceWith( atlas, { seed: atlas.meta.seed } );
		expect( fetch ).not.toHaveBeenCalledWith( '/out/city/connections.json' );

	} );

} );

function serve() {

	const manifest = {
		contractVersion: '1.0.0', seed: atlas.meta.seed, atlasVersion: atlas.meta.version,
		named: false, namingTheme: null, parcels: [], interiors: [], floors: {},
		connections: { file: 'connections.json', sha256: hash( serialize( document ) ), blueprintSha256: hash( serialize( atlas ) ) }
	};
	const files = new Map( [
		[ '/out/city/blueprint.json', serialize( atlas ) ],
		[ '/atlas/city.json', serialize( atlas ) ],
		[ '/out/city/manifest.json', () => jsonResponse( serialize( manifest ) ) ],
		[ '/out/city/connections.json', serialize( document ) ]
	] );
	vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

		const value = files.get( url );
		return typeof value === 'function' ? value() : jsonResponse( value ?? null, value === undefined ? 404 : 200 );

	} ) );
	return {
		manifest, files,
		source: new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ),
		replaceConnections( text ) {

			files.set( '/out/city/connections.json', text );
			manifest.connections.sha256 = hash( text );

		}
	};

}

function jsonResponse( body, status = 200 ) {

	return new Response( body, { status, headers: { 'content-type': 'application/json' } } );

}
