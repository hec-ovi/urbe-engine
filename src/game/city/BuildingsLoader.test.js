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

	it( 'keeps authored two-sided surfaces visible from both sides after city merging', async () => {

		const curtainKey = 'cyberpunk/curtain/high_rich';
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			const outsideOnly = mesh( 'mergedcurtainfront', curtainKey, 0 );
			const bothSides = mesh( 'mergedcurtaindouble', curtainKey, 2 );
			outsideOnly.material.userData.materialVariant = 'fabric#flat';
			bothSides.material.userData.materialVariant = 'fabric#flat';
			bothSides.material.side = THREE.DoubleSide;
			scene.add( outsideOnly, bothSides );

			return { scene };

		} };
		const variant = vi.fn( ( key, options ) => Object.assign(
			new THREE.MeshBasicMaterial( { side: options.side } ), { userData: { key, variantId: options.variantId } }
		) );
		const curtainFactory = {
			resolver: { resolve: () => ( { variants: [ { id: 'fabric#flat', class: 'exact' } ] } ) },
			build: factory.build,
			variant
		};
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] );
		const city = await new BuildingsLoader( curtainFactory, loader ).load( buildings );

		expect( city.group.getObjectByName( `shell:${curtainKey}#fabric#flat` ).material.side ).toBe( THREE.FrontSide );
		expect( city.group.getObjectByName( `shell:${curtainKey}#fabric#flat|side=double` ).material.side ).toBe( THREE.DoubleSide );
		expect( variant ).toHaveBeenCalledWith( curtainKey, {
			variantId: 'fabric#flat', side: THREE.DoubleSide
		} );

	} );

	it( 'preserves continuous strip geometry at representative authored door sizes', async () => {

		const fixtureKey = 'cyberpunk/light-fixture/high_rich';
		const dimensions = [ [ 3, 3.5 ], [ 4, 4.5 ], [ 5, 4 ] ];
		const scenes = new Map( dimensions.map( ( [ width, height ], index ) => {

			const scene = new THREE.Group();
			stripFrame( scene, fixtureKey, index * 10, width, height );
			return [ `/p${index}.glb`, scene ];

		} ) );
		const loader = { loadAsync: async ( url ) => ( { scene: scenes.get( url ) } ) };
		const variant = vi.fn( ( key, options ) => Object.assign(
			new THREE.MeshBasicMaterial(), { userData: { key, variantId: options.variantId } }
		) );
		const fixtureFactory = {
			resolver: { resolve: () => ( { variants: [ { id: 'strip', class: 'exact' } ] } ) },
			build: factory.build,
			variant
		};
		const buildings = new Map( dimensions.map( ( _, index ) => [ `p${index}`, {
			parcelId: `p${index}`, blueprint: boxBlueprint( `p${index}` ), shellUrl: `/p${index}.glb`, hasInterior: false
		} ] ) );
		const city = await new BuildingsLoader( fixtureFactory, loader ).load( buildings );
		const strip = city.group.getObjectByName( `shell:${fixtureKey}#strip` );
		const positions = strip.geometry.getAttribute( 'position' );

		expect( positions.count ).toBe( dimensions.length * 18 );
		for ( const [ index, [ width, height ] ] of dimensions.entries() ) {

			const start = index * 18;
			const points = Array.from( { length: 18 }, ( _, point ) => [
				positions.getX( start + point ), positions.getY( start + point )
			] );
			expect( Math.min( ...points.map( ( point ) => point[ 0 ] ) ) ).toBeCloseTo( index * 10 );
			expect( Math.max( ...points.map( ( point ) => point[ 0 ] ) ) ).toBeCloseTo( index * 10 + width );
			expect( Math.min( ...points.map( ( point ) => point[ 1 ] ) ) ).toBeCloseTo( 0 );
			expect( Math.max( ...points.map( ( point ) => point[ 1 ] ) ) ).toBeCloseTo( height );

		}
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

function stripFrame( scene, key, x, width, height ) {

	for ( const [ index, bounds ] of [
		[ x, 0, x + 0.12, height ],
		[ x + width - 0.12, 0, x + width, height ],
		[ x, height - 0.12, x + width, height ]
	].entries() ) {

		const [ left, bottom, right, top ] = bounds;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			left, bottom, 0, right, bottom, 0, left, top, 0,
			right, bottom, 0, right, top, 0, left, top, 0
		], 3 ) );
		const material = new THREE.MeshBasicMaterial();
		material.name = key;
		material.userData.materialVariant = 'strip';
		const surface = new THREE.Mesh( geometry, material );
		surface.name = `mergedstrip${index}`;
		scene.add( surface );

	}

}

function boxBlueprint( buildingId = 'p0' ) {

	return {
		buildingId,
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ { index: 0, elevation: 0, outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ], openings: [] } ]
	};

}
