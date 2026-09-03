import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader, mapConcurrent } from './BuildingsLoader.js';

const factory = {
	resolver: { resolve: () => null },
	build: () => new THREE.MeshBasicMaterial(),
	variant: () => new THREE.MeshBasicMaterial()
};

describe( 'building entrance availability', () => {

	it( 'keeps a shell-only door fixed in the visible shell and out of interactions', async () => {

		const city = await load( false );

		expect( city.doors ).toEqual( [] );
		expect( city.group.getObjectByName( 'shell:cyberpunk/door/mid' ) ).toBeTruthy();
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 3 );

	} );

	it( 'extracts and hinges only a door whose parcel has an interior', async () => {

		const city = await load( true );

		expect( city.doors ).toHaveLength( 1 );
		expect( city.doors[ 0 ].parcelId ).toBe( 'p0' );
		expect( city.doors[ 0 ].surfaceDepth ).toBe( 0.09 );
		expect( city.group.getObjectByName( 'door:p0:0' ) ).toBeTruthy();

	} );

	it( 'keeps decorative facade relief out of the structural collider', async () => {

		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			scene.add(
				mesh( 'mergedwall', 'cyberpunk/concrete/mid', 0 ),
				mesh( 'mergedframes', 'cyberpunk/window-frame/mid', 2 ),
				mesh( 'mergedlight', 'cyberpunk/light-fixture/mid', 4 )
			);

			return { scene };

		} };
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] );
		const city = await new BuildingsLoader( factory, loader ).load( buildings );

		expect( city.group.children ).toHaveLength( 3 );
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 3 );

	} );

	it( 'keeps an authored strip separate from ordinary fixtures with the same material key', async () => {

		const fixtureKey = 'cyberpunk/light-fixture/high_rich';
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			const lamp = mesh( 'mergedlamp', fixtureKey, 0 );
			const strip = mesh( 'mergedstrip', fixtureKey, 2 );
			strip.material.userData.materialVariant = 'strip';
			scene.add( lamp, strip );

			return { scene };

		} };
		const variant = vi.fn( ( key, options ) => Object.assign(
			new THREE.MeshBasicMaterial(), { userData: { key, variantId: options.variantId } }
		) );
		const fixtureFactory = {
			resolver: { resolve: () => ( { variants: [
				{ id: 'lamp', class: 'pattern' }, { id: 'strip', class: 'exact' }
			] } ) },
			build: factory.build,
			variant
		};
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] );
		const city = await new BuildingsLoader( fixtureFactory, loader ).load( buildings );

		expect( city.group.getObjectByName( `shell:${fixtureKey}#lamp` ).material.userData.variantId ).toBe( 'lamp' );
		expect( city.group.getObjectByName( `shell:${fixtureKey}#strip` ).material.userData.variantId ).toBe( 'strip' );
		expect( variant ).toHaveBeenCalledWith( fixtureKey, expect.objectContaining( { variantId: 'strip' } ) );

	} );

} );

describe( 'shell loading budget', () => {

	it( 'limits concurrent GLB parse work and preserves input order', async () => {

		let active = 0;
		let peak = 0;
		const values = Array.from( { length: 40 }, ( _, index ) => index );
		const result = await mapConcurrent( values, 8, async ( value ) => {

			active ++;
			peak = Math.max( peak, active );
			await new Promise( ( resolve ) => setTimeout( resolve, value % 3 ) );
			active --;
			return value * 2;

		} );

		expect( peak ).toBe( 8 );
		expect( result ).toEqual( values.map( ( value ) => value * 2 ) );

	} );

} );

async function load( hasInterior ) {

	const loader = { loadAsync: async () => {

		const scene = new THREE.Group();
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 1, 0, 0, 2, 0, 0, 1, 2, 0 ], 3 ) );
		const material = new THREE.MeshBasicMaterial();
		material.name = 'cyberpunk/door/mid';
		const leaf = new THREE.Mesh( geometry, material );
		leaf.name = 'doorentranceleaf0';
		scene.add( leaf );

		return { scene };

	} };
	const blueprint = {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ {
			index: 0, elevation: 0,
			outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ],
			openings: [ {
				kind: 'door', edge: 0, offset: 1, width: 1, sill: 0, height: 2,
				door: { frameDepth: 0.09 }
			} ]
		} ]
	};
	const buildings = new Map( [ [ 'p0', { parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior } ] ] );

	return new BuildingsLoader( factory, loader ).load( buildings );

}

function mesh( name, key, x ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ x, 0, 0, x + 1, 0, 0, x, 1, 0 ], 3 ) );
	const material = new THREE.MeshBasicMaterial();
	material.name = key;
	const result = new THREE.Mesh( geometry, material );
	result.name = name;

	return result;

}

function boxBlueprint() {

	return {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ { index: 0, elevation: 0, outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ], openings: [] } ]
	};

}
