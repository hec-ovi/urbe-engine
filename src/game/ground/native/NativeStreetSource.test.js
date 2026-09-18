import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import binding from '../../../../../materials/bindings/street-native.json' with { type: 'json' };
import { openNativeStreetSource } from './NativeStreetSource.js';

const encode = value => new TextEncoder().encode( value );
const hash = value => createHash( 'sha256' ).update( value ).digest( 'hex' );
const jsonHash = value => hash( JSON.stringify( value ) );

function fixture( encoding = 'json-file-bytes' ) {
	// The loader consumes these fields; upstream boxes own the rest of Atlas validation.
	const atlas = {
		meta: { version: '0.26.0', seed: 'native-source' },
		streets: { highwayStructures: [ { id: 'h0', authoredDetail: { untouched: true } } ], construction: {
			planningReservations: { version: '2.1.0' }, modules: { definitions: [], placements: [ { blockId: 'a' }, { blockId: 'b' } ] }
		} },
		transit: { subwayStations: [ { id: 'station0', authoredDetail: 7 } ] },
		volumetric: { ground: [ { moduleBlockId: 'a' }, { moduleBlockId: 'b' } ] }
	};
	const blueprint = { data: atlas, bytes: encode( JSON.stringify( atlas, null, 2 ) + '\n' ).buffer };
	const asset = encode( 'producer-owned opaque asset bytes' );
	const manifest = {
		meta: { version: '0.3.0', generatorVersion: '0.7.0', architectureVersion: '0.26.0', reservationVersion: '2.1.0',
			designVersion: 'native-1.0.0', units: 'meters', seed: 1, blueprintEncoding: encoding,
			blueprintHash: encoding === 'json-file-bytes' ? hash( new Uint8Array( blueprint.bytes ) ) : jsonHash( atlas ), nativeCatalogHash: jsonHash( binding ) },
		pieces: [ { id: 'p0', asset: 'pieces/p0.glb', sha256: hash( asset ), bounds: { min: [ 0, 0, 0 ], max: [ 4, 1, 4 ] }, origin: [ 0, 0, 0 ],
			ownerIds: [ 'a' ], groundIds: [ 'g0' ], surfaceIds: [ 'joint' ], hasCollision: true, triangles: 1 } ],
		ground: { owners: [ { id: 'g0', ownerId: 'a', sourceIndex: 0 } ], replacements: { groundIndices: [ 0 ], moduleOwnerIds: [ 'a' ] },
			cover: { missingArea: 0, outsideArea: 0 } },
		materials: { mode: 'native-reference', binding }, features: [],
		delegated: { highways: { source: 'streets.highwayStructures', hash: jsonHash( atlas.streets.highwayStructures ), count: 1 },
			stations: { source: 'transit.subwayStations', hash: jsonHash( atlas.transit.subwayStations ), stationIds: [ 'station0' ] }, remainingGroundIndices: [ 1 ] }
	};
	const reference = { file: 'streets/manifest.json', sha256: jsonHash( manifest ), blueprintSha256: hash( new Uint8Array( blueprint.bytes ) ) };
	const fetch = vi.fn( async url => url.endsWith( '/manifest.json' ) ? new Response( JSON.stringify( manifest ) ) : new Response( asset ) );
	return { atlas, blueprint, asset, manifest, reference, fetch, options: { baseUrl: '/out/world', reference, blueprint, fetch } };
}

describe( 'saved native street source', () => {
	it.each( [ 'json-file-bytes', 'json-stringify-utf8' ] )( 'loads %s identity and retains only unreplaced original ground without mutation', async encoding => {
		const data = fixture( encoding ), original = JSON.stringify( data.atlas );
		const source = await openNativeStreetSource( data.options );
		expect( Object.isFrozen( source.manifest.materials.binding ) ).toBe( true );
		const remaining = source.retainedAtlas();
		expect( remaining.volumetric.ground ).toEqual( [ data.atlas.volumetric.ground[ 1 ] ] );
		expect( remaining.streets.construction.modules.placements ).toEqual( [ { blockId: 'b' } ] );
		expect( remaining.streets.highwayStructures ).toBe( data.atlas.streets.highwayStructures );
		expect( remaining.transit ).toBe( data.atlas.transit );
		expect( JSON.stringify( data.atlas ) ).toBe( original );
		expect( new Uint8Array( await source.readPiece( 'p0' ) ) ).toEqual( data.asset );
		await expect( source.readPiece( 'missing' ) ).rejects.toMatchObject( { code: 'E_WORLD_STREETS' } );
		source.dispose();
		await expect( source.readPiece( 'p0' ) ).rejects.toThrow( /disposed/ );
	} );

	it( 'rejects a changed blueprint before requesting the street manifest', async () => {
		const data = fixture(); data.blueprint.bytes = encode( 'changed' ).buffer;
		await expect( openNativeStreetSource( data.options ) ).rejects.toThrow( /blueprint byte hash mismatch/ );
		expect( data.fetch ).not.toHaveBeenCalled();
	} );

	it.each( [ 'catalog', 'highway', 'ownership', 'asset-path' ] )( 'rejects inconsistent %s metadata even when its outer byte hash is updated', async kind => {
		const data = fixture();
		if ( kind === 'catalog' ) data.manifest.meta.nativeCatalogHash = '0'.repeat( 64 );
		if ( kind === 'highway' ) data.manifest.delegated.highways.hash = '0'.repeat( 64 );
		if ( kind === 'ownership' ) data.manifest.delegated.remainingGroundIndices = [ 0 ];
		if ( kind === 'asset-path' ) data.manifest.pieces[ 0 ].asset = '../outside.glb';
		data.reference.sha256 = jsonHash( data.manifest );
		await expect( openNativeStreetSource( data.options ) ).rejects.toMatchObject( { code: 'E_WORLD_STREETS' } );
		expect( data.fetch ).toHaveBeenCalledOnce();
	} );

	it( 'rejects modified manifest bytes and unavailable or modified piece bytes', async () => {
		const data = fixture(); data.reference.sha256 = '0'.repeat( 64 );
		await expect( openNativeStreetSource( data.options ) ).rejects.toThrow( /byte hash mismatch/ );
		data.reference.sha256 = jsonHash( data.manifest );
		const source = await openNativeStreetSource( data.options );
		data.fetch.mockResolvedValueOnce( new Response( '', { status: 404 } ) );
		await expect( source.readPiece( 'p0' ) ).rejects.toThrow( /HTTP 404/ );
		data.fetch.mockResolvedValueOnce( new Response( 'wrong asset' ) );
		await expect( source.readPiece( 'p0' ) ).rejects.toThrow( /byte hash mismatch/ );
		source.dispose();
	} );
} );
