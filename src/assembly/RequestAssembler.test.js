import { describe, it, expect } from 'vitest';
import { RequestAssembler } from './RequestAssembler.js';
import { signRungs } from './BuildingPipeline.js';
import namedCity from './named-city.fixture.json';

/** Minimal atlas blueprint slice shaped per ../atlas/CONTRACT.md. */
function atlasWith( parcel ) {

	return { meta: { seed: 'urbe' }, parcels: [ parcel ] };

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

	it( 'same inputs produce an identical request', () => {

		const a = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );
		const b = new RequestAssembler( atlasWith( officeParcel ), connections ).assemble( 'p7' );

		expect( JSON.stringify( b ) ).toBe( JSON.stringify( a ) );
		expect( a.seed ).toBe( 'urbe:p7' );
		expect( a.building.type ).toBe( 'offices' );
		expect( a.building.tier ).toBe( 'rich' );
		expect( a.theme ).toBe( 'cyberpunk' );
		expect( a.options.glb ).toBe( 'merged' );

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

			return new RequestAssembler( atlasWith( parcel ), connections ).assemble( 'p7' ).options.signage;

		};

		expect( sign( 'coffee_shop' ) ).toEqual( { mode: 'marquee', text: 'COFFEE' } );
		expect( sign( 'restaurant' ) ).toEqual( { mode: 'marquee', text: 'DINER' } );
		expect( sign( 'offices' ) ).toBe( undefined );
		expect( sign( 'residential' ) ).toBe( undefined );

		// a facade the word does not fit on wears none rather than failing
		const bare = new RequestAssembler( atlasWith( { ...officeParcel, type: 'hotel' } ), connections )
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

		// hotel constants 2.8/5.0, bases {8, 16} under maxHeight 22.4: recipe gives
		// gaps [2..2] + [2..2] plus 1..2 floors above the top base -> feasible 5..6.
		// Envelope 6..7 intersects it only at 6; duplicate bases and the wire
		// anchor must not widen the range.
		const hotelParcel = {
			...officeParcel,
			type: 'hotel',
			envelope: { minFloors: 6, maxFloors: 7, floorHeight: 3.2, maxHeight: 22.4 }
		};
		const pinned = { apertures: [
			aperture( 'l1a', 'bridge', 8 ),
			aperture( 'l2a', 'bridge', 16 ),
			aperture( 'l3a', 'ac-tube', 8, 1.6 ),
			aperture( 'l4a', 'ac-tube', 16, 1.6 ),
			aperture( 'l5a', 'wire-anchor', 20, 0.1 )
		] };

		const request = new RequestAssembler( atlasWith( hotelParcel ), pinned ).assemble( 'p7' );
		expect( request.building.floors ).toBe( 6 );

		// No apertures: envelope 4..12 intersected with 1..floor(48 / 3.4) = 14.
		const plain = new RequestAssembler( atlasWith( officeParcel ), { apertures: [] } ).assemble( 'p7' );
		expect( plain.building.floors ).toBeGreaterThanOrEqual( 4 );
		expect( plain.building.floors ).toBeLessThanOrEqual( 12 );

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
