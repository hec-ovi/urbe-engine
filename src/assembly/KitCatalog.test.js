import { describe, expect, it } from 'vitest';
import { KitCatalog, kitToWorld, placementFrame } from './KitCatalog.js';

const lot = ( x, z, width, depth ) => [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];

function request( id, { footprint, accessPoint, type = 'offices', tier = 'mid', floors = 8, apertures = [] } ) {

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
		// Same lot size and building, three streets: south, east and north.
		const south = catalog.add( 'p0', request( 'p0', { footprint: lot( 100, 200, 18, 25 ), accessPoint: [ 109, 200 ] } ) );
		const east = catalog.add( 'p1', request( 'p1', { footprint: lot( 500, 40, 25, 18 ), accessPoint: [ 525, 49 ] } ) );
		const north = catalog.add( 'p2', request( 'p2', { footprint: lot( 0, 0, 18, 25 ), accessPoint: [ 9, 25 ] } ) );

		expect( new Set( [ south, east, north ] ).size ).toBe( 1 );
		expect( catalog.requests() ).toHaveLength( 1 );
		expect( catalog.table().map( ( row ) => row.rotation ) ).toEqual( [ 0, 90, 180 ] );

		const [ kit ] = catalog.requests();
		expect( kit.buildingId ).toBe( south );
		expect( kit.seed ).toBe( `world:kit:${south}` );
		expect( kit.parcel.footprint ).toEqual( lot( 0, 0, 18, 25 ) );
		expect( kit.parcel.accessPoint ).toEqual( [ 9, 0 ] );

	} );

	it( 'puts every placed kit back exactly on its own lot', () => {

		for ( const [ footprint, accessPoint ] of [
			[ lot( 100, 200, 18, 25 ), [ 109, 200 ] ],
			[ lot( 500, 40, 25, 18 ), [ 525, 49 ] ],
			[ lot( 0, 0, 18, 25 ), [ 9, 25 ] ],
			[ lot( 7.5, 3, 12, 30 ), [ 7.5, 18 ] ]
		] ) {

			const frame = placementFrame( request( 'p', { footprint, accessPoint } ) );
			const corners = [ [ 0, 0 ], [ frame.width, 0 ], [ frame.width, frame.depth ], [ 0, frame.depth ] ]
				.map( ( point ) => kitToWorld( frame, point ) );

			expect( new Set( corners.map( String ) ) ).toEqual( new Set( footprint.map( String ) ) );
			expect( kitToWorld( frame, [ frame.access, 0 ] ) ).toEqual( accessPoint );

		}

	} );

	it( 'leaves a parcel its own building when no kit can stand on it', () => {

		const catalog = new KitCatalog( 'world' );
		const wedge = [ [ 0, 0 ], [ 20, 0 ], [ 20, 14 ], [ 6, 22 ] ];

		expect( catalog.add( 'p3', request( 'p3', { footprint: wedge, accessPoint: [ 10, 0 ] } ) ) ).toBeNull();
		expect( catalog.add( 'p4', request( 'p4', {
			footprint: lot( 0, 0, 18, 25 ), accessPoint: [ 9, 0 ], apertures: [ { id: 'a0', kind: 'bridge' } ]
		} ) ) ).toBeNull();
		expect( catalog.add( 'p5', request( 'p5', { footprint: lot( 0, 0, 18, 25 ), accessPoint: [ 9, 12 ] } ) ) ).toBeNull();
		expect( catalog.bespoke ).toEqual( [ 'p3', 'p4', 'p5' ] );
		expect( catalog.requests() ).toEqual( [] );

	} );

	it( 'keeps buildings apart when anything but placement differs', () => {

		const catalog = new KitCatalog( 'world' );
		const footprint = lot( 0, 0, 18, 25 );
		const accessPoint = [ 9, 0 ];

		catalog.add( 'p0', request( 'p0', { footprint, accessPoint } ) );
		catalog.add( 'p1', request( 'p1', { footprint, accessPoint, floors: 12 } ) );
		catalog.add( 'p2', request( 'p2', { footprint, accessPoint, tier: 'rich' } ) );
		catalog.add( 'p3', request( 'p3', { footprint, accessPoint, type: 'hotel' } ) );
		catalog.add( 'p4', request( 'p4', { footprint: lot( 0, 0, 18, 26 ), accessPoint } ) );

		expect( catalog.requests() ).toHaveLength( 5 );

	} );

} );
