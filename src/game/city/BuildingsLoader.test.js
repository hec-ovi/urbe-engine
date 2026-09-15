import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { Interactor } from '../player/Interactor.js';

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
		expect( city.entrances ).toEqual( city.doors );
		expect( city.doors[ 0 ].parcelId ).toBe( 'p0' );
		expect( city.doors[ 0 ].surfaceDepth ).toBe( 0.09 );
		expect( city.group.getObjectByName( 'door:p0:entrance:0' ) ).toBeTruthy();

	} );

	it( 'owns every entrance, balcony and roof leaf independently by its published id', async () => {

		const blueprint = movingDoorBlueprint();
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			const openings = [
				[ 'doorentranceleaf0', [ 1, 0, 0 ] ],
				[ 'doorentranceleaf0_1', [ 1, 0, 0 ], 'cyberpunk/door-glass/mid' ],
				[ 'doorentrancesecondary0leaf0', [ 5, 0, 0 ] ],
				[ 'balconybd111leaf0', [ 10, 3, 2 ] ],
				[ 'doorroof-bulkheadleaf0', [ 3.5, 6, 8.85 ] ]
			];
			for ( const [ name, hinge, key ] of openings ) scene.add( localLeaf( name, hinge, key ) );
			return { scene };

		} };
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior: true
		} ] ] );
		const city = await new BuildingsLoader( factory, loader ).load( buildings );

		expect( city.doors.map( ( door ) => door.id ) ).toEqual( [
			'entrance', 'entrance:secondary:0', 'bd:1:1:1', 'roof-bulkhead'
		] );
		expect( city.entrances.map( ( door ) => door.id ) ).toEqual( [ 'entrance' ] );
		expect( city.doors.map( ( door ) => door.pivots.length ) ).toEqual( [ 1, 1, 1, 1 ] );
		expect( city.doors[ 0 ].pivots[ 0 ].pivot.children ).toHaveLength( 2 );

		const interactor = new Interactor( {
			crowd: { within: () => [] }, doors: city.doors, sim: {},
			controller: {
				body: { feet: new THREE.Vector3( 100, 100, 100 ) },
				eye: new THREE.Vector3( 100, 100, 100 ), look: new THREE.Vector3( 0, 0, - 1 )
			},
			quests: { candidates: () => [] }
		} );
		city.doors[ 2 ].wanted = 1;
		interactor.update( 0.1, null );

		expect( city.doors[ 2 ].pivots[ 0 ].pivot.rotation.y ).not.toBe( 0 );
		expect( city.doors.filter( ( _, index ) => index !== 2 )
			.every( ( door ) => door.pivots[ 0 ].pivot.rotation.y === 0 ) ).toBe( true );

	} );

	it( 'keeps named balcony leaves visible and solid on a shell-only parcel', async () => {

		const scene = new THREE.Group();
		scene.add( localLeaf( 'balconybd111leaf0', [ 10, 3, 2 ] ) );
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: movingDoorBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] );
		const city = await new BuildingsLoader( factory, {
			loadAsync: async () => ( { scene } )
		} ).load( buildings );

		expect( city.doors ).toEqual( [] );
		expect( city.entrances ).toEqual( [] );
		expect( city.group.getObjectByName( 'shell:cyberpunk/door/mid' ) ).toBeTruthy();
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 3 );

	} );

	it( 'keeps decorative facade relief out of the structural collider', async () => {

		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			scene.add(
				mesh( 'mergedwall', 'cyberpunk/concrete/mid', 0 ),
				mesh( 'mergedmonolith', 'cyberpunk/concrete-monolith/mid', 10 ),
				mesh( 'mergedlargepanel', 'cyberpunk/concrete-large-panel/rich', 12 ),
				mesh( 'mergedopaque', 'cyberpunk/window-glass-opaque/rich', 6 ),
				mesh( 'mergedoffice', 'cyberpunk/window-glass-office/rich', 8 ),
				mesh( 'mergedframes', 'cyberpunk/window-frame/mid', 2 ),
				mesh( 'mergedlight', 'cyberpunk/light-fixture/mid', 4 )
			);

			return { scene };

		} };
		const buildings = new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] );
		const city = await new BuildingsLoader( factory, loader ).load( buildings );

		expect( city.group.children ).toHaveLength( 7 );
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 15 );

	} );

	it( 'keeps shell scenery on closed shells and excludes it from real interiors and collision', async () => {

		for ( const hasInterior of [ false, true ] ) {

			const loader = { loadAsync: async () => {

				const scene = new THREE.Group();
				const privacy = new THREE.Group();
				privacy.name = 'ground-privacyw0';
				privacy.add( mesh( 'covering', 'cyberpunk/curtain/mid', 1 ), mesh( 'backing', 'cyberpunk/window-glass-opaque/mid', 2 ) );
				const scenery = new THREE.Group();
				scenery.name = 'scenery1';
				scenery.add( mesh( 'room', 'cyberpunk/paired-room-lit/mid', 4 ) );
				scene.add( mesh( 'mergedglass', 'cyberpunk/window-glass/mid', 0 ), privacy, scenery,
					mesh( 'mergedcladding', 'cyberpunk/paired-cladding/mid', 5 ) );
				return { scene };

			} };
			const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', {
				parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior
			} ] ] ) );
			expect( Boolean( city.group.getObjectByName( 'shell:cyberpunk/curtain/mid' ) ) ).toBe( ! hasInterior );
			expect( Boolean( city.group.getObjectByName( 'shell:cyberpunk/window-glass-opaque/mid' ) ) ).toBe( ! hasInterior );
			expect( Boolean( city.group.getObjectByName( 'shell:cyberpunk/paired-room-lit/mid' ) ) ).toBe( ! hasInterior );
			expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 6 );

		}

	} );

	it( 'honors blueprint material choices while keeping per-surface variants more specific', async () => {

		const key = 'cyberpunk/concrete/rich';
		const blueprint = boxBlueprint();
		blueprint.materialVariants = { [ key ]: 'panel' };
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			const wall = mesh( 'mergedwall', key, 0 );
			const border = mesh( 'mergedborder', key, 2 );
			border.material.userData.materialVariant = 'plain';
			scene.add( wall, border );
			return { scene };

		} };
		const build = vi.fn( () => new THREE.MeshBasicMaterial() );
		const materialFactory = { ...factory, build, patternVariants: 1,
			resolver: { resolve: () => ( { variants: [ { id: 'plain', class: 'pattern' }, { id: 'panel', class: 'pattern' } ] } ) }
		};
		const city = await new BuildingsLoader( materialFactory, loader ).load( new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior: false
		} ] ] ) );
		expect( city.group.getObjectByName( `shell:${key}#panel` ) ).toBeTruthy();
		expect( city.group.getObjectByName( `shell:${key}#plain` ) ).toBeTruthy();
		expect( build ).toHaveBeenCalledWith( key, 'panel' );
		expect( build ).toHaveBeenCalledWith( key, 'plain' );

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

} );

describe( 'shell loading budget', () => {

	it( 'limits concurrent GLB parse work and preserves input order', async () => {

		let active = 0;
		let peak = 0;
		const ids = Array.from( { length: 16 }, ( _, index ) => `p${index}` );
		const buildings = new Map( ids.map( parcelId => [ parcelId, {
			parcelId, blueprint: boxBlueprint( parcelId ), shellUrl: `${parcelId}.glb`, hasInterior: false
		} ] ) );
		const loader = { loadAsync: async () => {

			active ++;
			peak = Math.max( peak, active );
			await new Promise( resolve => setTimeout( resolve, 0 ) );
			active --;
			return { scene: new THREE.Group() };

		} };
		const result = await new BuildingsLoader( factory, loader ).load( buildings );
		expect( peak ).toBeLessThanOrEqual( 8 );
		expect( peak ).toBeGreaterThan( 1 );
		expect( [ ...result.centers.keys() ] ).toEqual( ids );

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
				id: 'entrance', kind: 'door', doorRole: 'main', edge: 0, offset: 1, width: 1, sill: 0, height: 2,
				door: { frameDepth: 0.09 }
			} ]
		} ]
	};
	const buildings = new Map( [ [ 'p0', { parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior } ] ] );

	return new BuildingsLoader( factory, loader ).load( buildings );

}

function localLeaf( name, [ x, y, z ], key = 'cyberpunk/door/mid' ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0, 0, 2, 0 ], 3 ) );
	const material = new THREE.MeshBasicMaterial();
	material.name = key;
	const leaf = new THREE.Mesh( geometry, material );
	leaf.name = name;
	leaf.position.set( x, y, z );
	return leaf;

}

function movingDoorBlueprint() {

	return {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ] },
		floors: [
			{
				index: 0, elevation: 0,
				outline: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ],
				openings: [
					{ id: 'entrance', kind: 'door', doorRole: 'main', edge: 0, offset: 1, width: 1, sill: 0, height: 2 },
					{ id: 'entrance:secondary:0', kind: 'door', doorRole: 'secondary', edge: 0, offset: 5, width: 1, sill: 0, height: 2 }
				]
			},
			{
				index: 1, elevation: 3,
				outline: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ],
				openings: [
					{ id: 'bd:1:1:1', kind: 'balconyDoor', edge: 1, offset: 2, width: 1, sill: 0, height: 2 }
				]
			}
		],
		roof: {
			elevation: 6,
			bulkhead: {
				center: [ 3, 5 ], axis: [ 1, 0 ], doorNormal: [ 0, 1 ],
				width: 8, depth: 8, doorWidth: 1, doorHeight: 2.1
			}
		}
	};

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

function boxBlueprint( buildingId = 'p0' ) {

	return {
		buildingId,
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ { index: 0, elevation: 0, outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ], openings: [] } ]
	};

}
