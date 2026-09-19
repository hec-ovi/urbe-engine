import { floorPlacements } from './InteriorLayouts.js';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { planAssembly } from '../../../../exterior/src/index.ts';
import { generate } from '../../../../interior/src/index.ts';
import { cityGltfLoader } from '../data/CityGltfLoader.js';
import { InteriorModules } from './InteriorModules.js';
import { InteriorProps } from './InteriorProps.js';
import { InteriorStream } from './InteriorStream.js';
import { partsOf } from './InteriorBoxes.js';
import { Elevators } from './Elevators.js';
import { FillChannel } from './kit/FillChannel.js';
import { RoomLights } from '../light/RoomLights.js';
import { Warmup } from '../look/Warmup.js';

const MODULE_DIR = new URL( '../../../../interior/out/modules', import.meta.url ).pathname;
const PROP_DIR = new URL( '../props/fixtures', import.meta.url ).pathname;

const factory = {
	build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ),
	variant: ( key, tweaks ) => new THREE.MeshStandardMaterial( { name: `${key}#${tweaks.variantId ?? ''}`, emissiveIntensity: tweaks.emissiveLevel } )
};
/** The pool every room surface is lit through. */
const roomLights = new RoomLights( factory, { roomSlots: 2, roomSpots: 2, roomStrips: 0 } );

async function bytesOf( url ) {

	const file = await readFile( url );

	return file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength );

}

/** The published module set, read exactly as the runtime reads it from a world. */
async function openModules() {

	const catalog = JSON.parse( await readFile( `${MODULE_DIR}/modules.json`, 'utf8' ) );
	const reads = [];
	const modules = new InteriorModules( { catalog, baseUrl: MODULE_DIR, factory, roomLights, readBinary: async ( url ) => {

		reads.push( url );

		return bytesOf( url );

	} } );

	await modules.ready;

	return { catalog, modules, reads };

}

/** One furnished building, generated from an assembled kit blueprint. */
let generated = null;
async function building() {

	if ( generated ) return generated;

	const width = 24, depth = 32, floors = 5;
	const lot = [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ];
	const { blueprint } = planAssembly( {
		family: 'mirror-frame', buildingId: 'p1', seed: 'kit', theme: 'cyberpunk',
		parcel: { footprint: lot, accessPoint: [ width / 2, 0 ], maxHeight: 200 },
		building: { type: 'offices', tier: 'mid', floors }
	} );

	generated = await generate( {
		seed: 'kit', building: { id: 'p1', type: 'offices', tier: 'mid' }, blueprint, materialTheme: 'cyberpunk'
	} );

	return generated;

}

/** Every furniture id the layouts name, against one real static model. */
function propCatalog( interior ) {

	const ids = new Set( Object.values( interior.layouts ).flatMap( ( layout ) => layout.placements ).filter( ( one ) => one.prop ).map( ( one ) => one.prop ) );

	// Width, depth and height, all different, the way the real catalog measures.
	return { assets: [ ...ids ].map( ( id ) => ( { id, modelUri: 'static.glb', dimensionsMeters: [ 0.8, 0.5, 1.2 ] } ) ) };

}

function interiorProps( interior ) {

	return new InteriorProps( {
		catalog: propCatalog( interior ),
		baseUrl: PROP_DIR,
		roomLights,
		loadAsset: async ( url ) => cityGltfLoader().parseAsync( await bytesOf( url ), '' )
	} );

}

/** A stream with one furnished building registered 3 m away. */
async function stream( { props = true, elevators = null, mutate = null } = {} ) {

	const { modules } = await openModules();
	const source = structuredClone( await building() );

	mutate?.( source );

	const model = new InteriorStream( {
		modules, props: props ? interiorProps( source ) : null,
		roomLights: { releaseRooms: () => {} }, haze: null, elevators
	} );

	model.solid = new Map();
	model.dropped = [];
	model.onColliderBand = ( id, solid ) => model.solid.set( id, solid );
	model.onDropBand = ( id ) => { model.solid.delete( id ); model.dropped.push( id ); };
	model.register(
		new Map( [ [ 'p1', { hasInterior: true, interior: source } ] ] ),
		new Map( [ [ 'p1', { x: 12, z: 16 } ] ] )
	);

	return model;

}

const tick = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

/** Frames until the stream asks for nothing more at these feet. */
async function settle( model, feet ) {

	for ( ;; ) {

		model.update( feet );

		if ( ! model.loading ) return;

		while ( model.loading ) await tick();

	}

}

const metres = ( value ) => Number( value.toFixed( 6 ) );
/** One copy's fill as its draw's channel holds it, beside a vector at that precision. */
const texelOf = ( mesh, slot ) => [ ...FillChannel.of( mesh ).texture.image.data.subarray( slot * 4, slot * 4 + 4 ) ];
const float32 = ( vector ) => [ ...new Float32Array( vector.toArray() ) ];
const feetOn = ( floor ) => ( { x: 12, y: floor * 4.5 + 0.1, z: 16 } );
const bandOf = ( model, floor ) => model.live.get( 'p1' ).bands.find( ( band ) => band.floor === floor );
const propCopies = ( model ) => [ ...model.props.props.values() ].reduce( ( total, one ) => total + one.draw.count, 0 );

describe( 'the city draws every furnished floor from shared modules', () => {

	it( 'loads each module once, keeps one draw per surface, and cuts every part out of the published bounds', async () => {

		const { catalog, modules, reads } = await openModules();

		expect( reads ).toHaveLength( catalog.modules.length );
		expect( new Set( reads ).size ).toBe( catalog.modules.length );

		// Seventeen modules wearing twenty-seven material surfaces between them,
		// over six distinct slots: one batch each, for the whole city.
		const slots = new Set( catalog.modules.flatMap( ( module ) => module.materialSlots ) );
		expect( modules.batchCount ).toBe( slots.size );
		expect( modules.batchCount ).toBe( 6 );

		for ( const record of catalog.modules ) {

			const published = modules.boundsOf( record.id );
			const low = published.origin.map( ( value ) => - value );
			const high = published.size.map( ( value, axis ) => value - published.origin[ axis ] );

			for ( const part of partsOf( record.id, published ) ) for ( let axis = 0; axis < 3; axis ++ ) {

				expect( part[ axis ], `${record.id} axis ${axis}` ).toBeGreaterThanOrEqual( low[ axis ] - 1e-6 );
				expect( part[ axis + 3 ], `${record.id} axis ${axis}` ).toBeLessThanOrEqual( high[ axis ] + 1e-6 );

			}

		}

		// Thirteen treads, one cuboid each, each one rising over the last.
		const treads = partsOf( 'stair-flight-13', modules.boundsOf( 'stair-flight-13' ) );
		expect( treads ).toHaveLength( 13 );
		expect( treads.map( ( part ) => part[ 4 ] ) ).toEqual( [ ...treads ].map( ( part ) => part[ 4 ] ).sort( ( a, b ) => a - b ) );

		// A door frame is two jambs and a lintel: the doorway between them is a
		// real hole, not a sealed bounding box.
		const frame = partsOf( 'door-frame', modules.boundsOf( 'door-frame' ) );
		expect( frame ).toHaveLength( 3 );
		expect( frame.some( ( part ) => part[ 0 ] <= 0 && part[ 3 ] >= 0 && part[ 1 ] < 1 ) ).toBe( false );

		// A re-authored module carries its parts: a wider, taller doorway keeps
		// its jambs on the published edges and its lintel under the published top.
		const wider = partsOf( 'door-frame', { size: [ 2.36, 3, 0.14 ], origin: [ 1.18, 0, 0.07 ] } );
		expect( wider.map( ( part ) => [ metres( part[ 0 ] ), metres( part[ 3 ] ) ] ) )
			.toEqual( [ [ - 1.18, - 1.1 ], [ 1.1, 1.18 ], [ - 1.18, 1.18 ] ] );
		expect( wider[ 2 ][ 1 ] ).toBeCloseTo( 2.92, 6 );

		// A flight's treads divide the published depth, whatever it is.
		const deeper = partsOf( 'stair-flight-13', { size: [ 1.45, 3.19, 5.2 ], origin: [ 0, - 0.02, 0 ] } );
		expect( deeper[ 1 ][ 2 ] ).toBeCloseTo( 0.4, 6 );

		// And a module too small for its own members is a desync, not a collider.
		expect( () => partsOf( 'door-frame', { size: [ 0.1, 2.58, 0.14 ], origin: [ 0.05, 0, 0.07 ] } ) )
			.toThrow( /E_INTERIOR_MODULE/ );

		modules.dispose();

	} );

	it( 'compiles once per batch, which is what the loading counter counts', async () => {

		const { modules } = await openModules();
		const compiled = [];
		const warmup = new Warmup(
			{ compileAsync: async ( object ) => { compiled.push( object ); } },
			new THREE.Scene(), new THREE.PerspectiveCamera()
		);
		const progress = [];

		await warmup.warmAll( modules.group, { onProgress: ( done, total ) => progress.push( [ done, total ] ) } );

		// Twenty-seven module surfaces, six compiles.
		expect( compiled ).toHaveLength( modules.batchCount );
		expect( progress.at( - 1 ) ).toEqual( [ modules.batchCount, modules.batchCount ] );
		modules.dispose();

	} );

	it( 'lights every module slot and furniture part through the room pool, the strip\'s diffuser at the lamp level', async () => {

		const { modules } = await openModules();

		for ( const batch of modules.batches.batches.values() ) expect( batch.material.lightsNode ).toBe( roomLights.pool.lightsNode );
		const diffuser = modules.batches.batches.get( 'cyberpunk/light-fixture/mid' ).material;
		expect( diffuser.emissiveIntensity ).toBe( 180 );
		expect( diffuser.name ).toBe( 'cyberpunk/light-fixture/mid#strip|room' );
		expect( modules.batches.batches.get( 'cyberpunk/plaster/mid' ).material.emissiveIntensity ).toBe( 1 );

		const entry = { id: 'file-shelf', modelUri: 'static.glb', dimensionsMeters: [ 0.8, 0.5, 1.2 ] };
		const props = new InteriorProps( {
			catalog: { assets: [ entry ] }, baseUrl: PROP_DIR, roomLights,
			loadAsset: async ( url ) => cityGltfLoader().parseAsync( await bytesOf( url ), '' )
		} );
		await props.prepare( [ entry.id ] );
		const draw = props.props.get( entry.id ).draw;
		for ( const mesh of draw.meshes ) expect( mesh.material.lightsNode ).toBe( roomLights.pool.lightsNode );

		// A copy carries its room's fill, and keeps it when the draw compacts.
		const fill = new THREE.Vector4( 1.5, 1.2, 0.9, 0.3 );
		const first = props.admit( entry.id, new THREE.Matrix4(), new THREE.Vector4( 0, 0, 0, 0 ) );
		const second = props.admit( entry.id, new THREE.Matrix4(), fill );
		props.release( first );
		expect( texelOf( draw.meshes[ 0 ], second.slot ) ).toEqual( float32( fill ) );

		props.dispose();
		modules.dispose();

	} );

	it( 'appends a floor\'s modules and furniture at its own elevation, and takes exactly those back on a drop', async () => {

		const model = await stream();

		await settle( model, feetOn( 1 ) );

		const band = bandOf( model, 1 );
		const copies = floorPlacements( band.record ).length;
		expect( band.handles ).toHaveLength( copies - liftCopies( floorPlacements( band.record ) ) );
		expect( model.modules.copyCount + propCopies( model ) ).toBe( band.handles.length + neighbours( model, 1 ) );

		// A copy stands at its placement plus the floor's own elevation, and
		// carries the fill of the room it stands in into the batch it is drawn by.
		const wall = floorPlacements( band.record ).find( ( one ) => one.module === 'wall-segment' );
		const copy = copyOf( model, band, wall );
		const at = new THREE.Vector3().setFromMatrixPosition( copy.matrix );
		expect( at.y ).toBeCloseTo( wall.position[ 1 ] + 4.5, 6 );
		const room = band.rooms.find( ( one ) => one.roomId === wall.room );
		expect( copy.fill ).toBe( room.fill );
		expect( room.fill.x ).toBeGreaterThan( 0 );
		const { batch, geometryId } = model.modules.batches.entries.get( 'wall-segment' )[ 0 ];
		const instance = band.handles[ band.copies.indexOf( copy ) ].handle.instances[ 0 ];
		expect( batch.mesh.getMatrixAt( instance, new THREE.Matrix4() ).elements[ 13 ] ).toBeCloseTo( at.y, 6 );
		expect( texelOf( batch.mesh, instance ) ).toEqual( float32( room.fill ) );
		expect( geometryId ).toBeGreaterThanOrEqual( 0 );

		// Every middle floor reads the one middle table and differs only by height.
		const middles = [ 1, 2, 3 ].map( ( floor ) => bandOf( model, floor ).record );
		expect( middles.map( ( record ) => record.layout ) ).toEqual( [ 'middle', 'middle', 'middle' ] );
		expect( new Set( middles.map( ( record ) => record.placements ) ).size ).toBe( 1 );
		expect( middles.map( ( record ) => record.elevation ) ).toEqual( [ 4.5, 9, 13.5 ] );

		// Walking far enough away drops the building and every copy with it.
		model.update( { x: 400, y: 0, z: 400 } );
		expect( model.modules.copyCount ).toBe( 0 );
		expect( propCopies( model ) ).toBe( 0 );
		expect( model.rooms ).toHaveLength( 0 );

	} );

	it( 'stands furniture at the height its catalog publishes, without swapping depth for height', async () => {

		// The catalog measures [width, depth, height]; the mesh is Y up.
		const entry = { id: 'file-shelf', modelUri: 'file-shelf.glb', dimensionsMeters: [ 1.0627, 0.4354, 1.9 ] };
		const props = new InteriorProps( {
			catalog: { assets: [ entry ] }, baseUrl: '/furniture', roomLights,
			loadAsset: async () => ( { scene: boxScene( 1.0627, 1.9, 0.4354 ) } )
		} );

		await props.prepare( [ entry.id ] );

		const bounds = new THREE.Box3();
		for ( const { geometry } of props.surfacesOf( entry.id ) ) {

			geometry.computeBoundingBox();
			bounds.union( geometry.boundingBox );

		}

		const size = bounds.getSize( new THREE.Vector3() );
		expect( size.y ).toBeCloseTo( 1.9, 4 );
		expect( size.x ).toBeCloseTo( 1.0627, 4 );
		expect( size.z ).toBeCloseTo( 0.4354, 4 );
		// Standing on the floor, centred on its own footprint: the frame a
		// placement's position and rotation assume.
		expect( bounds.min.y ).toBeCloseTo( 0, 6 );
		expect( bounds.getCenter( new THREE.Vector3() ).x ).toBeCloseTo( 0, 6 );

		props.dispose();

	} );

	it( 'refuses a layout naming a module the catalog does not publish', async () => {

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const model = await stream( {
			props: false,
			mutate: ( source ) => { source.layouts.ground.placements[ 0 ].module = 'garden-taper/bay'; }
		} );

		try {

			await settle( model, feetOn( 0 ) );

			expect( bandOf( model, 0 ).state ).toBe( 'failed' );
			expect( warn ).toHaveBeenCalledWith( expect.stringMatching( /E_INTERIOR_MODULE: p1:0 places garden-taper\/bay/ ) );
			expect( model.modules.copyCount ).toBeGreaterThan( 0 );

		} finally { warn.mockRestore(); }

	} );

	it( 'keeps the floors around the player standing, solid as cuboids, and nothing else', async () => {

		const elevators = new Elevators( factory );
		const model = await stream( { props: false, elevators } );

		await settle( model, feetOn( 0 ) );

		expect( [ ...model.solid.keys() ].sort() ).toEqual( [ 'p1:0', 'p1:1' ] );
		expect( bandOf( model, 0 ).group.visible ).toBe( true );
		expect( bandOf( model, 4 ).handles ).toBe( null );

		// Every solid part is a cuboid, never a trimesh.
		const { boxes } = model.solid.get( 'p1:0' );
		expect( boxes.length ).toBeGreaterThan( 0 );
		expect( boxes.every( ( box ) => box.center.length === 3 && box.halfExtents.length === 3
			&& box.center.every( Number.isFinite ) && box.halfExtents.every( ( half ) => half > 0 )
			&& Number.isFinite( box.rotationY ) ) ).toBe( true );

		// The lift is registered from the floor records, so its car and the
		// landing the player stands at exist as soon as the floor does.
		expect( elevators.shafts ).toHaveLength( 1 );
		expect( elevators.panels( new THREE.Vector3( 11.3, 1, 17.95 ), 2 ) ).toHaveLength( 1 );

		await settle( model, feetOn( 3 ) );

		expect( [ ...model.solid.keys() ].sort() ).toEqual( [ 'p1:2', 'p1:3', 'p1:4' ] );
		expect( model.dropped ).toContain( 'p1:0' );
		// Floor 1 is two away: out of the draws, its table still read.
		expect( bandOf( model, 1 ).handles ).toBe( null );
		expect( bandOf( model, 1 ).state ).toBe( 'loaded' );
		// Floor 0 is further: nothing of it is referenced any more.
		expect( bandOf( model, 0 ).state ).toBe( 'empty' );

		model.dispose();
		expect( model.liveInteriors ).toBe( 0 );

	} );

} );

/** One Y-up furniture mesh of a known size, as a loaded model arrives. */
function boxScene( width, height, depth ) {

	const scene = new THREE.Group();
	scene.add( new THREE.Mesh( new THREE.BoxGeometry( width, height, depth ), new THREE.MeshStandardMaterial() ) );

	return scene;

}

/** The car and its landing leaves, which the lift draws itself. */
function liftCopies( placements ) {

	return placements.filter( ( one ) => one.module === 'lift-car' || one.module === 'lift-doors' ).length;

}

/** Copies the neighbouring floors of `floor` put in the same draws. */
function neighbours( model, floor ) {

	return model.live.get( 'p1' ).bands
		.filter( ( band ) => band.floor !== floor && band.handles )
		.reduce( ( total, band ) => total + band.handles.length, 0 );

}

function copyOf( model, band, placement ) {

	const at = floorPlacements( band.record ).indexOf( placement );
	const before = floorPlacements( band.record ).slice( 0, at ).filter( ( one ) => one.module === 'lift-car' || one.module === 'lift-doors' ).length;

	return band.copies[ at - before ];

}
