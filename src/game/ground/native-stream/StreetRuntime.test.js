import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Box3, ClampToEdgeWrapping, Matrix4, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, Vector3 } from 'three/webgpu';
import { NativeStreetMaterials } from '../materials/NativeStreetMaterials.js';
import { NativeStreetStream } from './NativeStreetStream.js';
import { placementMatrix } from './StreetCells.js';

// The real saved bundle: 131 kit pieces and 525 placements over nine cells.
const BUNDLE = fileURLToPath( new URL( '../../../../../streets/out/units-tiny-0.7.0/', import.meta.url ) );
const MANIFEST = JSON.parse( readFileSync( `${BUNDLE}manifest.json`, 'utf8' ) );
const PRIMITIVES = MANIFEST.kit.pieces.reduce( ( total, piece ) => total + piece.surfaces.length, 0 );

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

/** The world box of one drawn copy, straight out of the instance buffer. */
function drawnBox( pieces, pieceId, slot ) {
	const box = new Box3(), matrix = new Matrix4(), point = new Vector3();
	for ( const part of pieces.pieces.get( pieceId ).parts ) {
		matrix.fromArray( part.draw.matrices.array, slot * 16 );
		for ( const { geometry } of part.surfaces ) {
			const position = geometry.getAttribute( 'position' );
			for ( let i = 0; i < position.count; i ++ ) box.expandByPoint( point.fromBufferAttribute( position, i ).applyMatrix4( matrix ) );
		}
	}
	return box;
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

	it( 'loads every kit piece once and owns one instanced draw per piece primitive', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( world.readPiece ).toHaveBeenCalledTimes( MANIFEST.kit.pieces.length );
		expect( stream.pieces.drawCount ).toBe( PRIMITIVES );
		let meshes = 0;
		stream.group.traverse( node => { if ( node.isInstancedMesh ) meshes ++; } );
		expect( meshes ).toBe( PRIMITIVES );
		await stream.update( { x: 264, z: 200 } );
		expect( world.readPiece ).toHaveBeenCalledTimes( MANIFEST.kit.pieces.length );
		expect( stream.stats ).toMatchObject( { indexed: 525, pending: false } );
		stream.dispose();
		expect( () => stream.update( { x: 0, z: 0 } ) ).toThrow( /disposed/ );
	} );

	it( 'appends a cell\'s copies to the shared draws and takes them out again', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 16 } );
		const copies = standing( stream, world.manifest );
		expect( stream.resident.size ).toBeGreaterThan( 0 );
		expect( copies.length ).toBeGreaterThan( 0 );
		expect( stream.pieces.instanceCount ).toBe( copies.length );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( stream.pieces.instanceCount ).toBe( standing( stream, world.manifest ).length );
		await stream.update( { x: 9000, z: 9000 } );
		expect( stream.resident.size ).toBe( 0 );
		expect( stream.pieces.instanceCount ).toBe( 0 );
		expect( stream.pieces.drawCount ).toBe( PRIMITIVES );
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
		const slots = new Map();
		let checked = 0;

		for ( const placement of standing( stream, world.manifest ) ) {
			const slot = slots.get( placement.piece ) ?? 0;
			slots.set( placement.piece, slot + 1 );
			if ( ! placement.scale ) continue;
			const { bounds } = pieces.get( placement.piece );
			const expected = new Box3();
			const matrix = placementMatrix( placement );
			for ( const x of [ bounds.min[ 0 ], bounds.max[ 0 ] ] ) for ( const z of [ bounds.min[ 2 ], bounds.max[ 2 ] ] ) {
				for ( const y of [ bounds.min[ 1 ], bounds.max[ 1 ] ] ) expected.expandByPoint( new Vector3( x, y, z ).applyMatrix4( matrix ) );
			}
			const drawn = drawnBox( stream.pieces, placement.piece, slot );
			expect( drawn.min.toArray() ).toEqual( expected.min.toArray().map( value => expect.closeTo( value, 3 ) ) );
			expect( drawn.max.toArray() ).toEqual( expected.max.toArray().map( value => expect.closeTo( value, 3 ) ) );
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

	it( 'compiles the shared draws before the first copy is drawn', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		const surfaces = new Set();
		const prepare = vi.fn( async group => {
			expect( stream.pieces.instanceCount ).toBe( 0 );
			group.traverse( node => { if ( node.isInstancedMesh ) surfaces.add( node.material.userData.streetNativeSurface ); } );
		} );
		await stream.update( { x: 200, z: 200 }, { radius: 64, prepare } );
		expect( prepare ).toHaveBeenCalledOnce();
		expect( surfaces.size ).toBe( new Set( MANIFEST.kit.pieces.flatMap( piece => piece.surfaces ) ).size );
		expect( stream.pieces.instanceCount ).toBeGreaterThan( 0 );
		await stream.update( { x: 232, z: 200 } );
		expect( prepare ).toHaveBeenCalledOnce();
		stream.dispose();
	} );

} );
