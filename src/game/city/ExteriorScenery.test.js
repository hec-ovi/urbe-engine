import { describe, expect, it } from 'vitest';
import { Group, MeshStandardMaterial, MeshStandardNodeMaterial, PerspectiveCamera, Texture, Vector3 } from 'three/webgpu';
import { renderGroup, uniform, vec3 } from 'three/tsl';
import { ExteriorScenery } from './ExteriorScenery.js';
import { ScenicSurface } from './ScenicSurface.js';

const rectangle = ( x, z, width, depth ) => [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];
const floor = ( outline, elevation = 0, height = 4 ) => ( { outline, elevation, height } );
const outside = ( scenery, x, y, z ) => scenery.isOutside( new Vector3( x, y, z ) );

describe( 'ExteriorScenery', () => {

	it( 'updates every render from the camera world position when entering and leaving its building', () => {

		const scenery = new ExteriorScenery( { floors: [ floor( rectangle( 10, 20, 8, 8 ) ) ] } );
		const camera = new PerspectiveCamera();
		const parent = new Group();
		parent.position.set( 10, 0, 20 );
		parent.add( camera );
		expect( scenery.visible.value ).toBe( true );
		expect( scenery.visible.updateType ).toBe( 'render' );
		expect( scenery.visible.groupNode ).toBe( renderGroup );
		for ( const [ position, visible ] of [
			[ [ - 1, 1.7, 2 ], true ], [ [ 2, 1.7, 2 ], false ],
			[ [ 10, 1.7, 2 ], true ], [ [ 2, 1.7, 2 ], false ], [ [ 2, 4.1, 2 ], true ]
		] ) {

			camera.position.set( ...position );
			scenery.visible.update( { camera } );
			expect( scenery.visible.value ).toBe( visible );

		}

	} );

	it( 'uses concave floor outlines and includes their walls regardless of winding', () => {

		const outline = [ [ 0, 0 ], [ 8, 0 ], [ 8, 3 ], [ 3, 3 ], [ 3, 8 ], [ 0, 8 ] ];
		for ( const ring of [ outline, [ ...outline ].reverse() ] ) {

			const scenery = new ExteriorScenery( { floors: [ floor( ring ) ] } );
			expect( outside( scenery, 1, 2, 6 ) ).toBe( false );
			expect( outside( scenery, 6, 2, 1 ) ).toBe( false );
			expect( outside( scenery, 6, 2, 6 ) ).toBe( true );
			expect( outside( scenery, 8, 2, 2 ) ).toBe( false );
			expect( outside( scenery, 8.01, 2, 2 ) ).toBe( true );

		}

	} );

	it( 'keeps setbacks and neighboring buildings visible at the camera height', () => {

		const scenery = new ExteriorScenery( { bounds: { footprint: rectangle( 10, 20, 10, 10 ), height: 12 }, floors: [
			floor( rectangle( 10, 20, 10, 10 ) ), floor( rectangle( 12, 22, 6, 6 ), 4 ),
			floor( rectangle( 14, 24, 4, 4 ), 8 )
		] } );
		const neighbor = new ExteriorScenery( { floors: [ floor( rectangle( 30, 20, 10, 10 ), 0, 12 ) ] } );
		expect( outside( scenery, 11, 2, 21 ) ).toBe( false );
		expect( outside( scenery, 11, 6, 21 ) ).toBe( true );
		expect( outside( scenery, 13, 6, 23 ) ).toBe( false );
		expect( outside( scenery, 13, 10, 23 ) ).toBe( true );
		expect( outside( scenery, 15, 10, 25 ) ).toBe( false );
		expect( outside( neighbor, 15, 10, 25 ) ).toBe( true );
		expect( outside( scenery, 35, 2, 25 ) ).toBe( true );
		expect( outside( neighbor, 35, 2, 25 ) ).toBe( false );
		expect( outside( scenery, 15, 12.1, 25 ) ).toBe( true );
		expect( outside( scenery, 15, - 0.1, 25 ) ).toBe( true );

	} );

	it( 'falls back to bounds only when there are no floors', () => {

		for ( const floors of [ undefined, [] ] ) {

			const scenery = new ExteriorScenery( { floors, bounds: { footprint: rectangle( - 10, - 20, 4, 4 ), height: 9 } } );
			expect( outside( scenery, - 8, 4, - 18 ) ).toBe( false );
			expect( outside( scenery, 0, 4, 0 ) ).toBe( true );
			expect( outside( scenery, - 8, 9.1, - 18 ) ).toBe( true );

		}

	} );

	it( 'clones catalog shading and combines its existing mask without mutating the catalog', () => {

		const scenery = new ExteriorScenery( { floors: [ floor( rectangle( 0, 0, 4, 4 ) ) ] } );
		const catalog = new MeshStandardNodeMaterial( { map: new Texture(), emissiveMap: new Texture(), emissive: '#ffaa66', emissiveIntensity: 3 } );
		catalog.emissiveNode = vec3( 2, 3, 4 );
		catalog.maskNode = uniform( true );
		catalog.userData.catalogKey = 'room';
		const owned = scenery.material( catalog );
		expect( owned ).not.toBe( catalog );
		expect( owned.map ).toBe( catalog.map );
		expect( owned.emissiveMap ).toBe( catalog.emissiveMap );
		expect( owned.emissive ).toEqual( catalog.emissive );
		expect( owned.emissiveIntensity ).toBe( 3 );
		expect( owned.emissiveNode ).toBe( catalog.emissiveNode );
		const nodes = [];
		owned.maskNode.traverse( node => nodes.push( node ) );
		expect( nodes.some( node => node.op === '&&' ) ).toBe( true );
		expect( nodes ).toContain( catalog.maskNode );
		expect( nodes ).toContain( scenery.visible );
		expect( catalog.maskNode.value ).toBe( true );
		expect( catalog.userData ).toEqual( { catalogKey: 'room' } );
		expect( owned.userData ).toEqual( { catalogKey: 'room', ownedScenicMaterial: true } );
		const fresh = new MeshStandardNodeMaterial();
		expect( scenery.attach( fresh ) ).toBe( fresh );
		expect( fresh.maskNode ).toBe( scenery.visible );
		expect( fresh.userData.ownedScenicMaterial ).toBe( true );

	} );

	it( 'retains baked room emission when cloning the actual basic scenic material', () => {

		const catalog = new MeshStandardNodeMaterial( { map: new Texture() } );
		const scenic = ScenicSurface.material( catalog );
		const scenery = new ExteriorScenery( { floors: [ floor( rectangle( 0, 0, 4, 4 ) ) ] } );
		const owned = scenery.material( scenic );
		expect( owned ).not.toBe( scenic );
		expect( owned.isMeshBasicNodeMaterial ).toBe( true );
		expect( owned.emissiveNode ).toBe( scenic.emissiveNode );
		expect( owned.emissiveNode ).toBeTruthy();
		expect( owned.colorNode ).toBe( scenic.colorNode );
		expect( owned.map ).toBe( scenic.map );
		expect( owned.maskNode ).toBe( scenery.visible );
		expect( scenic.maskNode ).toBeNull();

	} );

	it( 'preserves a mask attached to a classic material before adding exterior visibility', () => {

		const catalog = new MeshStandardMaterial();
		const priorMask = uniform( true );
		catalog.maskNode = priorMask;
		const scenery = new ExteriorScenery( { floors: [ floor( rectangle( 0, 0, 4, 4 ) ) ] } );
		const owned = scenery.material( catalog );
		const nodes = [];
		owned.maskNode.traverse( node => nodes.push( node ) );
		expect( owned ).not.toBe( catalog );
		expect( owned.isMeshStandardMaterial ).toBe( true );
		expect( nodes ).toContain( priorMask );
		expect( nodes ).toContain( scenery.visible );
		expect( nodes.some( node => node.op === '&&' ) ).toBe( true );
		expect( catalog.maskNode ).toBe( priorMask );
		expect( catalog.userData.ownedScenicMaterial ).toBeUndefined();

	} );

} );
