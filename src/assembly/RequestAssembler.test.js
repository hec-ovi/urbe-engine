import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { BuildingPipeline } from './BuildingPipeline.js';
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

	it( 'validates the published Exterior policy and refuses an invalid or street-less request before generation', async () => {

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

		// a parcel whose named access street is absent never becomes a point-only request
		const streetless = atlasWith( officeParcel );
		streetless.streets.edges = [];
		expect( () => new RequestAssembler( streetless, connections ).assemble( 'p7' ) )
			.toThrow( expect.objectContaining( { code: 'E_REQUEST_INVALID', message: expect.stringContaining( 'e1' ) } ) );

	} );

	it( 'assembles the same exterior and interior request from the same inputs, parcel and apertures verbatim', () => {

		const atlas = atlasWith( officeParcel );
		const buildingGrid = { origin: [ 14.5, - 8 ], angle: 0.31, spacing: 0.5 };
		atlas.meta.buildingGrid = buildingGrid;

		const a = new RequestAssembler( atlas, connections ).assemble( 'p7' );
		const b = new RequestAssembler( atlas, connections ).assemble( 'p7' );

		expect( JSON.stringify( b ) ).toBe( JSON.stringify( a ) );
		expect( a.seed ).toBe( 'urbe:p7' );
		expect( a.building.type ).toBe( 'offices' );
		expect( a.building.tier ).toBe( 'rich' );
		expect( a.theme ).toBe( 'cyberpunk' );
		expect( a.options.glb ).toBe( 'merged' );
		expect( a.options.architecture ).toBe( 'auto' );
		expect( a.options ).not.toHaveProperty( 'doorMotion' );
		expect( a.parcel.footprint ).toEqual( officeParcel.footprint );
		expect( a.parcel.accessPoint ).toEqual( officeParcel.access.point );
		expect( a.parcel.streetAccess ).toEqual( { edgeId: 'e1', path: atlas.streets.edges[ 0 ].path } );
		expect( a.parcel.buildingGrid ).toEqual( buildingGrid );
		expect( a.apertures ).toEqual( [ bridgeAperture ] );
		expect( JSON.stringify( a.apertures[ 0 ] ) ).toBe( JSON.stringify( bridgeAperture ) );
		expect( validateExteriorRequest( a ) ).toEqual( [] );

		// a world published before the construction frame gets none invented for it
		const legacy = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );

		expect( legacy.parcel ).not.toHaveProperty( 'buildingGrid' );
		expect( validateExteriorRequest( legacy ) ).toEqual( [] );

		const blueprint = { buildingId: 'p7', floors: [ { index: 0, kind: 'lobby' } ] };
		const inputs = [ 'p7', { blueprint, shellGlb: '/world/p7/p7.glb' } ];
		const interior = new RequestAssembler( atlas, connections ).assembleInterior( ...inputs );

		expect( JSON.stringify( new RequestAssembler( atlas, connections ).assembleInterior( ...inputs ) ) ).toBe( JSON.stringify( interior ) );
		expect( interior.seed ).toBe( 'urbe:p7' );
		expect( interior.building ).toEqual( { id: 'p7', type: 'offices', tier: 'rich' } );
		expect( interior.materialTheme ).toBe( 'cyberpunk' );
		expect( interior.assignments ).toEqual( [ { floor: 0, kind: 'lobby' } ] );

	} );

	it( 'names an approved design on a unique building and leaves the choice to Exterior elsewhere', () => {

		const landmark = {
			id: 'p7', type: 'hospital', tier: 'rich', landmark: true,
			footprint: [ [ 0, 0 ], [ 90, 0 ], [ 90, 44 ], [ 0, 44 ] ],
			access: { edgeId: 'e1', point: [ 45, - 2 ] },
			envelope: { minFloors: 4, maxFloors: 9, floorHeight: 4.5, maxHeight: 45 }
		};
		const open = new RequestAssembler( atlasWith( landmark ), { apertures: [] } ).assemble( 'p7' );

		// The landmark design comes first on a plate that fits its taper.
		expect( open.options.architecture ).toBe( 'garden-taper' );
		expect( validateExteriorRequest( open ) ).toEqual( [] );

		// A bridge pins the faces, which the landmark design does not take, so
		// the building wears one of the six that do.
		const bound = new RequestAssembler( atlasWith( landmark ), connections ).assemble( 'p7' );

		expect( [ 'balcony-grid', 'faceted-bays', 'mirror-frame', 'mirror-shutters', 'white-grid' ] )
			.toContain( bound.options.architecture );

		// Even an uncut cable anchor must remain on its exact authored plane.
		const wire = aperture( 'wire', 'wire-anchor', 7.5, 0.1 );
		const anchored = new RequestAssembler( atlasWith( landmark ), { apertures: [ wire ] } ).assemble( 'p7' );
		expect( anchored.options.architecture ).not.toBe( 'garden-taper' );
		expect( anchored.apertures ).toEqual( [ wire ] );

		// Too small for any of them, and an ordinary lot, keep Exterior's choice.
		const small = { ...landmark, footprint: [ [ 0, 0 ], [ 14, 0 ], [ 14, 11 ], [ 0, 11 ] ] };

		expect( new RequestAssembler( atlasWith( small ), { apertures: [] } ).assemble( 'p7' ).options.architecture ).toBe( 'auto' );
		expect( new RequestAssembler( atlasWith( { ...landmark, landmark: false } ), { apertures: [] } )
			.assemble( 'p7' ).options.architecture ).toBe( 'auto' );

	} );

	it( 'measures a unique building along the axis Exterior fits it on', () => {

		// 24 m along X and 40 m along Z, its first edge running up Z: mirror
		// shutters takes it fronting that 40 m edge and not the 24 m one.
		const tower = {
			id: 'p7', type: 'offices', tier: 'rich', landmark: true,
			footprint: [ [ 24, 0 ], [ 24, 40 ], [ 0, 40 ], [ 0, 0 ] ],
			access: { edgeId: 'e1', point: [ 12, - 2 ] },
			envelope: { minFloors: 4, maxFloors: 9, floorHeight: 4.5, maxHeight: 45 }
		};
		const grid = { origin: [ 0, 0 ], angle: 0, spacing: 0.5 };
		// The designs it wears over many worlds, so the seeded pick meets every one it may take.
		const designs = ( { buildingGrid, apertures = [] } ) => new Set( Array.from( { length: 32 }, ( _, n ) => {

			const atlas = atlasWith( tower );
			atlas.meta.seed = `urbe-${n}`;
			if ( buildingGrid ) atlas.meta.buildingGrid = buildingGrid;
			return new RequestAssembler( atlas, { apertures } ).assemble( 'p7' ).options.architecture;

		} ) );

		// On the building grid it fronts X, 24 m across.
		const onGrid = designs( { buildingGrid: grid } );
		expect( onGrid ).not.toContain( 'mirror-shutters' );
		expect( onGrid ).not.toContain( 'auto' );
		// With no grid, or with a connection pinning its faces, it fronts its first edge.
		expect( designs( {} ) ).toContain( 'mirror-shutters' );
		expect( designs( { buildingGrid: grid, apertures: [ bridgeAperture ] } ) ).toContain( 'mirror-shutters' );
		// An anchor from just below ground to just above it pins them too, as Exterior reads it.
		const anchor = aperture( 'grade', 'wire-anchor', - 0.05, 0.1 );
		expect( designs( { buildingGrid: grid, apertures: [ anchor ] } ) ).toContain( 'mirror-shutters' );

	} );

	it( 'signs a venue with its name lettered for the marquee, steps down to the word, then to nothing', () => {

		const sign = ( atlas, parcelId, options ) => new RequestAssembler( atlas, connections ).assemble( parcelId, options ).options.signage;
		const [ wharf, coffee ] = namedCity.parcels;
		const unnamed = ( type ) => new RequestAssembler( atlasWith( { ...officeParcel, type } ), { apertures: [] } ).assemble( 'p7' ).options.signage;

		expect( sign( namedCity, 'p1' ) ).toEqual( { mode: 'marquee', text: 'THE SALT WHARF' } );

		// the accent folds onto its letter, the quotes outside the atlas read as
		// its space, and whole words stay while they fit the 40-character line width
		expect( sign( namedCity, 'p2' ) ).toEqual( { mode: 'marquee', text: 'GRANDMOTHER LUDMILA\'S CAFE HUMMINGBIRD' } );

		// the venue word when the name is empty or not even its first word fits
		const unfit = { ...namedCity, parcels: [ { ...wharf, name: '' }, { ...coffee, name: 'X'.repeat( 41 ) } ] };

		expect( sign( unfit, 'p1' ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( unfit, 'p2' ) ).toEqual( { mode: 'marquee', text: 'COFFEE' } );

		// the rungs the pipeline steps down when the facade is too small for the text
		expect( sign( namedCity, 'p1', { signage: 'venue' } ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( namedCity, 'p1', { signage: 'none' } ) ).toBe( undefined );

		// a type a passer-by does not read off the street wears no sign at all
		expect( unnamed( 'coffee_shop' ) ).toEqual( { mode: 'marquee', text: 'COFFEE' } );
		expect( unnamed( 'offices' ) ).toBe( undefined );
		expect( unnamed( 'residential' ) ).toBe( undefined );

	} );

	it( 'chooses a floor count inside exterior\'s feasible range and refuses an envelope nothing fits', () => {

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

		expect( new RequestAssembler( atlasWith( hotelParcel ), pinned ).assemble( 'p7' ).building.floors ).toBe( 6 );

		// No apertures: envelope4..12 intersects the active pitch range1..10.
		const plain = new RequestAssembler( atlasWith( officeParcel ), { apertures: [] } ).assemble( 'p7' );

		expect( plain.building.floors ).toBeGreaterThanOrEqual( 4 );
		expect( plain.building.floors ).toBeLessThanOrEqual( 10 );

		// a one-ULP anchor value is still a whole floor count, and the apertures are untouched
		const ulp = { ...officeParcel, type: 'residential', envelope: { minFloors: 15, maxFloors: 32, maxHeight: 139.5 } };
		const fixed = { apertures: [ 54, 62.99999999999999, 76.5, 94.5 ].map( ( base, index ) => aperture( `fixed${index}`, 'bridge', base ) ) };
		const before = structuredClone( fixed );

		expect( new RequestAssembler( atlasWith( ulp ), fixed ).assemble( 'p7' ).building.floors ).toBeGreaterThanOrEqual( 15 );
		expect( fixed ).toEqual( before );

		// the published clear-height policy wins, a taller family minimum stays taller
		const constants = structuredClone( loadFloorConstants() );
		constants.constants.residential.minFloorHeight = 6;
		constants.constants.residential.maxFloorHeight = 9;
		const tall = { ...officeParcel, type: 'residential', envelope: { minFloors: 8, maxFloors: 8, maxHeight: 36 } };

		expect( new RequestAssembler( atlasWith( tall ), { apertures: [] }, constants ).assemble( 'p7' ).building.floors ).toBe( 6 );

		// fixed basement bases keep their exact gaps, and an incompatible one fails
		const basements = { apertures: [ aperture( 't0', 'tunnel', - 9 ), aperture( 'w0', 'wire-anchor', - 20, 0.1 ) ] };

		expect( new RequestAssembler( atlasWith( officeParcel ), basements ).assemble( 'p7' ).building.basements ).toBe( 2 );
		for ( const infeasible of [
			{ apertures: [ aperture( 'g0', 'bridge', 0, 7 ) ] },
			{ apertures: [ aperture( 't0', 'tunnel', - 8 ) ] }
		] ) {

			expect( () => new RequestAssembler( atlasWith( officeParcel ), infeasible ).assemble( 'p7' ) )
				.toThrow( expect.objectContaining( { code: 'E_ENVELOPE_INFEASIBLE' } ) );

		}

	} );

} );
