import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three/webgpu';
import { facadeScreen, screenFill, screensShown } from './FacadeScreens.js';
import { readShell } from './kit/KitGeometry.js';
import { BuildingsLoader } from './BuildingsLoader.js';
import { Neon } from './Neon.js';

const FIELD = { key: 'cyberpunk/ivory-panel/mid', variantId: 'fixings' };
const AD = 'cyberpunk/ad-screen/mid';
const PORTRAIT = 'cyberpunk/corporate-screen/mid';
const FRAME = 'cyberpunk/paired-frame-metal/mid';

/** A surface as GLTFLoader hands it over: its material named by key, the variant authored on it. */
function surface( geometry, key, variant ) {

	const material = new MeshBasicMaterial();
	material.name = key;
	if ( variant ) material.userData.materialVariant = variant;

	return new Mesh( geometry, material );

}

/**
 * One facade the way Exterior publishes its screens: a panel wall facing +Z,
 * an ad plate standing off it, a portrait set into its panel field, and a
 * corporate portrait in a node of its own with its frame.
 */
function facade() {

	const scene = new Group();
	const wall = surface( new PlaneGeometry( 12, 12 ).translate( 6, 6, 0 ), FIELD.key, FIELD.variantId );
	const plate = surface( new BoxGeometry( 4, 2.25, 0.1 ).translate( 3, 9, 0.3 ), AD, 'noir-cyan' );
	const setIn = surface( new PlaneGeometry( 2.6, 5.2 ).translate( 9, 5, 0.1 ), PORTRAIT, 'native' );
	const assembly = new Group();
	// GLTFLoader strips the `:` from the node's name and keeps the authored one.
	assembly.name = 'corporateportrait-screen';
	assembly.userData.name = 'corporate:portrait-screen';
	assembly.add( surface( new PlaneGeometry( 2, 4 ).translate( 2, 4, 1 ), PORTRAIT, 'native' ),
		surface( new BoxGeometry( 2.4, 4.4, 0.28 ).translate( 2, 4, 0.9 ), FRAME, 'surface' ) );
	scene.add( wall, plate, setIn, assembly );

	return { scene, wall, plate, setIn, assembly };

}

function blueprint() {

	return {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 12, 0 ], [ 12, 12 ], [ 0, 12 ] ], height: 12 },
		floors: [ { index: 0, elevation: 0, height: 12, outline: [ [ 0, 0 ], [ 12, 0 ], [ 12, 12 ], [ 0, 12 ] ], openings: [] } ],
		signage: [], lights: [],
		facade: { materialPlan: { field: FIELD } }
	};

}

function materialFactory( pictureScreens ) {

	const made = new Map();
	const material = ( key, variantId ) => {

		const id = `${key}#${variantId}`;
		if ( ! made.has( id ) ) made.set( id, Object.assign( new MeshBasicMaterial(), { name: id } ) );
		return made.get( id );

	};

	return {
		resolver: { resolve: () => null },
		build: material,
		variant: ( key, options = {} ) => material( key, options.variantId ),
		...( pictureScreens === undefined ? {} : { pictureScreens } )
	};

}

describe( 'the facades\' picture screens', () => {

	it( 'stand only where the run asks for them', () => {

		expect( screensShown( {} ) ).toBe( false );
		expect( screensShown( null ) ).toBe( false );
		expect( screensShown( { pictureScreens: 'on' } ) ).toBe( false );
		expect( screensShown( { pictureScreens: true } ) ).toBe( true );

	} );

	it( 'drop a plate hung off the wall and a screen standing in its own frame, and fill one set into the facade', () => {

		const { wall, plate, setIn, assembly } = facade();
		const [ picture, frame ] = assembly.children;

		expect( facadeScreen( wall, FIELD.key ) ).toBe( 'keep' );
		expect( facadeScreen( plate, AD ) ).toBe( 'drop' );
		expect( facadeScreen( plate, 'cyberpunk/ad-screen-tall/high_rich' ) ).toBe( 'drop' );
		expect( facadeScreen( setIn, PORTRAIT ) ).toBe( 'fill' );
		// The portrait's frame and posts go with it, whatever they wear.
		expect( facadeScreen( picture, PORTRAIT ) ).toBe( 'drop' );
		expect( facadeScreen( frame, FRAME ) ).toBe( 'drop' );
		// A vending machine's screen is not a facade's picture.
		expect( facadeScreen( wall, 'cyberpunk/e1-screen/high_rich' ) ).toBe( 'keep' );

		for ( const [ node, key ] of [ [ plate, AD ], [ setIn, PORTRAIT ], [ picture, PORTRAIT ], [ frame, FRAME ] ] ) {

			expect( facadeScreen( node, key, true ) ).toBe( 'keep' );

		}

	} );

	it( 'fill a set-in screen with the facade\'s field material, in metres along the face and down it', () => {

		const { scene, setIn } = facade();
		scene.updateMatrixWorld( true );
		const fill = screenFill( setIn, blueprint() );

		expect( [ fill.key, fill.variantId ] ).toEqual( [ FIELD.key, FIELD.variantId ] );
		const uv = fill.geometry.getAttribute( 'uv' );
		const us = Array.from( { length: uv.count }, ( _, i ) => uv.getX( i ) );
		const vs = Array.from( { length: uv.count }, ( _, i ) => uv.getY( i ) );
		// The quad spans 7.7 to 10.3 m along the face and 2.4 to 7.6 m up it.
		expect( Math.min( ...us ) ).toBeCloseTo( 7.7 );
		expect( Math.max( ...us ) ).toBeCloseTo( 10.3 );
		expect( Math.min( ...vs ) ).toBeCloseTo( - 7.6 );
		expect( Math.max( ...vs ) ).toBeCloseTo( - 2.4 );

		// A face turned the other way still reads left to right from outside.
		const back = surface( new PlaneGeometry( 2, 2 ).rotateY( Math.PI ).translate( 4, 1, - 3 ), PORTRAIT );
		back.updateMatrixWorld( true );
		const turned = screenFill( back, blueprint() ).geometry;
		const position = turned.getAttribute( 'position' );
		const left = [ ...Array( position.count ).keys() ].reduce( ( best, i ) => position.getX( i ) > position.getX( best ) ? i : best, 0 );
		expect( turned.getAttribute( 'uv' ).getX( left ) ).toBeCloseTo( - 5 );

		// A blueprint naming no field material leaves the face out.
		expect( screenFill( setIn, { floors: [] } ) ).toBeNull();

	} );

	it( 'leave a plan with a whole facade and no picture, unless the run asks for them', async () => {

		const read = async ( factory ) => {

			const shell = await readShell( facade().scene, factory, blueprint(), { step: async () => {} } );

			return new Map( shell.surfaces.map( ( { bucket, geometry } ) => [ bucket, geometry.getAttribute( 'position' ).count ] ) );

		};

		// The wall and the set-in screen's face in one batch, the plate and the
		// portrait with its frame gone.
		expect( [ ...( await read( materialFactory() ) ) ] ).toEqual( [ [ `${FIELD.key}#${FIELD.variantId}`, 8 ] ] );

		const shown = await read( materialFactory( true ) );
		expect( [ ...shown.keys() ].sort() ).toEqual( [
			`${AD}#noir-cyan`, `${PORTRAIT}#native`, `${FIELD.key}#${FIELD.variantId}`, `${FRAME}#surface`
		].sort() );
		expect( shown.get( `${FIELD.key}#${FIELD.variantId}` ) ).toBe( 4 );

	} );

	it( 'leave a generated shell the same way', async () => {

		const load = async ( factory ) => {

			const loader = { loadAsync: async () => ( { scene: facade().scene } ) };

			return new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p0', {
				parcelId: 'p0', blueprint: blueprint(), shellUrl: '/p0.glb', hasInterior: false
			} ] ] ) );

		};
		const draws = ( city ) => city.group.children.filter( ( child ) => child.isMesh )
			.map( ( child ) => [ child.name, child.geometry.getAttribute( 'position' ).count ] );

		const city = await load( materialFactory() );
		expect( draws( city ) ).toEqual( [ [ `shell:${FIELD.key}#${FIELD.variantId}`, 12 ] ] );
		// The wall stands solid; the panel over the frame is no barrier of its own.
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 6 );

		const shown = draws( await load( materialFactory( true ) ) ).map( ( [ name ] ) => name ).sort();
		expect( shown ).toEqual( [
			`shell:${AD}#noir-cyan`, `shell:${PORTRAIT}#native`, `shell:${FIELD.key}#${FIELD.variantId}`, `shell:${FRAME}#surface`
		].sort() );

	} );

	it( 'hang no ad of the city\'s own on a street facade, nor its light, unless the run asks for them', () => {

		const ids = [ 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8' ];
		const atlas = { parcels: ids.map( ( id ) => ( { id, type: 'restaurant', tier: 'mid', access: { point: [ 6, - 2 ] } } ) ) };
		const buildings = new Map( ids.map( ( id ) => [ id, { blueprint: { ...blueprint(), buildingId: id }, hasInterior: false } ] ) );
		const hung = ( factory ) => new Neon( atlas, buildings, factory ).build();

		const bare = hung( materialFactory() );
		expect( bare.group.children ).toEqual( [] );
		expect( bare.glows ).toEqual( [] );

		const shown = hung( materialFactory( true ) );
		expect( shown.group.children.map( ( mesh ) => mesh.name ) ).toEqual( [ `neon:${AD}` ] );
		expect( shown.glows.length ).toBeGreaterThan( 0 );

	} );

} );
