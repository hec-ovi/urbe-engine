import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { BuildingPipeline, signRungs } from './BuildingPipeline.js';
import namedCity from './named-city.fixture.json';
import { validateExteriorRequest } from './validators.js';
import { loadFloorConstants } from './floorFeasibility.js';

/** Minimal atlas blueprint slice shaped per ../atlas/CONTRACT.md. */
function atlasWith( parcel ) {

	return { meta: { seed: 'urbe' }, parcels: [ parcel ],
		streets: { edges: [ { id: parcel.access.edgeId, path: [ [ - 10, - 8 ], [ 30, - 8 ] ] } ] } };

}

const officeParcel = {
	id: 'p7',
	type: 'offices',
	tier: 'rich',
	footprint: [ [ 0, 0 ], [ 20, 0 ], [ 20, 14 ], [ 0, 14 ] ],
	access: { edgeId: 'e1', point: [ 10, - 2 ] },
	envelope: { minFloors: 4, maxFloors: 12, floorHeight: 4, maxHeight: 48 }
};

/** Aperture shaped per ../connections/schemas/aperture.schema.json. */
function aperture( id, kind, base, height = 3.2 ) {

	return {
		id,
		buildingId: 'p7',
		floor: Math.floor( base / 4 ),
		face: 1,
		kind,
		u: 7,
		base,
		width: 4,
		height,
		shape: 'rect',
		cut: {
			polygon: [ [ 20, base, 5 ], [ 20, base, 9 ], [ 20, base + height, 9 ], [ 20, base + height, 5 ] ],
			axisDir: [ 1, 0, 0 ]
		},
		linkId: id.slice( 0, - 1 )
	};

}

const bridgeAperture = aperture( 'l9a', 'bridge', 16.25 );
const connections = { apertures: [ bridgeAperture, { ...aperture( 'x1a', 'bridge', 16.25 ), buildingId: 'other' } ] };

describe( 'RequestAssembler', () => {

	it( 'validates the published Exterior policy and rejects invalid requests before generation', async () => {

		const request = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );
		request.options.coreAdjacency = {
			glazing: { role: 'circulation', clearDepth: 1.2 },
			overrides: [ { floor: 1, opening: 'window-1', role: 'room', clearDepth: 2.4 } ]
		};
		expect( validateExteriorRequest( request ) ).toEqual( [] );

		request.options.coreAdjacency.glazing.clearDepth = - 1;
		const dir = mkdtempSync( join( tmpdir(), 'urbe-request-validation-' ) );

		try {

			const pipeline = new BuildingPipeline( { assemble: () => request } );
			await expect( pipeline.build( 'p7', dir ) ).rejects.toMatchObject( {
				code: 'E_REQUEST_INVALID',
				message: expect.stringContaining( '/options/coreAdjacency/glazing/clearDepth must be >= 0' )
			} );
			expect( readdirSync( dir ) ).toEqual( [] );

		} finally {

			rmSync( dir, { recursive: true, force: true } );

		}

	} );

	it( 'preserves the published construction frame without inventing one for older worlds', () => {

		const atlas = atlasWith( officeParcel );
		const buildingGrid = { origin: [ 14.5, - 8 ], angle: 0.31, spacing: 0.5 };
		atlas.meta.buildingGrid = buildingGrid;
		const request = new RequestAssembler( atlas, connections ).assemble( 'p7' );
		expect( request.parcel.buildingGrid ).toEqual( buildingGrid );
		expect( request.parcel.footprint ).toEqual( officeParcel.footprint );
		expect( request.apertures ).toEqual( [ bridgeAperture ] );
		expect( validateExteriorRequest( request ) ).toEqual( [] );
		const legacy = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );
		expect( legacy.parcel ).not.toHaveProperty( 'buildingGrid' );
		expect( validateExteriorRequest( legacy ) ).toEqual( [] );

	} );

	it( 'same inputs produce an identical request', () => {

		const a = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );
		const b = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );

		expect( JSON.stringify( b ) ).toBe( JSON.stringify( a ) );
		expect( a.seed ).toBe( 'urbe:p7' );
		expect( a.building.type ).toBe( 'offices' );
		expect( a.building.tier ).toBe( 'rich' );
		expect( a.theme ).toBe( 'cyberpunk' );
		expect( a.options.glb ).toBe( 'merged' );
		expect( a.options.architecture ).toBe( 'auto' );
		expect( a.options ).not.toHaveProperty( 'doorMotion' );

	} );

	it( 'passes the parcel apertures through verbatim', () => {

		const request = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );

		expect( request.apertures ).toEqual( [ bridgeAperture ] );
		expect( JSON.stringify( request.apertures[ 0 ] ) ).toBe( JSON.stringify( bridgeAperture ) );

	} );

	it( 'same inputs produce an identical interior request', () => {

		const blueprint = { buildingId: 'p7', floors: [ { index: 0, kind: 'lobby' } ] };
		const inputs = [ 'p7', { blueprint, shellGlb: '/world/p7/p7.glb' } ];

		const a = new RequestAssembler( atlasWith( officeParcel ), connections ).assembleInterior( ...inputs );
		const b = new RequestAssembler( atlasWith( officeParcel ), connections ).assembleInterior( ...inputs );

		expect( JSON.stringify( b ) ).toBe( JSON.stringify( a ) );
		expect( a.seed ).toBe( 'urbe:p7' );
		expect( a.building ).toEqual( { id: 'p7', type: 'offices', tier: 'rich' } );
		expect( a.materialTheme ).toBe( 'cyberpunk' );
		expect( 'assignments' in a ).toBe( false );

	} );

	it( 'signs a venue with what it is, and leaves everything else unsigned', () => {

		const sign = ( type ) => {

			const parcel = { ...officeParcel, type };

			return new RequestAssembler( atlasWith( parcel ), { apertures: [] } ).assemble( 'p7' ).options.signage;

		};

		expect( sign( 'coffee_shop' ) ).toEqual( { mode: 'marquee', text: 'COFFEE' } );
		expect( sign( 'restaurant' ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( 'offices' ) ).toBe( undefined );
		expect( sign( 'residential' ) ).toBe( undefined );

		// a facade the word does not fit on wears none rather than failing
		const bare = new RequestAssembler( atlasWith( { ...officeParcel, type: 'hotel' } ), { apertures: [] } )
			.assemble( 'p7', { signage: 'none' } );
		expect( bare.options.signage ).toBe( undefined );

	} );

	it( 'signs a named venue with its name, lettered for the marquee', () => {

		const sign = ( atlas, parcelId, options ) => new RequestAssembler( atlas, connections ).assemble( parcelId, options ).options.signage;
		const [ wharf, coffee ] = namedCity.parcels;

		expect( sign( namedCity, 'p1' ) ).toEqual( { mode: 'marquee', text: 'THE SALT WHARF' } );

		// the accent folds onto its letter, the quotes outside the atlas read as
		// its space, and whole words stay while they fit the 40-character line width
		expect( sign( namedCity, 'p2' ) ).toEqual( { mode: 'marquee', text: 'GRANDMOTHER LUDMILA\'S CAFE HUMMINGBIRD' } );

		// the venue word when the name is empty or not even its first word fits
		const unfit = { ...namedCity, parcels: [ { ...wharf, name: '' }, { ...coffee, name: 'X'.repeat( 41 ) } ] };
		expect( sign( unfit, 'p1' ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( unfit, 'p2' ) ).toEqual( { mode: 'marquee', text: 'COFFEE' } );

		// the pipeline steps down to the word, then to no sign, when the facade is too small
		expect( sign( namedCity, 'p1', { signage: 'venue' } ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( namedCity, 'p1', { signage: 'none' } ) ).toBe( undefined );

	} );

	it( 'chooses a floor count inside exterior\'s feasible range', () => {

		// Active hotel pitch4.5..5.0, bases9/18 under maxHeight27: recipe gives
		// gaps [2..2] + [2..2] plus 1..2 floors above the top base -> feasible 5..6.
		// Envelope 6..7 intersects it only at 6; duplicate bases and the wire
		// anchor must not widen the range.
		const hotelParcel = {
			...officeParcel,
			type: 'hotel',
			envelope: { minFloors: 6, maxFloors: 7, floorHeight: 3.2, maxHeight: 27 }
		};
		const pinned = { apertures: [
			aperture( 'l1a', 'bridge', 9 ),
			aperture( 'l2a', 'bridge', 18 ),
			aperture( 'l3a', 'ac-tube', 9, 1.6 ),
			aperture( 'l4a', 'ac-tube', 18, 1.6 ),
			aperture( 'l5a', 'wire-anchor', 20, 0.1 )
		] };

		const request = new RequestAssembler( atlasWith( hotelParcel ), pinned ).assemble( 'p7' );
		expect( request.building.floors ).toBe( 6 );

		// No apertures: envelope4..12 intersects the active pitch range1..10.
		const plain = new RequestAssembler( atlasWith( officeParcel ), { apertures: [] } ).assemble( 'p7' );
		expect( plain.building.floors ).toBeGreaterThanOrEqual( 4 );
		expect( plain.building.floors ).toBeLessThanOrEqual( 10 );

	} );

	it( 'retains integral floor counts across one-ULP fixed anchor values', () => {

		for ( const [ type, maxHeight, bases ] of [
			[ 'offices', 144, [ 54, 62.99999999999999 ] ],
			[ 'residential', 139.5, [ 54, 62.99999999999999, 76.5, 94.5 ] ]
		] ) {

			const parcel = { ...officeParcel, type, envelope: { minFloors: 15, maxFloors: 32, maxHeight } };
			const pinned = { apertures: bases.map( ( base, index ) => aperture( `fixed${index}`, 'bridge', base ) ) };
			const before = structuredClone( pinned );
			const request = new RequestAssembler( atlasWith( parcel ), pinned ).assemble( 'p7' );
			expect( request.building.floors ).toBeGreaterThanOrEqual( 15 );
			expect( request.apertures ).toEqual( before.apertures );
			expect( pinned ).toEqual( before );

		}
		const short = { ...officeParcel, type: 'residential' };
		expect( () => new RequestAssembler( atlasWith( short ), { apertures: [ aperture( 'short', 'bridge', 4.49999999 ) ] } ).assemble( 'p7' ) )
			.toThrow( expect.objectContaining( { code: 'E_ENVELOPE_INFEASIBLE' } ) );

	} );

	it( 'uses published clear-height policy, retains taller family minima and fixed basement bases', () => {

		const constants = structuredClone( loadFloorConstants() );
		constants.constants.residential.minFloorHeight = 6;
		constants.constants.residential.maxFloorHeight = 9;
		const parcel = { ...officeParcel, type: 'residential', envelope: { minFloors: 8, maxFloors: 8, maxHeight: 36 } };
		expect( new RequestAssembler( atlasWith( parcel ), { apertures: [] }, constants ).assemble( 'p7' ).building.floors ).toBe( 6 );

		const pinned = { apertures: [ aperture( 't0', 'tunnel', - 9 ), aperture( 'w0', 'wire-anchor', - 20, 0.1 ) ] };
		const before = structuredClone( pinned );
		const request = new RequestAssembler( atlasWith( officeParcel ), pinned ).assemble( 'p7' );
		expect( request.building.basements ).toBe( 2 );
		expect( request.apertures ).toEqual( before.apertures );
		expect( pinned ).toEqual( before );
		const tallGround = { apertures: [ aperture( 'g0', 'bridge', 0, 7 ) ] };
		expect( () => new RequestAssembler( atlasWith( officeParcel ), tallGround ).assemble( 'p7' ) ).toThrow( expect.objectContaining( { code: 'E_ENVELOPE_INFEASIBLE' } ) );
		const incompatible = { apertures: [ aperture( 't0', 'tunnel', - 8 ) ] };
		expect( () => new RequestAssembler( atlasWith( officeParcel ), incompatible ).assemble( 'p7' ) ).toThrow( expect.objectContaining( { code: 'E_ENVELOPE_INFEASIBLE' } ) );

	} );

} );

/**
 * A shell is generated once per distinct sign text, and a building that has
 * no sign at all is still generated once: skipping it left the parcel with no
 * building.
 */
describe( 'signRungs', () => {

	it( 'yields one request for a building with no sign', () => {

		const rungs = [ ...signRungs( () => ( { options: {} } ) ) ];

		expect( rungs ).toHaveLength( 1 );
		expect( rungs[ 0 ].text ).toBe( null );

	} );

	it( 'steps name, venue word, none without repeating a text', () => {

		const texts = { name: 'THE SALT WHARF', venue: 'DINER', none: null };
		const rungs = [ ...signRungs( ( signage ) => ( { options: { signage: texts[ signage ] ? { text: texts[ signage ] } : undefined } } ) ) ];

		expect( rungs.map( ( r ) => r.text ) ).toEqual( [ 'THE SALT WHARF', 'DINER', null ] );

	} );

} );
