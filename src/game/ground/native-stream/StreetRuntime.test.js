import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, ClampToEdgeWrapping, Matrix4, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import { NativeStreetMaterials } from '../materials/NativeStreetMaterials.js';
import { requiredAttributes } from '../materials/NativeGeometry.js';
import { NativeStreetStream } from './NativeStreetStream.js';
import { placementMatrix } from './StreetCells.js';
import { streetBundle } from './street-bundle.fixture.js';

// The real bundle Streets publishes for the fixture city: the shared 187 piece
// catalogue and this city's own placements over nine cells.
let ROOT, MANIFEST, SURFACES;

beforeAll( async () => {
	const built = await streetBundle();
	ROOT = built.root; MANIFEST = built.manifest;
	SURFACES = new Set( MANIFEST.kit.pieces.flatMap( piece => piece.surfaces ) );
}, 120_000 );

function bundle( manifest = structuredClone( MANIFEST ) ) {
	const files = new Map( manifest.kit.pieces.map( piece => [ piece.id, join( ROOT, 'streets', piece.file ) ] ) );
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

/** The values one copy's batch holds for it on one surface, as the shader reads them. */
function row( stream, surface, handle ) {
	const table = stream.pieces.instances.tables.get( surface );
	const part = handle.parts.findIndex( ( { batch } ) => batch === table.batch );
	const at = handle.instances[ part ] * table.texels * 4;
	return [ ...table.image.image.data.slice( at, at + table.texels * 4 ) ];
}

/** The first copy standing of a placement that carries this value. */
function carrying( stream, manifest, value ) {
	return drawn( stream, manifest ).find( ( [ placement ] ) => placement[ value ] !== undefined );
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
		expect( stream.pieces.batchCount ).toBe( SURFACES.size );
		const batches = [];
		stream.group.traverse( node => { if ( node.isBatchedMesh ) batches.push( node ); } );
		expect( batches ).toHaveLength( SURFACES.size );
		// Per copy culling answers for the batch, so the object test is off.
		expect( batches.every( node => node.perObjectFrustumCulled && ! node.frustumCulled ) ).toBe( true );
		expect( batches.filter( node => node.sortObjects ).every( node => node.material.transparent ) ).toBe( true );
		// Paint, scans and the lettered marquee face lie over what they mark; only bodies cast.
		expect( new Set( batches.filter( node => node.castShadow ).map( node => node.material.userData.streetNativeSurface ) ) )
			.toEqual( new Set( [ 'asphalt', 'basalt', 'concrete', 'curb', 'district-curb-blue', 'district-curb-red', 'district-curb-yellow',
				'district-gutter-blue', 'district-gutter-red', 'district-gutter-yellow', 'district-hex', 'district-junction-blue',
				'district-junction-yellow', 'district-panel-blue', 'district-panel-dark', 'green', 'gutter', 'joint', 'ochre',
				'ordinary', 'paintedConcrete', 'perforated', 'plastic' ] ) );
		await stream.update( { x: 264, z: 200 } );
		expect( world.readPiece ).toHaveBeenCalledTimes( MANIFEST.kit.pieces.length );
		expect( stream.stats ).toMatchObject( { indexed: MANIFEST.placements.placements.length, pending: false } );
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
		const before = drawn( stream, world.manifest ).map( ( [ placement, handle ] ) => [ placement, batchedMatrix( handle ), row( stream, 'joint', handle ) ] );
		const batch = stream.pieces.batches.batches.get( 'joint' );
		expect( before.length ).toBeGreaterThan( 0 );

		const capacity = batch.capacity;
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		expect( batch.capacity ).toBeGreaterThan( capacity );
		expect( batch.count ).toBeLessThanOrEqual( batch.capacity );

		// Every copy that was already standing still draws where it stood, with
		// the values it was admitted with: the table grows with its batch.
		const after = new Map( drawn( stream, world.manifest ).map( ( [ placement, handle ] ) => [ placement, [ batchedMatrix( handle ), row( stream, 'joint', handle ) ] ] ) );
		for ( const [ placement, matrix, values ] of before ) {
			const [ drawnMatrix, drawnValues ] = after.get( placement );
			expect( drawnMatrix.elements ).toEqual( matrix.elements.map( value => expect.closeTo( value, 6 ) ) );
			expect( drawnValues ).toEqual( values );
		}
		expect( stream.pieces.instances.tables.get( 'joint' ).rows ).toBeGreaterThanOrEqual( batch.capacity );
		stream.dispose();
	} );

	it( 'follows every batch\'s indirect table from the reservation, before the first copy of the window is written', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		const tables = () => [ ...stream.pieces.instances.tables.values() ];
		await stream.update( { x: 200, z: 200 }, { radius: 16, prepare: async () => {} } );
		const held = new Map( tables().map( table => [ table, table.batch.capacity ] ) );

		// A window grows every batch it will touch before it admits anything, and
		// growing throws the indirect table away and installs a new one. Admission
		// then runs in slices with frames in between, so a table still holding the
		// thrown away one resolves its rows through a draw order nothing updates.
		let reserved = null;
		await stream.update( { x: 200, z: 200 }, { radius: 512, prepare: async () => {
			reserved = tables().map( table => ( {
				grown: table.batch.capacity > held.get( table ),
				live: table.indirect.value === table.batch.mesh._indirectTexture
			} ) );
		} } );
		expect( reserved.some( entry => entry.grown ) ).toBe( true );
		expect( reserved.every( entry => entry.live ) ).toBe( true );
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
		const segment = stream.pieces.boxesOf( 'road/luxury/avenue/8m-plain' );
		const tops = segment.map( box => Number( ( box.center[ 1 ] + box.halfExtents[ 1 ] ).toFixed( 3 ) ) );
		expect( segment.length ).toBeGreaterThanOrEqual( 3 );
		expect( tops ).toContain( 0.2 );
		expect( tops ).toContain( 0 );

		// A junction arm carries the crossing ramp, which touches every height
		// between the road and the sidewalk. The slope must not pull the two
		// into one surface: both keep their own height and most of their own
		// ground, whichever of them covers more of the arm.
		for ( const id of [ 'junction/luxury/avenue/arm', 'junction/luxury/local/arm' ] ) {
			const arm = coverage( stream.pieces.boxesOf( id ) );
			const ground = [ ...arm.values() ].reduce( ( total, area ) => total + area, 0 );
			expect( arm.get( 0 ) / ground ).toBeGreaterThan( 0.25 );
			expect( arm.get( 0.2 ) / ground ).toBeGreaterThan( 0.25 );
		}

		await stream.update( { x: 9000, z: 9000 } );
		expect( admitted.size ).toBe( 0 );
		stream.dispose();
	} );

	it( 'places a copy at its authored scale, rotation and position', async () => {
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

	it( 'gives every copy the tint and the wear its placement carries', async () => {
		const world = bundle();
		// Streets publishes wear on every placement and leaves the tint at
		// white; a tinted one proves the row carries what the bundle says.
		const tinted = world.manifest.placements.placements.find( placement => placement.piece.startsWith( 'road/' ) );
		tinted.tint = [ 0.25, 0.5, 0.75 ];
		const stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );

		let checked = 0;
		for ( const [ placement, handle ] of drawn( stream, world.manifest ) ) {
			for ( const { batch } of handle.parts ) {
				const surface = batch.name.replace( 'street-pieces:', '' );
				expect( row( stream, surface, handle ).slice( 0, 4 ) )
					.toEqual( [ ...placement.tint ?? [ 1, 1, 1 ], placement.wear ?? 0 ].map( value => expect.closeTo( value, 6 ) ) );
			}
			checked ++;
		}
		expect( checked ).toBe( stream.pieces.copyCount );
		expect( drawn( stream, world.manifest ).map( ( [ placement ] ) => placement ) ).toContain( tinted );
		expect( world.manifest.placements.placements.filter( placement => placement.wear > 0 ).length ).toBeGreaterThan( 0 );
		stream.dispose();
	} );

	it( 'gives a scan copy its own cell of the shared scan atlas', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		const [ placement, handle ] = carrying( stream, world.manifest, 'scan' );
		const surface = MANIFEST.kit.pieces.find( piece => piece.id === placement.piece ).surfaces[ 0 ];

		// The quad is one unit square whatever cell it shows: the offset and
		// the scale it draws with are the placement's, and the material holds
		// every cell the kit's atlas names.
		expect( row( stream, surface, handle ).slice( 4, 8 ) )
			.toEqual( [ ...placement.scan.offset, ...placement.scan.scale ].map( value => expect.closeTo( value, 6 ) ) );
		const cells = MANIFEST.kit.scanAtlas.map( id => MANIFEST.materials.binding.textures[ MANIFEST.materials.binding.surfaces[ id ].maps.basecolor ].path );
		const material = world.materials.build( surface, stream.pieces.instances.options( surface ) );
		expect( world.materials.resources( material ).map( resource => `themes/${resource.texture.name}` ) ).toEqual( cells );
		expect( material.transparent ).toBe( true );
		stream.dispose();
	} );

	it( 'letters a marquee copy from the glyphs its placement names', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 512 } );
		const [ placement, handle ] = carrying( stream, world.manifest, 'text' );
		const display = MANIFEST.kit.pieces.find( piece => piece.id === placement.piece ).surfaces
			.find( id => MANIFEST.materials.binding.surfaces[ id ].effect === 'display' );
		const table = stream.pieces.instances.tables.get( display );

		// The face letters the text itself: its row holds the glyph count and
		// one atlas index per glyph, and it draws over the frame behind it.
		expect( table.glyphs ).toBe( Math.max( ...world.manifest.placements.placements.filter( p => p.text ).map( p => p.text.length ) ) );
		const values = row( stream, display, handle );
		expect( values[ 4 ] ).toBe( placement.text.length );
		expect( values.filter( ( _, index ) => index >= 8 && index % 4 === 0 ).slice( 0, placement.text.length ) ).toEqual( placement.text );
		expect( world.materials.build( display, stream.pieces.instances.options( display ) ).transparent ).toBe( true );
		// The frame around the face reads no glyphs of its own.
		for ( const id of MANIFEST.kit.pieces.find( piece => piece.id === placement.piece ).surfaces ) {
			if ( id !== display ) expect( stream.pieces.instances.tables.get( id ).glyphs ).toBe( 0 );
		}
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

	/**
	 * A batch draws its own buffers, not the ones each primitive arrived in.
	 * Filling one settles any disagreement between its primitives by rewriting
	 * the attribute for all of them, so a surface can reach the renderer
	 * without the UVs or the wear its effect samples and draw flat and
	 * untextured instead of failing. What the batch holds is what is checked.
	 */
	it( 'keeps the attributes every surface\'s effect needs in the batch it fills', async () => {
		const world = bundle(), stream = new NativeStreetStream( world.source, world.materials );
		await stream.update( { x: 200, z: 200 }, { radius: 64 } );
		const binding = world.manifest.materials.binding;
		for ( const [ surfaceId, batch ] of stream.pieces.batches.batches ) {
			const geometry = batch.mesh.geometry;
			const vertices = geometry.getAttribute( 'position' ).count;
			for ( const [ name, itemSize ] of Object.entries( requiredAttributes( binding.surfaces[ surfaceId ].effect ) ) ) {
				expect( geometry.getAttribute( name ) ).toMatchObject( { itemSize, count: vertices } );
			}
		}

		const stripped = bundle();
		const streetPieces = new NativeStreetStream( stripped.source, stripped.materials ).pieces;
		const add = streetPieces.batches.add.bind( streetPieces.batches );
		streetPieces.batches.add = entries => {
			const built = add( entries );
			for ( const batch of built.batches.values() ) batch.mesh.geometry.deleteAttribute( 'uv' );
			return built;
		};
		await expect( streetPieces.ready ).rejects.toMatchObject( { code: 'E_STREET_MATERIAL', message: /uv/ } );
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
