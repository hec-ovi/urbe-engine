import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SpawnVisibility, hiddenWalkEntry } from './SpawnVisibility.js';
import { WalkRoutes } from './WalkRoutes.js';

describe( 'unseen world entries', () => {

	it( 'keeps near, visible and edge-of-view bodies out of the admission set', () => {

		const camera = new THREE.PerspectiveCamera( 72, 16 / 9, 0.2, 900 );
		const visibility = new SpawnVisibility( camera );
		visibility.update();
		expect( visibility.hidden( { x: 0, y: 0, z: - 30 } ) ).toBe( false );
		expect( visibility.hidden( { x: 0, y: 0, z: 3 } ) ).toBe( false );
		expect( visibility.hidden( { x: 0, y: 0, z: 30 } ) ).toBe( true );
		expect( visibility.hidden( { x: 40, y: 0, z: - 30 } ) ).toBe( false );

	} );

	it( 'uses live fog and requires the entire silhouette to be occluded', () => {

		const camera = new THREE.PerspectiveCamera( 72, 1, 0.2, 900 );
		let fogged = false;
		const visibility = new SpawnVisibility( camera, { fog: { visibilityAt: () => fogged ? 0.01 : 1 }, occluded: ( eye, at ) => at.x < 0 } );
		visibility.update();
		expect( visibility.hidden( { x: 0, y: 0, z: - 90 } ) ).toBe( false );
		fogged = true;
		expect( visibility.hidden( { x: 0, y: 0, z: - 90 } ) ).toBe( true );
		fogged = false;
		expect( visibility.hidden( { x: - 10, y: 0, z: - 90 } ) ).toBe( true );

	} );

	it( 'finds a deterministic upstream entry across graph edges or defers', () => {

		const routes = new WalkRoutes( { walk: {
			nodes: [ 'a', 'b', 'c' ].map( id => ( { id } ) ),
			edges: [ { id: 'ab', from: 'a', to: 'b', path3: [ [ 0, 0, 0 ], [ 20, 0, 0 ] ] },
				{ id: 'bc', from: 'b', to: 'c', path3: [ [ 20, 0, 0 ], [ 40, 0, 0 ] ] } ]
		} } );
		const entry = { edge: routes.edges.get( 'bc' ), distance: 10, direction: 1, agent: { crowdId: 'fixed' } };
		const found = hiddenWalkEntry( routes, entry, at => at.x < 15 );
		expect( found ).toMatchObject( { edge: { id: 'ab' }, direction: 1, distance: 14, agent: entry.agent } );
		expect( hiddenWalkEntry( routes, entry, () => false ) ).toBeNull();

	} );

} );
