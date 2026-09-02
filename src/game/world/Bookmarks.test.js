import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Bookmarks } from './Bookmarks.js';

describe( 'world bookmarks', () => {

	it( 'stands street and canyon shots at the selected walk node elevation', () => {

		const bookmarks = new Bookmarks( {
			fixtures: [
				{ position: new THREE.Vector3( 0, 20, 0 ), lumens: 1000 },
				{ position: new THREE.Vector3( 30, 20, 0 ), lumens: 1000 }
			],
			rooms: [],
			networks: { walk: { nodes: [ { id: 'high', x: 1, y: 8, z: 0, kind: 'corner' } ] } }
		} );

		expect( bookmarks.pose( 'street' ).point.y ).toBeCloseTo( 8.17 );
		expect( bookmarks.pose( 'canyon' ).point.y ).toBeCloseTo( 8.17 );

	} );

} );
