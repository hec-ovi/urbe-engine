import { describe, expect, it } from 'vitest';
import { RequestAssembler } from '../RequestAssembler.js';
import { KitAssembler } from './KitAssembler.js';
import { PlanLibrary } from './PlanLibrary.js';
import { fittingFamilies, landmarkFamilies } from './Families.js';
import { plateSides } from './LotRectangle.js';

/** What a storey costs in height, so an envelope's floors are the ones it allows. */
const PITCH = 4.5;

/**
 * A blueprint slice shaped per ../../../../atlas/CONTRACT.md: whole-bay lots on
 * one street, each one optionally standing in a block tiled from a template.
 * @param specs `{ id, type, tier, low, high, block, slot, at: [x, z], size: [width, depth] }`
 */
function city( specs, template = null ) {

	const parcels = specs.map( ( { id, type, tier, low, high, block, at, size } ) => ( {
		id, type, tier, blockId: block ?? null, landmark: false,
		lot: ring( at, size ),
		footprint: ring( [ at[ 0 ] + 2, at[ 1 ] + 2 ], [ size[ 0 ] - 4, size[ 1 ] - 4 ] ),
		access: { edgeId: 'e0', point: [ at[ 0 ] + size[ 0 ] / 2, at[ 1 ] - 2 ] },
		envelope: { minFloors: low, maxFloors: high, floorHeight: PITCH, maxHeight: high * PITCH }
	} ) );
	const blocks = [ ...new Set( specs.map( ( spec ) => spec.block ).filter( Boolean ) ) ].map( ( id ) => {

		const standing = specs.filter( ( spec ) => spec.block === id );
		const corner = [ Math.min( ...standing.map( ( spec ) => spec.at[ 0 ] ) ),
			Math.min( ...standing.map( ( spec ) => spec.at[ 1 ] ) ) ];

		return { id, template: template?.id ?? null, parcelIds: standing.map( ( spec ) => spec.id ),
			boundary: ring( corner, [ 400, 400 ] ) };

	} );

	return {
		meta: { seed: 'kit-families', ...( template ? { blockTemplates: [ template ] } : {} ) },
		parcels, blocks,
		streets: { edges: [ { id: 'e0', path: [ [ - 100, - 2 ], [ 900, - 2 ] ] } ] }
	};

}

function ring( [ x, z ], [ width, depth ] ) {

	return [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];

}

/**
 * Four blocks of one template on one street: three lots that take a tall
 * building and one whose envelope stops at four floors.
 */
function mixedHeights() {

	return city( [
		{ id: 'tall-a', type: 'offices', tier: 'rich', low: 6, high: 10, block: 'b0', at: [ 0, 0 ], size: [ 24, 32 ] },
		{ id: 'tall-b', type: 'offices', tier: 'rich', low: 6, high: 10, block: 'b1', at: [ 200, 0 ], size: [ 24, 32 ] },
		{ id: 'tall-c', type: 'offices', tier: 'rich', low: 7, high: 10, block: 'b2', at: [ 400, 0 ], size: [ 24, 32 ] },
		{ id: 'squat', type: 'offices', tier: 'rich', low: 2, high: 4, block: 'b3', at: [ 600, 0 ], size: [ 24, 32 ] }
	], { id: 'bt-mixed-heights', lots: [ { offset: [ 0, 0 ], width: 24, depth: 32 } ] } );

}

/** One city planned, with every parcel's building decided and no geometry drawn. */
function plan( atlas ) {

	const plans = new PlanLibrary( { workers: null } );
	const kit = new KitAssembler( atlas, new RequestAssembler( atlas, { apertures: [] } ), plans );

	return { plans, kit, of: ( id ) => kit.candidate( id )?.plan ?? null };

}

describe( 'the approved families a lot may wear', () => {

	const bays = ( across, deep ) => ( { across, deep } );
	const rich = { type: 'offices', tier: 'rich' };

	it( 'stands each family on the lots and heights its published dimensions fit', () => {

		// Two bays is 16 m, which every family is too broad for.
		expect( fittingFamilies( bays( 2, 4 ), 6, rich ) ).toEqual( [] );
		// Three bays is 24 m, which clears balcony grid's 20.5 m, faceted bays'
		// 16.5 m and white grid's 17.5 m; mirror shutters wants 29 m across.
		expect( fittingFamilies( bays( 3, 3 ), 6, rich ) )
			.toEqual( [ 'balcony-grid', 'faceted-bays', 'mirror-frame', 'white-grid' ] );
		// Its minima are oriented: 29 m along the entrance face and 19 m deep,
		// so four bays across and three deep, never the other way round.
		expect( fittingFamilies( bays( 4, 3 ), 6, rich ) ).toContain( 'mirror-shutters' );
		expect( fittingFamilies( bays( 3, 4 ), 6, rich ) ).not.toContain( 'mirror-shutters' );
		expect( fittingFamilies( bays( 4, 2 ), 6, rich ) ).not.toContain( 'mirror-shutters' );
		// White grid asks for four floors, every other family for two.
		expect( fittingFamilies( bays( 4, 3 ), 3, rich ) ).not.toContain( 'white-grid' );
		expect( fittingFamilies( bays( 4, 3 ), 2, rich ) )
			.toEqual( [ 'balcony-grid', 'faceted-bays', 'mirror-frame', 'mirror-shutters' ] );
		// Corporate sectors is a big rich lot's tower: 35 m on both sides and
		// twelve floors, on a corporate parcel or the top tier.
		expect( fittingFamilies( bays( 5, 5 ), 12, { type: 'corpo', tier: 'rich' } ) ).toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 4, 5 ), 12, { type: 'corpo', tier: 'rich' } ) ).not.toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 5, 5 ), 11, { type: 'corpo', tier: 'rich' } ) ).not.toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 5, 5 ), 12, { type: 'corpo', tier: 'mid' } ) ).toEqual( [] );
		// The luxury families stay off mid and poor streets, and the landmark
		// design is never one a repeated building may wear.
		for ( const tier of [ 'mid', 'poor' ] ) expect( fittingFamilies( bays( 7, 7 ), 20, { type: 'offices', tier } ) ).toEqual( [] );
		expect( fittingFamilies( bays( 7, 7 ), 20, rich ) ).not.toContain( 'garden-taper' );

	} );

	it( 'reads a lot across the face its entrance takes, alone and on a template slot', () => {

		// Rich lots on the street along z = -2, each on a block of its own.
		const lots = ( prefix, size ) => Array.from( { length: 24 }, ( _, n ) => ( {
			id: `${prefix}${n}`, type: 'offices', tier: 'rich', low: 4, high: 8, block: `b${n}`, at: [ n * 36, 0 ], size
		} ) );
		const worn = ( atlas ) => {

			const city0 = plan( atlas );
			return atlas.parcels.map( ( parcel ) => city0.of( parcel.id ) );

		};
		const narrow = worn( city( lots( 'narrow', [ 24, 32 ] ) ) );
		const wide = worn( city( lots( 'wide', [ 32, 24 ] ) ) );

		// A three-bay front never stands mirror shutters; a four-bay one does.
		expect( narrow.map( ( built ) => built.family ) ).not.toContain( 'mirror-shutters' );
		expect( wide.map( ( built ) => built.family ) ).toContain( 'mirror-shutters' );
		expect( [ narrow[ 0 ].baysAcross, narrow[ 0 ].baysDeep ] ).toEqual( [ 3, 4 ] );
		expect( [ wide[ 0 ].baysAcross, wide[ 0 ].baysDeep ] ).toEqual( [ 4, 3 ] );

		// A template slot reads each lot standing in it the same way. These are
		// 32 m along x and 24 m along z, fronting a street along x = -2, one
		// template per block so each slot is its own pick: every lot wears its
		// slot's family, and none of them mirror shutters.
		const templated = city( lots( 'side', [ 32, 24 ] ).map( ( spec, n ) => ( { ...spec, at: [ 0, n * 36 ] } ) ) );
		templated.streets.edges.push( { id: 'e1', path: [ [ - 2, - 100 ], [ - 2, 1000 ] ] } );
		templated.meta.blockTemplates = templated.blocks.map( ( block ) => ( {
			id: `bt-${block.id}`, lots: [ { offset: [ 0, 0 ], width: 32, depth: 24 } ]
		} ) );
		for ( const block of templated.blocks ) block.template = `bt-${block.id}`;
		for ( const parcel of templated.parcels ) parcel.access = { edgeId: 'e1', point: [ - 2, parcel.lot[ 0 ][ 1 ] + 12 ] };
		const sided = plan( templated );

		for ( const { id } of templated.parcels ) {

			expect( sided.of( id ).family, id ).toBe( sided.kit.dressing.of( id ).family );
			expect( sided.of( id ).family, id ).not.toBe( 'mirror-shutters' );
			expect( sided.of( id ).baysAcross, id ).toBe( 3 );

		}

	} );

	it( 'fits a unique building on the axis Exterior fronts it on', () => {

		const rich = { type: 'offices', tier: 'rich' };
		const lot = [ [ 0, 0 ], [ 24, 0 ], [ 24, 40 ], [ 0, 40 ] ];
		const turned = plateSides( lot, Math.PI / 2 );

		expect( plateSides( lot, 0 ) ).toEqual( { across: 24, deep: 40 } );
		expect( turned.across ).toBeCloseTo( 40 );
		expect( turned.deep ).toBeCloseTo( 24 );
		expect( landmarkFamilies( plateSides( lot, 0 ), 6, rich ) ).not.toContain( 'mirror-shutters' );
		expect( landmarkFamilies( turned, 6, rich ) ).toContain( 'mirror-shutters' );
		// The landmark design fronts its longer axis whichever way it is turned.
		const park = [ [ 0, 0 ], [ 44, 0 ], [ 44, 90 ], [ 0, 90 ] ];
		expect( landmarkFamilies( plateSides( park, 0 ), 6, rich ) ).toContain( 'garden-taper' );
		expect( landmarkFamilies( plateSides( park, Math.PI / 2 ), 6, rich ) ).toContain( 'garden-taper' );

	} );

	it( 'stands the family the most of a slot\'s lots accept and leaves plain to the lots no family fits', () => {

		const template = { id: 'bt-mixed', lots: [ { offset: [ 0, 0 ], width: 24, depth: 32 } ] };
		const atlas = city( [
			{ id: 'mid-a', type: 'offices', tier: 'mid', low: 4, high: 8, block: 'b0', at: [ 0, 0 ], size: [ 24, 32 ] },
			{ id: 'mid-b', type: 'offices', tier: 'mid', low: 4, high: 8, block: 'b1', at: [ 200, 0 ], size: [ 24, 32 ] },
			{ id: 'rich', type: 'offices', tier: 'rich', low: 4, high: 8, block: 'b2', at: [ 400, 0 ], size: [ 24, 32 ] }
		], template );
		const city0 = plan( atlas );

		// The rich lot is the only one an approved family accepts, so the slot
		// stands that family and the rich lot wears it in its own materials. The
		// mid lots are the exception: no family fits a mid street, so they take
		// the plain building, and both of them take the same one.
		expect( city0.of( 'rich' ).family ).not.toBeNull();
		expect( city0.of( 'rich' ).id ).toContain( 'commercial-rich' );
		expect( city0.of( 'mid-a' ).family ).toBeNull();
		expect( city0.of( 'mid-a' ).id ).toContain( 'commercial-mid' );
		expect( city0.of( 'mid-b' ).id ).toBe( city0.of( 'mid-a' ).id );

	} );

	it( 'stands every building inside the envelope of the lot it covers', () => {

		const template = { id: 'bt-tall', lots: [ { offset: [ 0, 0 ], width: 24, depth: 32 } ] };
		// One slot whose two lots want opposite heights: a tower and a low block.
		const atlas = city( [
			{ id: 'tower', type: 'offices', tier: 'rich', low: 12, high: 18, block: 'b0', at: [ 0, 0 ], size: [ 24, 32 ] },
			{ id: 'low', type: 'offices', tier: 'rich', low: 2, high: 4, block: 'b1', at: [ 200, 0 ], size: [ 24, 32 ] }
		], template );
		const city0 = plan( atlas );

		for ( const parcel of atlas.parcels ) {

			const { floors } = city0.of( parcel.id );

			expect( floors, parcel.id ).toBeGreaterThanOrEqual( parcel.envelope.minFloors );
			expect( floors, parcel.id ).toBeLessThanOrEqual( parcel.envelope.maxFloors );

		}

	} );

	it( 'stands one plan on every block of a slot, at the count the most of its lots allow', () => {

		const city0 = plan( mixedHeights() );

		// Three blocks of one template, three lots whose envelopes all take the
		// slot's count: one building, drawn once.
		expect( new Set( [ 'tall-a', 'tall-b', 'tall-c' ].map( ( id ) => city0.of( id ).id ) ).size ).toBe( 1 );

	} );

	it( 'drops a lot the slot count does not fit to the nearest count its own envelope allows', () => {

		const city0 = plan( mixedHeights() );
		const shared = city0.of( 'tall-a' );
		const squat = city0.of( 'squat' );

		// Its envelope stops at four floors, so it stands four and keeps the
		// design the slot wears: the height is the only thing that moves.
		expect( squat.floors ).toBe( 4 );
		expect( shared.floors ).toBeGreaterThan( 4 );
		expect( squat.family ).toBe( shared.family );
		expect( squat.baysAcross ).toBe( shared.baysAcross );
		expect( squat.baysDeep ).toBe( shared.baysDeep );

	} );

	it( 'draws one plan for every business of a tier, with an empty sign field it letters no word on', () => {

		const atlas = city( [
			{ id: 'hotel', type: 'hotel', tier: 'rich', low: 6, high: 6, at: [ 0, 0 ], size: [ 24, 32 ] },
			{ id: 'market', type: 'commerce', tier: 'rich', low: 6, high: 6, at: [ 100, 0 ], size: [ 24, 32 ] },
			{ id: 'homes', type: 'residential', tier: 'rich', low: 6, high: 6, at: [ 200, 0 ], size: [ 24, 32 ] }
		] );
		const city0 = plan( atlas );
		const hotel = city0.plans.plans.get( city0.of( 'hotel' ).id ).request;

		// A business carries the field the city letters each parcel's own word
		// on, and the plan itself is drawn with none.
		expect( hotel.building ).toMatchObject( { tier: 'rich', floors: 6 } );
		expect( hotel.options.signage ).toEqual( { mode: 'marquee', cells: 10 } );
		// A home is a home: no sign at all.
		expect( city0.plans.plans.get( city0.of( 'homes' ).id ).request.options ).not.toHaveProperty( 'signage' );

		// One building of one tier, whatever business stands in it; a home of
		// the same size and family is another building and another set of bytes.
		const library = new PlanLibrary( { workers: null } );
		const size = { across: 3, deep: 4 };
		const inn = library.want( 'white-grid', size, 6, { type: 'hotel', tier: 'rich' } );
		const market = library.want( 'white-grid', size, 6, { type: 'commerce', tier: 'rich' } );
		const home = library.want( 'white-grid', size, 6, { type: 'residential', tier: 'rich' } );

		expect( inn.id ).toBe( 'white-grid-commercial-rich-3x4x6f' );
		expect( market.id ).toBe( inn.id );
		expect( market.hash ).toBe( inn.hash );
		expect( home.id ).toBe( 'white-grid-residential-rich-3x4x6f' );
		expect( library.folder( home.id ) ).not.toBe( library.folder( inn.id ) );

	} );

} );
