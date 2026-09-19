import { describe, expect, it } from 'vitest';
import { RequestAssembler } from '../RequestAssembler.js';
import { KitAssembler } from './KitAssembler.js';
import { PlanLibrary } from './PlanLibrary.js';
import { fittingFamilies } from './Families.js';

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
		expect( fittingFamilies( bays( 3, 4 ), 6, rich ) ).toContain( 'mirror-shutters' );
		// White grid asks for four floors, every other family for two.
		expect( fittingFamilies( bays( 3, 4 ), 3, rich ) ).not.toContain( 'white-grid' );
		expect( fittingFamilies( bays( 3, 4 ), 2, rich ) )
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

	it( 'dresses each parcel of a slot on its own when its uses share no family, so a rich lot keeps a family', () => {

		const template = { id: 'bt-mixed', lots: [ { offset: [ 0, 0 ], width: 24, depth: 32 } ] };
		const atlas = city( [
			{ id: 'rich', type: 'offices', tier: 'rich', low: 4, high: 8, block: 'b0', at: [ 0, 0 ], size: [ 24, 32 ] },
			{ id: 'mid', type: 'offices', tier: 'mid', low: 4, high: 8, block: 'b1', at: [ 200, 0 ], size: [ 24, 32 ] }
		], template );
		const city0 = plan( atlas );

		// One slot, two streets: the rich lot still wears an approved family and
		// the mid one keeps the generator's own building.
		expect( city0.of( 'rich' ).family ).not.toBeNull();
		expect( city0.of( 'mid' ).family ).toBeNull();

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
		expect( hotel.options.signage ).toEqual( { mode: 'logo', ratio: '3:2' } );
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
