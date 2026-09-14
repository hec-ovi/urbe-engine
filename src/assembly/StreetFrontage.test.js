import { expect, it } from 'vitest';
import { generate } from '../../../exterior/src/index.ts';
import { RequestAssembler } from './RequestAssembler.js';
import { validateExteriorRequest } from './validators.js';
import fixture from './street-frontage.fixture.json';

const { atlas: city, connections } = fixture;

it( 'preserves the exact access street and explicit pocket constraints on real frontages', async () => {

	const before = structuredClone( fixture );
	const current = fixture.current;
	const assembler = new RequestAssembler( current.atlas, current.connections );
	expect( new Set( Object.values( current.sourceFaces ) ) ).toEqual( new Set( [ 0, 1, 2, 3 ] ) );
	for ( const parcel of current.atlas.parcels ) {

		const request = assembler.assemble( parcel.id );
		request.options.doorMotion = 'pocket';
		const edge = current.atlas.streets.edges.find( edge => edge.id === parcel.access.edgeId );
		expect( request.parcel.streetAccess ).toEqual( { edgeId: edge.id, path: edge.path } );
		expect( request.parcel.accessPoint ).toEqual( parcel.access.point );
		expect( request.apertures ).toEqual( [] );
		expect( request.options.doorMotion ).toBe( 'pocket' );
		expect( validateExteriorRequest( request ) ).toEqual( [] );
		const { blueprint } = await generate( request, { textures: { mode: 'keys' } } );
		const ground = blueprint.floors.find( floor => floor.index === 0 );
		const entrance = ground.openings.find( opening => opening.doorRole === 'main' );
		expect( entrance, parcel.id ).toBeDefined();
		expect( entrance.door.motion.kind, parcel.id ).toBe( 'pocket' );
		expect( entrance.door.motion.clearDepth ).toBe( 0 );
		expect( entrance.door.cassette ).toBeDefined();

	}
	expect( fixture ).toEqual( before );

}, 30_000 );

it( 'preserves fixed wire anchors and rejects basement anchors incompatible with the active floor policy', () => {

	const before = structuredClone( fixture );
	const assembler = new RequestAssembler( city, connections );
	expect( assembler.assemble( 'p25' ).apertures )
		.toEqual( connections.apertures.filter( aperture => aperture.buildingId === 'p25' ) );
	for ( const parcelId of [ 'p16', 'p56' ] ) {

		const aperture = connections.apertures.find( aperture => aperture.buildingId === parcelId );
		expect( aperture.base ).toBe( -4 );
		expect( () => assembler.assemble( parcelId ) ).toThrow( expect.objectContaining( {
			code: 'E_ENVELOPE_INFEASIBLE',
			message: expect.stringContaining( `${parcelId}: fixed basement apertures` ),
		} ) );

	}
	expect( fixture ).toEqual( before );

} );

it( 'rejects a missing named access street instead of emitting an ambiguous point-only request', () => {

	const invalid = structuredClone( city );
	invalid.streets.edges = [];
	expect( () => new RequestAssembler( invalid, { apertures: [] } ).assemble( 'p16' ) )
		.toThrow( expect.objectContaining( { code: 'E_REQUEST_INVALID', message: expect.stringContaining( 'e25' ) } ) );

} );
