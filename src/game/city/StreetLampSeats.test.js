import { expect, it } from 'vitest';
import { StreetLamps } from './StreetLamps.js';

const factory = { build: () => null, variant: () => null };
const rect = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];

it( 'seats every pole on a complete furnishing base and refuses an incomplete one', () => {

	const atlas = fixture();
	const { posts } = new StreetLamps( atlas, factory ).build();

	// Each side's own furnishing band, including a base across an internal finish seam.
	expect( posts ).toHaveLength( 5 );
	expect( posts.map( post => post.z ) ).toEqual( [ - 4.25, 5.15, - 4.25, 5.15, - 4.25 ] );

	// Without the outer cover the right band is no longer a complete base, so
	// nothing is seated there rather than standing in walking space.
	const incomplete = fixture();
	incomplete.volumetric.ground = incomplete.volumetric.ground.filter( cover => cover.id !== 'right-outer' );
	const remaining = new StreetLamps( incomplete, factory ).build().posts;
	expect( remaining ).toHaveLength( 2 );
	expect( remaining.every( post => post.z > 0 ) ).toBe( true );

} );

function fixture() {

	const left = { curb: 0.15, border: 0.6, furnishing: 1.8, walking: 5.5, frontage: 0.45 };
	const right = { curb: 0.15, border: 0.35, furnishing: 0.5, walking: 1.6, frontage: 0.4 };
	const region = ( id, side ) => ( {
		id, owner: { kind: 'run', runId: 'run', edgeId: 'edge', side, station: [ 0, 100 ] },
		band: 'furnishing', layoutId: 'layout', frameId: 'frame'
	} );
	const cover = ( id, regionId, polygon, role ) => ( {
		id, surface: 'sidewalk', polygon, bottom: 0, top: 0.15,
		construction: { regionId, part: { kind: 'solid', role } }
	} );
	return {
		parcels: [],
		streets: {
			nodes: [], planting: [], highwayStructures: [],
			edges: [ {
				id: 'edge', class: 'street', width: 7, sidewalk: { left: 8.5, right: 3 }, path: [ [ 0, 0 ], [ 100, 0 ] ],
				crossSection: { runId: 'run', profileId: 'road', lanes: [
					{ direction: 'backward', width: 3.5, offset: 1.75 },
					{ direction: 'forward', width: 3.5, offset: - 1.75 }
				], shoulders: { left: 0, right: 0 },
					sidewalks: { left: { profileId: 'wide', bands: left }, right: { profileId: 'narrow', bands: right } } }
			} ],
			construction: { version: '1.0.0', runs: [], paving: { version: '1.0.0',
				layouts: [ { id: 'layout', familyId: 'maintained', modules: [ { id: 'module', pitch: [ 2, 2 ], joint: [ 0.012, 0.012 ] } ],
					bands: Object.fromEntries( Object.keys( left ).map( band => [ band, { moduleId: 'module', borderWidth: 0 } ] ) ) } ],
				frames: [ { id: 'frame', origin: [ 0, 0 ], u: [ 1, 0 ], gridStep: 0.001 } ],
				regions: [ region( 'left', 'left' ), region( 'right', 'right' ) ]
			} }
		},
		volumetric: {
			buildings: [],
			ground: [
				{ surface: 'roadway', polygon: rect( 0, - 3.5, 100, 3.5 ) },
				cover( 'left-body', 'left', rect( 0, 4.25, 100, 6.05 ), 'body' ),
				cover( 'right-inner', 'right', rect( 0, - 4.25, 100, - 4 ), 'body' ),
				cover( 'right-outer', 'right', rect( 0, - 4.5, 100, - 4.25 ), 'border' )
			]
		}
	};

}
