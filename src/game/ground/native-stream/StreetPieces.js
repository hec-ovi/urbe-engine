import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { mapConcurrent } from '../../city/BuildingsLoader.js';
import { plain } from '../../city/GeometryBake.js';
import { compact } from '../../city/kit/BatchGeometry.js';
import { MaterialBatches } from '../../city/kit/MaterialBatches.js';
import { byteHash } from '../native/NativeStreetChecks.js';
import { streetPieceBoxes } from './StreetPieceBoxes.js';

const LOAD_CONCURRENCY = 8;

export const streamError = ( message, cause ) =>
	Object.assign( new Error( `E_NATIVE_STREET_STREAM: ${message}` ), { code: 'E_NATIVE_STREET_STREAM', ...( cause ? { cause } : {} ) } );

/**
 * The city's whole street vocabulary, loaded once.
 *
 * Every piece in `kit.json` is read through the source, checked against the
 * size and hash the kit publishes for it and decoded once. What comes out is
 * one batch per native surface the kit wears, holding every piece primitive
 * that wears it: admitting a cell appends matrices to batches that already
 * exist, so the draw count follows the kit's surfaces and not how many pieces
 * it has or how much street is standing.
 *
 * A primitive is rebased into its piece's own metres as it is read: the
 * producer quantizes positions and hangs the scale back to metres on the node,
 * and several primitives share one vertex buffer. A batch has one buffer per
 * attribute, so each primitive is compacted to the vertices it draws and its
 * node transform folded in, which leaves the placement matrix as the whole
 * instance matrix.
 */
export class StreetPieces {

	/**
	 * @param kit the manifest's `kit`, already identity-checked with it
	 * @param source the verified street source, for piece bytes
	 * @param materials the native street material factory
	 */
	constructor( { kit, source, materials, loader = cityGltfLoader() } ) {

		this.kit = kit;
		this.source = source;
		this.materials = materials;
		this.loader = loader;
		this.pieces = new Map();
		this.abort = new AbortController();
		this.batches = new MaterialBatches( 'street-pieces' );
		this.group = this.batches.group;
		this.ready = this.#load();

	}

	/** One draw per native surface, for the whole city. */
	get batchCount() {

		return this.batches.batchCount;

	}

	/** How many copies of every piece are standing. */
	get copyCount() {

		return this.batches.copies;

	}

	/** This piece's cuboids, in piece coordinates; empty when it does not collide. */
	boxesOf( pieceId ) {

		return this.pieces.get( pieceId )?.boxes ?? [];

	}

	/** Room for the copies a cell is about to place, one reallocation per batch. */
	reserve( pieceIds ) {

		this.batches.reserve( pieceIds );

	}

	/**
	 * Draws one more copy of a piece.
	 * @param handles the caller's release list, appended in place
	 */
	admit( placement, world, handles ) {

		if ( ! this.pieces.has( placement.piece ) ) throw streamError( `no piece ${placement.piece} in this kit` );

		handles.push( this.batches.admit( placement.piece, world ) );

	}

	release( handle ) {

		this.batches.release( handle );

	}

	dispose() {

		this.abort.abort();
		this.batches.dispose();
		for ( const piece of this.pieces.values() ) for ( const { geometry } of piece.surfaces ) geometry.dispose();
		this.pieces.clear();

	}

	async #load() {

		const loaded = await mapConcurrent( this.kit.pieces, LOAD_CONCURRENCY, entry => this.#piece( entry ) );

		for ( const piece of loaded ) this.pieces.set( piece.id, piece );
		this.batches.build( loaded );

		// A batch draws its own buffers, not the ones each primitive was checked
		// on: a bucket whose primitives disagree on an attribute settles it by
		// rewriting them, and a surface that lost its UVs or its wear that way
		// renders flat and untextured instead of failing. The batch answers for
		// itself before a single copy stands.
		for ( const batch of this.batches.batches.values() ) this.materials.assertGeometry( batch.material, batch.mesh.geometry );

		return this;

	}

	async #piece( entry ) {

		const bytes = await this.source.readPiece( entry.id, this.abort.signal );
		if ( bytes.byteLength !== entry.bytes ) throw streamError( `${entry.id}: ${bytes.byteLength} bytes, the kit publishes ${entry.bytes}` );
		if ( await byteHash( bytes ) !== entry.sha256 ) throw streamError( `${entry.id}: byte hash mismatch` );

		const { scene } = await this.loader.parseAsync( bytes, '' );
		scene.updateMatrixWorld( true );
		const surfaces = [], resources = new Set(), originals = new Set();
		const triangles = [];
		let count = 0;

		try {

			scene.traverse( mesh => {

				if ( ! mesh.isMesh ) return;
				const surfaceId = mesh.material?.userData?.streetNativeSurface;
				const collides = mesh.geometry.userData.streetCollision;
				if ( ! entry.surfaces.includes( surfaceId ) || typeof collides !== 'boolean' ) {

					throw streamError( `${entry.id}: missing native surface or collision authority` );

				}
				originals.add( mesh.material );
				const material = this.materials.build( surfaceId );
				this.materials.assertGeometry( material, mesh.geometry );
				for ( const resource of this.materials.resources( material ) ) resources.add( resource.ready );

				const indices = mesh.geometry.index?.count ?? mesh.geometry.getAttribute( 'position' ).count;
				if ( indices % 3 ) throw streamError( `${entry.id}: incomplete triangles` );
				count += indices / 3;
				if ( collides && entry.hasCollision ) pieceTriangles( mesh, triangles );

				// Paint and scans lie flat on the road; only bodies cast shadows.
				surfaces.push( { bucket: surfaceId, geometry: rebased( mesh ), material, castShadow: collides } );

			} );

			if ( count !== entry.triangles ) throw streamError( `${entry.id}: ${count} triangles, the kit publishes ${entry.triangles}` );
			await Promise.all( resources );
			if ( this.abort.signal.aborted ) throw streamError( `${entry.id}: cancelled` );

		} catch ( error ) {

			for ( const { geometry } of surfaces ) geometry.dispose();
			throw error;

		} finally {

			for ( const material of originals ) material.dispose();

		}

		return { id: entry.id, surfaces, boxes: entry.hasCollision ? streetPieceBoxes( triangles, entry.bounds ) : [] };

	}

}

/** One primitive in its piece's own metres: the vertices it draws, dequantized. */
function rebased( mesh ) {

	const geometry = compact( mesh.geometry );
	plain( geometry, 'position' );
	geometry.applyMatrix4( mesh.matrixWorld );

	return geometry;

}

/** Piece-local vertices of one mesh, appended nine numbers per triangle. */
function pieceTriangles( mesh, out ) {

	const position = mesh.geometry.getAttribute( 'position' ), index = mesh.geometry.index;
	const matrix = mesh.matrixWorld.elements;

	for ( let i = 0; i < ( index?.count ?? position.count ); i ++ ) {

		const at = index ? index.getX( i ) : i;
		const x = position.getX( at ), y = position.getY( at ), z = position.getZ( at );
		out.push(
			matrix[ 0 ] * x + matrix[ 4 ] * y + matrix[ 8 ] * z + matrix[ 12 ],
			matrix[ 1 ] * x + matrix[ 5 ] * y + matrix[ 9 ] * z + matrix[ 13 ],
			matrix[ 2 ] * x + matrix[ 6 ] * y + matrix[ 10 ] * z + matrix[ 14 ]
		);

	}

}
