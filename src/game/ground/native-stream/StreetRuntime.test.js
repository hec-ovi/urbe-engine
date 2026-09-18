import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Box3, ClampToEdgeWrapping, Matrix4, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import { NativeStreetMaterials } from '../materials/NativeStreetMaterials.js';
import { NativeStreetStream } from './NativeStreetStream.js';
import { placementMatrix } from './StreetCells.js';

// The real saved bundle: 131 kit pieces and 525 placements over nine cells.
const BUNDLE = fileURLToPath( new URL( '../../../../../streets/out/units-tiny-0.7.0/', import.meta.url ) );
const MANIFEST = JSON.parse( readFileSync( `${BUNDLE}manifest.json`, 'utf8' ) );
const PRIMITIVES = MANIFEST.kit.pieces.reduce( ( total, piece ) => total + piece.surfaces.length, 0 );
const SURFACES = new Set( MANIFEST.kit.pieces.flatMap( piece => piece.surfaces ) );

function bundle( manifest = structuredClone( MANIFEST ) ) {
	const files = new Map( manifest.kit.pieces.map( piece => [ piece.id, `${BUNDLE}streets/${piece.file}` ] ) );
	const readPiece = vi.fn( async id => {
		const bytes = readFileSync( files.get( id ) );
		return bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	} );
	const materials = new NativeStreetMaterials( manifest.materials.binding, ( id, path, definition ) => ( {
		texture: Object.assign( new Texture(), { name: path, flipY: true,
			colorSpace: definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace,
			wrapS: definition.wrap[ 0 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping,
			wrapT: definition.wrap[ 1 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping } ),
		ready: Promise.resolve()
	} ) );
	return { manifest, source: { manifest, readPiece }, materials, readPiece };
}

/** The placements of one cell, as the table groups them. */
function cellOf( manifest, key ) {
	return manifest.placements.placements.filter( placement => placement.cell.join( ':' ) === key );
}

/** Every placement standing right now, in the order the stream admitted it. */
function standing( stream, manifest ) {
	return [ ...stream.resident.keys() ].flatMap( key => cellOf( manifest, key ) );
}

/** The piece box one copy draws, in piece metres, straight out of its batches. */
function batchedBox( handle ) {
	const box = new Box3();
	for ( const { batch, geometryId } of handle.parts ) box.union( batch.mesh.getBoundingBoxAt( geometryId, new Box3() ) );
	return box;
}

/** The matrix one copy draws with, straight out of its batch. */
function batchedMatrix( handle ) {
	return handle.parts[ 0 ].batch.mesh.getMatrixAt( handle.instances[ 0 ], new Matrix4() );
}

/** Every copy standing right now, paired with the placement that appended it. */
function drawn( stream, manifest ) {
	return [ ...stream.resident ].flatMap( ( [ key, cell ] ) => cellOf( manifest, key ).map( ( placement, index ) => [ placement, cell.handles[ index ] ] ) );
}

/** How much ground each cuboid top covers, in square metres. */
function coverage( boxes ) {
	const area = new Map();
	for ( const box of boxes ) {
		const top = Number( ( box.center[ 1 ] + box.halfExtents[ 1 ] ).toFixed( 3 ) );
		area.set( top, ( area.get( top ) ?? 0 ) + 4 * box.halfExtents[ 0 ] * box.halfExtents[ 2 ] );
	}
	return area;
}

describe( 'saved street kit runtime', () => {

	it( 'loads every kit piece once and owns one batch per native surface', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( world.readPiece ).toHaveBeenCalledTimes( MANIFEST.kit.pieces.length );
		// 131 pieces wearing 1,178 primitives between them, over 28 surfaces.
		expect( PRIMITIVES ).toBe( 1178 );
		expect( stream.pieces.batchCount ).toBe( SURFACES.size );
		const batches = [];
		stream.group.traverse( node => { if ( node.isBatchedMesh ) batches.push( node ); } );
		expect( batches ).toHaveLength( SURFACES.size );
		// Per copy culling answers for the batch, so the object test is off.
		expect( batches.every( node => node.perObjectFrustumCulled && ! node.frustumCulled ) ).toBe( true );
		expect( batches.filter( node => node.sortObjects ).every( node => node.material.transparent ) ).toBe( true );
		// Paint and scans lie flat on the road; only bodies cast.
		expect( new Set( batches.filter( node => node.castShadow ).map( node => node.material.userData.streetNativeSurface ) ) )
			.toEqual( new Set( [ 'asphalt', 'basalt', 'curb', 'darkMetal', 'district-curb-blue', 'district-gutter-blue', 'district-hex',
				'district-junction-blue', 'district-panel-blue', 'district-panel-dark', 'gutter', 'joint', 'metal', 'ochre', 'ordinary',
				'plastic', 'green', 'tread' ] ) );
		await stream.update( { x: 264, z: 200 } );
		expect( world.readPiece ).toHaveBeenCalledTimes( MANIFEST.kit.pieces.length );
		expect( stream.stats ).toMatchObject( { indexed: 525, pending: false } );
		stream.dispose();
		expect( () => stream.update( { x: 0, z: 0 } ) ).toThrow( /disposed/ );
	} );

	it( 'appends a cell\'s copies to the shared batches and takes them out again', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 16 } );
		const copies = standing( stream, world.manifest );
		expect( stream.resident.size ).toBeGreaterThan( 0 );
		expect( copies.length ).toBeGreaterThan( 0 );
		expect( stream.pieces.copyCount ).toBe( copies.length );

		// A copy is one instance per primitive of its piece, in the batch its
		// surface wears, and the surfaces of one piece stay together.
		const pieces = new Map( MANIFEST.kit.pieces.map( piece => [ piece.id, piece ] ) );
		for ( const [ placement, handle ] of drawn( stream, world.manifest ) ) {
			const piece = pieces.get( placement.piece );
			expect( handle.parts ).toHaveLength( piece.surfaces.length );
			expect( new Set( handle.parts.map( part => part.batch.name ) ) )
				.toEqual( new Set( piece.surfaces.map( surface => `street-pieces:${surface}` ) ) );
			expect( handle.instances.every( Number.isInteger ) ).toBe( true );
		}

		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( stream.pieces.copyCount ).toBe( standing( stream, world.manifest ).length );
		await stream.update( { x: 9000, z: 9000 } );
		expect( stream.resident.size ).toBe( 0 );
		expect( stream.pieces.copyCount ).toBe( 0 );
		expect( stream.pieces.batchCount ).toBe( SURFACES.size );
		stream.dispose();
	} );

	it( 'grows a batch for a cell that wants more copies than it holds, keeping the copies already standing', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 16 } );
		const before = drawn( stream, world.manifest ).map( ( [ placement, handle ] ) => [ placement, batchedMatrix( handle ) ] );
		const batch = stream.pieces.batches.batches.get( 'joint' );
		expect( before.length ).toBeGreaterThan( 0 );

		const capacity = batch.capacity;
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( batch.capacity ).toBeGreaterThan( capacity );
		expect( batch.count ).toBeLessThanOrEqual( batch.capacity );

		// Every copy that was already standing still draws where it stood.
		const after = new Map( drawn( stream, world.manifest ).map( ( [ placement, handle ] ) => [ placement, batchedMatrix( handle ) ] ) );
		for ( const [ placement, matrix ] of before ) {
			expect( after.get( placement ).elements ).toEqual( matrix.elements.map( value => expect.closeTo( value, 6 ) ) );
		}
		stream.dispose();
	} );

	it( 'admits one cuboid body per cell, from the pieces that collide', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		const admitted = new Map();
		const collision = { addBoxes: vi.fn( ( id, boxes ) => { admitted.set( id, boxes ); return true; } ), dropBand: vi.fn( id => admitted.delete( id ) ) };
		await stream.update( { x: 200, z: 200 }, { radius: 64, collision } );
		expect( admitted.size ).toBe( stream.resident.size );

		const boxes = [ ...admitted.values() ].flat();
		expect( boxes.length ).toBeGreaterThan( 0 );
		for ( const box of boxes ) {
			expect( box.center.every( Number.isFinite ) ).toBe( true );
			expect( box.halfExtents.every( value => value > 0 ) ).toBe( true );
			expect( Number.isFinite( box.rotationY ) ).toBe( true );
		}
		const expected = standing( stream, world.manifest )
			.reduce( ( total, placement ) => total + stream.pieces.boxesOf( placement.piece ).length, 0 );
		expect( boxes.length ).toBe( expected );
		for ( const piece of MANIFEST.kit.pieces ) {
			if ( ! piece.hasCollision ) expect( stream.pieces.boxesOf( piece.id ) ).toEqual( [] );
		}

		// A segment stands as its road and its two sidewalk bands, so the
		// authored 0.2 m curb is a step and not a flat slab.
		const segment = stream.pieces.boxesOf( 'road/luxury/001' );
		const tops = segment.map( box => Number( ( box.center[ 1 ] + box.halfExtents[ 1 ] ).toFixed( 3 ) ) );
		expect( segment.length ).toBeGreaterThanOrEqual( 3 );
		expect( tops ).toContain( 0.2 );
		expect( tops ).toContain( 0 );

		// A junction arm carries the crossing ramp, which touches every height
		// between the road and the sidewalk. The slope must not pull the two
		// into one surface: both keep their own height and most of their own
		// ground, whichever of them covers more of the arm.
		for ( const id of [ 'junction/road+road/luxury/arm/006', 'junction/road+street/luxury/arm/004' ] ) {
			const arm = coverage( stream.pieces.boxesOf( id ) );
			const ground = [ ...arm.values() ].reduce( ( total, area ) => total + area, 0 );
			expect( arm.get( 0 ) / ground ).toBeGreaterThan( 0.25 );
			expect( arm.get( 0.2 ) / ground ).toBeGreaterThan( 0.25 );
		}

		await stream.update( { x: 9000, z: 9000 } );
		expect( admitted.size ).toBe( 0 );
		stream.dispose();
	} );

	it( 'places a marking copy at its authored scale, rotation and position', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 64 } );
		const pieces = new Map( MANIFEST.kit.pieces.map( piece => [ piece.id, piece ] ) );
		let checked = 0;

		// The piece's own node transform is folded into the batched geometry,
		// so the whole instance matrix is the placement, and the geometry it
		// points at covers the piece's published bounds in piece metres.
		for ( const [ placement, handle ] of drawn( stream, world.manifest ) ) {
			if ( ! placement.scale ) continue;
			const { bounds } = pieces.get( placement.piece );
			// The matrices texture holds 32-bit floats, so a metre carries to
			// well under a tenth of a millimetre.
			expect( batchedMatrix( handle ).elements )
				.toEqual( placementMatrix( placement ).elements.map( value => expect.closeTo( value, 4 ) ) );
			const box = batchedBox( handle );
			expect( box.min.toArray() ).toEqual( bounds.min.map( value => expect.closeTo( value, 3 ) ) );
			expect( box.max.toArray() ).toEqual( bounds.max.map( value => expect.closeTo( value, 3 ) ) );
			checked ++;
		}

		expect( checked ).toBeGreaterThan( 0 );
		stream.dispose();
	} );

	it( 'rejects a piece whose bytes differ from the kit and a placement the kit has no piece for', async () => {
		const wrong = bundle();
		wrong.manifest.kit.pieces[ 0 ].sha256 = '0'.repeat( 64 );
		await expect( new NativeStreetStream( wrong.source, wrong.materials ).update( { x: 200, z: 200 } ) )
			.rejects.toMatchObject( { code: 'E_NATIVE_STREET_STREAM', message: /byte hash mismatch/ } );

		const unknown = bundle();
		unknown.manifest.placements.placements[ 0 ].piece = 'road/none/999';
		await expect( new NativeStreetStream( unknown.source, unknown.materials ).update( { x: 60, z: 40 } ) )
			.rejects.toMatchObject( { code: 'E_NATIVE_STREET_STREAM', message: /no piece road\/none\/999/ } );
	} );

	it( 'compiles one batch per surface before the first copy is drawn', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		const warmed = [];
		const prepare = vi.fn( async group => {
			expect( stream.pieces.copyCount ).toBe( 0 );
			group.traverse( node => { if ( node.material ) warmed.push( node.material.userData.streetNativeSurface ); } );
		} );
		await stream.update( { x: 200, z: 200 }, { radius: 64, prepare } );
		expect( prepare ).toHaveBeenCalledOnce();
		// What the loading counter counts: one compile per surface, not one per
		// piece primitive that wears it.
		expect( warmed ).toHaveLength( SURFACES.size );
		expect( new Set( warmed ) ).toEqual( SURFACES );
		expect( stream.pieces.copyCount ).toBeGreaterThan( 0 );
		await stream.update( { x: 232, z: 200 } );
		expect( prepare ).toHaveBeenCalledOnce();
		stream.dispose();
	} );

} );
