import { expect, it } from 'vitest';
import { generate } from '../../../exterior/src/index.ts';
import { RequestAssembler } from './RequestAssembler.js';
import { validateExteriorRequest } from './validators.js';
import fixture from './street-frontage.fixture.json';

const { atlas: city, connections } = fixture;

it( 'preserves the exact access street and generates pocket entrances on all four real frontages', async () => {

	const before = structuredClone( fixture );
	const assembler = new RequestAssembler( city, connections );
	const expected = { p16: 2, p25: 3, p26: 3, p56: 1 };
	for ( const parcel of city.parcels ) {

		const request = assembler.assemble( parcel.id );
		const edge = city.streets.edges.find( edge => edge.id === parcel.access.edgeId );
		expect( request.parcel.streetAccess ).toEqual( { edgeId: edge.id, path: edge.path } );
		expect( request.parcel.accessPoint ).toEqual( parcel.access.point );
		expect( request.apertures ).toEqual( connections.apertures.filter( aperture => aperture.buildingId === parcel.id ) );
		expect( request.options.doorMotion ).toBe( 'pocket' );
		expect( validateExteriorRequest( request ) ).toEqual( [] );
		const { blueprint } = await generate( request, { textures: { mode: 'keys' } } );
		const ground = blueprint.floors.find( floor => floor.index === 0 );
		const entrance = ground.openings.find( opening => opening.doorRole === 'main' );
		expect( entrance.edge, parcel.id ).toBe( expected[ parcel.id ] );
		expect( entrance.door.motion.kind, parcel.id ).toBe( 'pocket' );
		expect( entrance.door.motion.clearDepth ).toBe( 0 );
		expect( entrance.door.cassette ).toBeDefined();

	}
	expect( fixture ).toEqual( before );

}, 30_000 );

it( 'rejects a missing named access street instead of emitting an ambiguous point-only request', () => {

	const invalid = structuredClone( city );
	invalid.streets.edges = [];
	expect( () => new RequestAssembler( invalid, { apertures: [] } ).assemble( 'p16' ) )
		.toThrow( expect.objectContaining( { code: 'E_REQUEST_INVALID', message: expect.stringContaining( 'e25' ) } ) );

} );
