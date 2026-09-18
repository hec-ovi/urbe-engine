import { expect, it } from 'vitest';
import { generate } from '../../../exterior/src/index.ts';
import { RequestAssembler } from './RequestAssembler.js';
import { validateExteriorRequest } from './validators.js';
import fixture from './street-frontage.fixture.json';

it( 'preserves the exact access street and explicit pocket constraints on real frontages', async () => {

	const before = structuredClone( fixture );
	const assembler = new RequestAssembler( fixture.atlas, fixture.connections );

	expect( new Set( Object.values( fixture.sourceFaces ) ) ).toEqual( new Set( [ 0, 1, 2, 3 ] ) );
	for ( const parcel of fixture.atlas.parcels ) {

		const request = assembler.assemble( parcel.id );
		request.options.doorMotion = 'pocket';
		const edge = fixture.atlas.streets.edges.find( edge => edge.id === parcel.access.edgeId );

		expect( request.parcel.streetAccess ).toEqual( { edgeId: edge.id, path: edge.path } );
		expect( request.parcel.accessPoint ).toEqual( parcel.access.point );
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
