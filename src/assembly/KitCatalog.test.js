import { describe, expect, it } from 'vitest';
import { KitCatalog, kitToWorld, placementFrame, worldToKit } from './KitCatalog.js';

const rect = ( x, z, width, depth ) => [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];

function parcel( id, { x = 0, z = 0, width = 24, depth = 40, lotSize = 'lot-24x40', landmark = false } = {} ) {

	return { id, lot: rect( x, z, width, depth ), lotSize, ...( landmark ? { landmark: true } : {} ) };

}

function request( id, lot, { accessPoint, setback = 2, type = 'offices', tier = 'mid', floors = 8, apertures = [] } ) {

	const xs = lot.map( ( point ) => point[ 0 ] );
	const zs = lot.map( ( point ) => point[ 1 ] );
	const footprint = rect(
		Math.min( ...xs ) + setback, Math.min( ...zs ) + setback,
		Math.max( ...xs ) - Math.min( ...xs ) - setback * 2, Math.max( ...zs ) - Math.min( ...zs ) - setback * 2
	);

	return {
		seed: `world:${id}`,
		buildingId: id,
		parcel: { footprint, accessPoint, streetAccess: { edgeId: `e${id}`, path: [ [ 0, 0 ], [ 1, 0 ] ] }, maxHeight: 40 },
		building: { type, tier, floors },
		theme: 'cyberpunk',
		apertures,
		options: { glb: 'merged', architecture: 'auto' }
	};

}

describe( 'kit catalog', () => {

	it( 'gives one kit to parcels that differ only by where they stand', () => {

		const catalog = new KitCatalog( 'world' );
		// One standard lot size and one building, reached from three different streets.
		const south = parcel( 'p0', { x: 100, z: 200 } );
		const east = parcel( 'p1', { x: 500, z: 40, width: 40, depth: 24 } );
		const north = parcel( 'p2', { x: 0, z: 0 } );

		const ids = [
			catalog.add( south, request( 'p0', south.lot, { accessPoint: [ 112, 200 ] } ) ),
			catalog.add( east, request( 'p1', east.lot, { accessPoint: [ 540, 52 ] } ) ),
			catalog.add( north, request( 'p2', north.lot, { accessPoint: [ 12, 40 ] } ) )
		];

		expect( new Set( ids ).size ).toBe( 1 );
		expect( catalog.requests() ).toHaveLength( 1 );
		expect( catalog.table().map( ( row ) => row.rotation ) ).toEqual( [ 0, 90, 180 ] );
		expect( catalog.table().every( ( row ) => row.lotSize === 'lot-24x40' ) ).toBe( true );

		const [ kit ] = catalog.requests();
		expect( kit.seed ).toBe( `world:kit:${ids[ 0 ]}` );
		expect( kit.parcel.lot ).toEqual( rect( 0, 0, 24, 40 ) );
		expect( kit.parcel.footprint ).toEqual( rect( 2, 2, 20, 36 ) );
		expect( kit.parcel.accessPoint ).toEqual( [ 12, 0 ] );

	} );

	it( 'puts every placed kit back exactly on its own lot', () => {

		for ( const [ lot, accessPoint ] of [
			[ rect( 100, 200, 24, 40 ), [ 112, 200 ] ],
			[ rect( 500, 40, 40, 24 ), [ 540, 52 ] ],
			[ rect( 0, 0, 24, 40 ), [ 12, 40 ] ],
			[ rect( 7.5, 3, 16, 32 ), [ 7.5, 19 ] ]
		] ) {

			const frame = placementFrame( { id: 'p', lot, lotSize: 'lot' }, request( 'p', lot, { accessPoint } ) );
			const corners = [ [ 0, 0 ], [ frame.width, 0 ], [ frame.width, frame.depth ], [ 0, frame.depth ] ]
				.map( ( point ) => kitToWorld( frame, point ) );

			expect( new Set( corners.map( String ) ) ).toEqual( new Set( lot.map( String ) ) );
			expect( kitToWorld( frame, worldToKit( frame, accessPoint ) ) ).toEqual( accessPoint );
			expect( worldToKit( frame, accessPoint )[ 1 ] ).toBe( 0 );

		}

	} );

	it( 'leaves a parcel its own building when no kit can stand on it', () => {

		const catalog = new KitCatalog( 'world' );
		const lot = rect( 0, 0, 24, 40 );
		const accessPoint = [ 12, 0 ];

		const wedge = { id: 'p3', lot: [ [ 0, 0 ], [ 24, 0 ], [ 24, 30 ], [ 8, 40 ] ], lotSize: 'lot-24x40' };
		expect( catalog.add( wedge, request( 'p3', lot, { accessPoint } ) ) ).toBeNull();
		expect( catalog.add( parcel( 'p4' ), request( 'p4', lot, { accessPoint, apertures: [ { id: 'a0', kind: 'bridge' } ] } ) ) ).toBeNull();
		expect( catalog.add( parcel( 'p5', { landmark: true } ), request( 'p5', lot, { accessPoint } ) ) ).toBeNull();
		expect( catalog.add( { id: 'p6', lot }, request( 'p6', lot, { accessPoint } ) ) ).toBeNull();
		expect( catalog.add( parcel( 'p7' ), request( 'p7', lot, { accessPoint: [ 12, 12 ] } ) ) ).toBeNull();

		expect( catalog.bespoke ).toEqual( [ 'p3', 'p4', 'p5', 'p6', 'p7' ] );
		expect( catalog.requests() ).toEqual( [] );

	} );

	it( 'keeps buildings apart when anything but placement differs', () => {

		const catalog = new KitCatalog( 'world' );
		const lot = rect( 0, 0, 24, 40 );
		const accessPoint = [ 12, 0 ];

		catalog.add( parcel( 'p0' ), request( 'p0', lot, { accessPoint } ) );
		catalog.add( parcel( 'p1' ), request( 'p1', lot, { accessPoint, floors: 12 } ) );
		catalog.add( parcel( 'p2' ), request( 'p2', lot, { accessPoint, tier: 'rich' } ) );
		catalog.add( parcel( 'p3' ), request( 'p3', lot, { accessPoint, type: 'hotel' } ) );
		catalog.add( parcel( 'p4' ), request( 'p4', lot, { accessPoint, setback: 3 } ) );

		expect( catalog.requests() ).toHaveLength( 5 );

	} );

} );
