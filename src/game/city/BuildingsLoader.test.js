import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { Interactor } from '../player/Interactor.js';
import { releaseShell } from './streaming/ReleaseShell.js';

const factory = {
	resolver: { resolve: () => null },
	build: () => new THREE.MeshBasicMaterial(),
	variant: () => new THREE.MeshBasicMaterial()
};

describe( 'building shells', () => {

	it( 'keeps exterior window scenery and hides it only while the camera is inside its real interior', async () => {

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
					mesh( 'mergedcladding', 'cyberpunk/paired-cladding/mid', 5 ), localLeaf( 'doorentranceleaf0', [ 1, 0, 0 ] ) );
				return { scene };

			} };
			const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', {
				parcelId: 'p0', blueprint: entranceBlueprint(), shellUrl: '/p0.glb', hasInterior
			} ] ] ) );

			// An open building swings its door but keeps the exterior window image.
			expect( Boolean( city.group.getObjectByName( 'shell:cyberpunk/door/mid' ) ) ).toBe( ! hasInterior );
			for ( const kind of [ 'curtain', 'window-glass-opaque', 'paired-room-lit' ] ) {

				const surface = city.group.getObjectByName( `shell:cyberpunk/${kind}/mid` );
				expect( surface ).toBeTruthy();
				if ( ! hasInterior ) continue;
				const camera = new THREE.PerspectiveCamera();
				for ( const [ position, visible ] of [ [ [ - 2, 1.7, 2 ], true ], [ [ 2, 1.7, 2 ], false ], [ [ - 2, 1.7, 2 ], true ] ] ) {

					camera.position.set( ...position );
					camera.updateMatrixWorld();
					surface.material.maskNode.update( { camera } );
					expect( surface.material.maskNode.value ).toBe( visible );

				}
				expect( surface.castShadow ).toBe( false );

			}

			// Scenery never collides; glass, cladding and a fixed leaf do.
			expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( hasInterior ? 6 : 9 );

			if ( ! hasInterior ) {

				expect( city.doors ).toEqual( [] );
				expect( city.entrances ).toEqual( [] );
				continue;

			}

			expect( city.doors ).toHaveLength( 1 );
			expect( city.entrances ).toEqual( city.doors );
			expect( city.doors[ 0 ].parcelId ).toBe( 'p0' );
			expect( city.doors[ 0 ].surfaceDepth ).toBe( 0.09 );
			expect( city.group.getObjectByName( 'door:p0:entrance:0' ) ).toBeTruthy();

		}

	} );

	it( 'keeps a furnished shell\'s storey plate as the band its own floors leave open', async () => {

		const plate = () => {

			const geometry = new THREE.BufferGeometry();
			// One quad over a 10 by 10 m floor at 4 m, as two triangles.
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
				0, 4, 0, 10, 4, 0, 10, 4, 10,
				0, 4, 0, 10, 4, 10, 0, 4, 10
			], 3 ) );
			const material = new THREE.MeshBasicMaterial();
			material.name = 'cyberpunk/floor-slab/rich';
			const node = new THREE.Mesh( geometry, material );
			// GLTFLoader strips the reserved characters from `floor:1/slab`.
			node.name = 'floor1slab';

			return node;

		};
		const loader = { loadAsync: async () => ( { scene: new THREE.Group().add( plate() ) } ) };
		const interior = {
			building: { floors: [ { index: 1, layout: 'crown', elevation: 4 } ] },
			layouts: { crown: { floor: {
				height: 4,
				rooms: [ { id: 'r0', polygon: [ [ 2, 2 ], [ 8, 2 ], [ 8, 8 ], [ 2, 8 ] ] } ],
				core: { stairs: [ { id: 'a', rect: { x: 3, z: 3, w: 2, d: 3 } } ] }
			}, placements: [] } }
		};
		const entry = { parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb' };

		const closed = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', { ...entry, hasInterior: false } ] ] ) );
		const open = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', { ...entry, hasInterior: true, interior } ] ] ) );

		// A closed shell keeps the whole plate, drawn and solid.
		expect( closed.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 6 );

		// A furnished one keeps the band alone: the rectangle its own floor
		// draws is gone from the drawing and from the collider, which is what
		// opens the stair well the module floor publishes a cutout for.
		const solid = open.shellColliders.get( 'p0' ).getAttribute( 'position' );
		expect( solid.count ).toBeGreaterThan( 0 );

		for ( let i = 0; i < solid.count; i ++ ) {

			const inside = solid.getX( i ) > 2.01 && solid.getX( i ) < 7.99
				&& solid.getZ( i ) > 2.01 && solid.getZ( i ) < 7.99;
			expect( inside ).toBe( false );

		}

		releaseShell( closed );
		releaseShell( open );

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

	it( 'keeps family walls solid while structural-looking scenery and imported trees remain decorative', async () => {

		const kinds = [ 'corporate-panel', 'ivory-panel', 'facade-chrome', 'exterior-cast-concrete', 'garden-concrete', 'paired-window-black' ];
		const blueprint = boxBlueprint();
		blueprint.modelInstances = [ { kind: 'ornamental-tree', position: [ 40, 0, 40 ], size: [ 2, 4, 2 ] } ];
		const loader = { loadAsync: async url => {

			const scene = new THREE.Group();
			if ( url.startsWith( '/models/' ) ) {

				const material = new THREE.MeshStandardMaterial( { name: 'cyberpunk/corporate-panel/mid' } );
				scene.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 4, 2 ).translate( 0, 2, 0 ), material ) );

			} else {

				kinds.forEach( ( kind, index ) => scene.add( mesh( `merged${kind}`, `cyberpunk/${kind}/mid`, index * 2 ) ) );
				const scenery = new THREE.Group();
				scenery.name = 'scenery1';
				scenery.add( mesh( 'room', 'cyberpunk/corporate-panel/mid', 30 ) );
				scene.add( scenery );

			}
			return { scene };

		} };
		const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior: false
		} ] ] ) );
		const collider = city.shellColliders.get( 'p0' );
		expect( collider.attributes.position.count ).toBe( kinds.length * 3 );
		const actual = Array.from( collider.attributes.position.array );
		const expected = kinds.flatMap( ( _, index ) => [ index * 2, 0, 0, index * 2 + 1, 0, 0, index * 2, 1, 0 ] );
		expect( actual ).toEqual( expected );
		expect( city.group.getObjectByName( 'shell:cyberpunk/corporate-panel/mid' ).geometry.attributes.position.count ).toBe( 6 );
		expect( city.group.getObjectByName( 'building-model:pine:0' ) ).toBeTruthy();
		releaseShell( city );

	} );

	it( 'draws every mesh node a shell publishes, whatever the producer named it', async () => {

		const key = 'cyberpunk/corporate-panel/mid';
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			// One surface named the way a merged GLB names its own, and one a
			// family signs itself with, named after the family.
			scene.add( mesh( 'mergedpanel', key, 0 ), mesh( 'corporate40services', key, 2 ) );
			return { scene };

		} };
		const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint: boxBlueprint(), shellUrl: '/p0.glb', hasInterior: false
		} ] ] ) );

		// Both stand, in the one draw their material owns.
		expect( city.triangles ).toBe( 2 );
		expect( city.group.getObjectByName( `shell:${key}` ).geometry.getAttribute( 'position' ).count ).toBe( 6 );

		// And a wall is a wall whatever it is called, so both hold the player up.
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 6 );

	} );

	it( 'takes the surface variant authored on a mesh over the one its building published', async () => {

		const key = 'cyberpunk/concrete/rich';
		const blueprint = boxBlueprint();
		blueprint.materialVariants = { [ key ]: 'panel' };
		const loader = { loadAsync: async () => {

			const scene = new THREE.Group();
			const wall = mesh( 'mergedwall', key, 0 );
			const border = mesh( 'mergedborder', key, 2 );
			const doubleSided = mesh( 'mergedcurtain', key, 4 );
			border.material.userData.materialVariant = 'plain';
			doubleSided.material.userData.materialVariant = 'plain';
			doubleSided.material.side = THREE.DoubleSide;
			scene.add( wall, border, doubleSided );
			return { scene };

		} };
		const build = vi.fn( () => new THREE.MeshBasicMaterial() );
		const variant = vi.fn( ( name, options ) => new THREE.MeshBasicMaterial( { side: options.side } ) );
		const materialFactory = { build, variant,
			resolver: { resolve: () => ( { variants: [ { id: 'plain', class: 'pattern' }, { id: 'panel', class: 'pattern' } ] } ) }
		};
		const city = await new BuildingsLoader( materialFactory, loader ).load( new Map( [ [ 'p0', {
			parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior: false
		} ] ] ) );
		expect( city.group.getObjectByName( `shell:${key}#panel` ) ).toBeTruthy();
		expect( city.group.getObjectByName( `shell:${key}#plain` ) ).toBeTruthy();
		expect( build ).toHaveBeenCalledWith( key, 'panel' );
		expect( build ).toHaveBeenCalledWith( key, 'plain' );

		// An authored two-sided surface stays visible from both sides after merging.
		expect( city.group.getObjectByName( `shell:${key}#plain|side=double` ).material.side ).toBe( THREE.DoubleSide );
		expect( variant ).toHaveBeenCalledWith( key, { variantId: 'plain', side: THREE.DoubleSide } );

	} );

} );

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

function entranceBlueprint() {

	return {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ {
			index: 0, elevation: 0, height: 3,
			outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ],
			openings: [ {
				id: 'entrance', kind: 'door', doorRole: 'main', edge: 0, offset: 1, width: 1, sill: 0, height: 2,
				door: { frameDepth: 0.09 }
			} ]
		} ]
	};

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
