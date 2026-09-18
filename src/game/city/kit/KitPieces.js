import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { documentHash } from '../../data/WorldDocument.js';
import { mapConcurrent } from '../BuildingsLoader.js';
import { MaterialBatches } from './MaterialBatches.js';
import { readPiece } from './KitGeometry.js';

const LOAD_CONCURRENCY = 8;
/** The addressable leaves of a piece, drawn with it unless the building swings them. */
const LEAVES = ( pieceId ) => `${pieceId}/leaves`;

/**
 * The city's whole facade vocabulary, loaded once.
 *
 * Every family's nine pieces are read from `kit.json` and decoded through the
 * shared city GLTF loader, their materials resolved through the same PBR
 * factory the original shells use. What comes out is one batch per material the
 * kit wears, holding every piece primitive that wears it: admitting a cell
 * appends copies to batches that already exist, so the draw count follows the
 * kit's materials, not the number of pieces and not the number of buildings
 * standing.
 *
 * A piece file that is missing, refuses to decode or does not match the length
 * and hash `kit.json` publishes for it fails the whole kit with
 * `E_KIT_PIECES`: a city drawn from half a vocabulary is worse than one that
 * says why it cannot start.
 */
export class KitPieces {

	/**
	 * @param kit the validated `kit.json` document
	 * @param baseUrl the directory it was read from, which its file paths are relative to
	 * @param readBinary reads one URL into an ArrayBuffer
	 */
	constructor( { kit, baseUrl, factory, loader = cityGltfLoader(), readBinary = fetchBinary } ) {

		this.kit = kit;
		this.baseUrl = String( baseUrl ).replace( /\/+$/, '' );
		this.factory = factory;
		this.loader = loader;
		this.readBinary = readBinary;
		this.pieces = new Map();
		this.batches = new MaterialBatches( 'kit-pieces' );
		this.group = this.batches.group;
		this.ready = this.#load();

	}

	/** One draw per material, for the whole city. */
	get batchCount() {

		return this.batches.batchCount;

	}

	has( pieceId ) {

		return this.pieces.has( pieceId );

	}

	/** What one copy of this piece costs to draw. */
	trianglesOf( pieceId ) {

		return this.pieces.get( pieceId )?.triangles ?? 0;

	}

	/** The piece's addressable leaves, for a building that swings its own door. */
	leaves( pieceId ) {

		return this.pieces.get( pieceId )?.leaves ?? [];

	}

	/** Room for the copies a cell is about to place, one reallocation per batch. */
	reserve( pieceIds ) {

		this.batches.reserve( pieceIds.flatMap( ( id ) => this.pieces.get( id )?.leaves.length ? [ id, LEAVES( id ) ] : [ id ] ) );

	}

	/**
	 * Draws one more copy of a piece.
	 * @param swinging true when this building owns its leaves as moving pivots,
	 *   so the shared copies of them stay out of the batches
	 * @returns one handle per copy, to hand back to `release`
	 */
	admit( pieceId, matrix, color, { swinging = false } = {} ) {

		const piece = this.pieces.get( pieceId );
		if ( ! piece ) throw placementError( `no piece ${pieceId} in this kit` );

		const handle = this.batches.admit( pieceId, matrix, color );
		if ( ! swinging && piece.leaves.length ) handle.leaf = this.batches.admit( LEAVES( pieceId ), matrix, color );

		return handle;

	}

	release( handle ) {

		this.batches.release( handle );
		if ( handle.leaf ) this.batches.release( handle.leaf );

	}

	dispose() {

		this.batches.dispose();
		for ( const piece of this.pieces.values() ) {

			for ( const { geometry } of piece.surfaces ) geometry.dispose();
			for ( const leaf of piece.leaves ) for ( const { geometry } of leaf.surfaces ) geometry.dispose();

		}
		this.pieces.clear();

	}

	async #load() {

		const records = this.kit.families.flatMap( ( family ) => family.pieces );
		const loaded = await mapConcurrent( records, LOAD_CONCURRENCY, ( piece ) => this.#piece( piece ) );
		const entries = [];

		for ( const piece of loaded ) {

			this.pieces.set( piece.id, piece );
			entries.push( { id: piece.id, surfaces: piece.surfaces } );
			if ( piece.leaves.length ) entries.push( { id: LEAVES( piece.id ), surfaces: piece.leaves.flatMap( ( leaf ) => leaf.surfaces ) } );

		}
		this.batches.build( entries, { castShadow: true } );

		return this;

	}

	async #piece( piece ) {

		const url = `${this.baseUrl}/${piece.file}`;
		let scene;

		try {

			const bytes = await this.readBinary( url );
			if ( Number.isInteger( piece.bytes ) && bytes.byteLength !== piece.bytes ) {

				throw new Error( `${bytes.byteLength} bytes, the kit publishes ${piece.bytes}` );

			}
			if ( piece.sha256 && await documentHash( bytes ) !== piece.sha256 ) throw new Error( 'byte hash mismatch' );
			( { scene } = await this.loader.parseAsync( bytes, `${this.baseUrl}/` ) );

		} catch ( cause ) {

			throw Object.assign( new Error( `E_KIT_PIECES: ${url}: ${cause.message ?? cause}` ), { code: 'E_KIT_PIECES', cause } );

		}

		const { surfaces, leaves } = readPiece( scene, this.factory );

		return { id: piece.id, triangles: piece.triangles ?? 0, surfaces, leaves };

	}

}

export function placementError( message ) {

	return Object.assign( new Error( `E_KIT_PLACEMENT: ${message}` ), { code: 'E_KIT_PLACEMENT' } );

}

async function fetchBinary( url ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );

	return response.arrayBuffer();

}
