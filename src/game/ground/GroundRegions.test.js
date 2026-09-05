import { describe, expect, it } from 'vitest';
import { GroundBuilder } from './GroundBuilder.js';

const rectangle = x => [ [ x, 0 ], [ x + 1, 0 ], [ x + 1, 1 ], [ x, 1 ] ];
const fixture = () => ( {
	streets: { construction: { paving: {
		version: '1.0.0',
		layouts: [ { id: 'layout', familyId: 'industrial', modules: [], bands: {} } ],
		frames: [ { id: 'frame', origin: [ 10, 20 ], u: [ 1, 0 ], gridStep: 0.001 } ],
		regions: [ 'furnishing', 'walking', 'circulation' ].map( band => ( {
			id: band, layoutId: 'layout', frameId: 'frame', band,
			owner: { kind: 'run', runId: 'r0', edgeId: 'e0', side: 'left', station: [ 0, 10 ] }
		} ) )
	} } },
	volumetric: { ground: [ 'body', 'joint', 'border' ].map( ( role, i ) => ( {
		surface: 'sidewalk', bottom: 0, top: 0.15, polygon: rectangle( i ),
		construction: { regionId: 'furnishing', part: { kind: 'solid', role } }
	} ) ).concat( [ 'walking', 'circulation' ].map( ( regionId, i ) => ( {
		surface: 'sidewalk', polygon: rectangle( i + 3 ),
		construction: { regionId, part: { kind: 'solid', role: 'approach' } }
	} ) ) ) }
} );

describe( 'GroundBuilder.regionFootprints', () => {

	it( 'preserves every finish part and exact owner record within one functional band', () => {

		const atlas = fixture();
		const before = JSON.stringify( atlas );
		const views = GroundBuilder.regionFootprints( atlas, 'furnishing' );
		expect( views ).toHaveLength( 1 );
		const view = views[ 0 ];
		expect( view.region ).toBe( atlas.streets.construction.paving.regions[ 0 ] );
		expect( view.layout ).toBe( atlas.streets.construction.paving.layouts[ 0 ] );
		expect( view.frame ).toBe( atlas.streets.construction.paving.frames[ 0 ] );
		expect( view.covers ).toEqual( atlas.volumetric.ground.slice( 0, 3 ) );
		view.covers.forEach( ( cover, i ) => expect( cover ).toBe( atlas.volumetric.ground[ i ] ) );
		expect( Object.isFrozen( views ) && Object.isFrozen( view ) && Object.isFrozen( view.covers ) ).toBe( true );
		expect( JSON.stringify( atlas ) ).toBe( before );

	} );

	it( 'returns no inferred ownership for a legacy cover or an unused band', () => {

		expect( GroundBuilder.regionFootprints( { volumetric: { ground: [ { polygon: rectangle( 0 ) } ] } }, 'furnishing' ) ).toEqual( [] );
		expect( GroundBuilder.regionFootprints( fixture(), 'curb' ) ).toEqual( [] );

	} );

	it( 'fails closed on incomplete references and invalid query input', () => {

		const mutations = [
			atlas => { delete atlas.streets.construction.paving; },
			atlas => { atlas.streets.construction.paving.version = '2.0.0'; },
			atlas => { atlas.streets.construction.paving.layouts.push( atlas.streets.construction.paving.layouts[ 0 ] ); },
			atlas => { atlas.streets.construction.paving.regions[ 0 ].layoutId = 'absent'; },
			atlas => { atlas.streets.construction.paving.regions[ 0 ].frameId = 'absent'; },
			atlas => { atlas.volumetric.ground[ 0 ].construction.regionId = 'absent'; }
		];
		for ( const mutate of mutations ) {

			const atlas = fixture();
			mutate( atlas );
			expect( () => GroundBuilder.regionFootprints( atlas, 'furnishing' ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );

		}
		expect( () => GroundBuilder.regionFootprints( fixture(), 'road' ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );

	} );

} );
