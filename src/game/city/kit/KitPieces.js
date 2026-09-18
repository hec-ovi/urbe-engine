import * as THREE from 'three/webgpu';
import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { documentHash } from '../../data/WorldDocument.js';
import { mapConcurrent } from '../BuildingsLoader.js';
import { KitPieceDraw } from './KitPieceDraw.js';
import { readPiece } from './KitGeometry.js';

const LOAD_CONCURRENCY = 8;

/**
 * The city's whole facade vocabulary, loaded once.
 *
 * Every family's nine pieces are read from `kit.json` and decoded through the
 * shared city GLTF loader, their materials resolved through the same PBR
 * factory the original shells use. What comes out is one `InstancedMesh` per
 * piece surface for the entire city: admitting a cell appends matrices to
 * draws that already exist, so the draw count follows the kit, not the number
 * of buildings standing.
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
		this.group = new THREE.Group();
		this.group.name = 'kit-pieces';
		this.ready = this.#load();

	}

	/** One draw per piece surface, for the whole city. */
	get drawCount() {

		let total = 0;
		for ( const piece of this.pieces.values() ) {

			total += piece.draw.meshes.length + ( piece.leafDraw?.meshes.length ?? 0 );

		}

		return total;

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

	/**
	 * Draws one more copy of a piece.
	 * @param swinging true when this building owns its leaves as moving pivots,
	 *   so the shared copies of them stay out of the instanced draw
	 * @returns one handle per copy, to hand back to `release`
	 */
	admit( pieceId, matrix, color, { swinging = false } = {} ) {

		const piece = this.pieces.get( pieceId );
		if ( ! piece ) throw placementError( `no piece ${pieceId} in this kit` );

		const handle = piece.draw.add( matrix, color, { slot: - 1 } );
		if ( ! swinging && piece.leafDraw ) handle.leaf = piece.leafDraw.add( matrix, color, { slot: - 1 } );

		return handle;

	}

	release( handle ) {

		handle.draw.remove( handle );
		if ( handle.leaf ) handle.leaf.draw.remove( handle.leaf );

	}

	dispose() {

		for ( const piece of this.pieces.values() ) {

			piece.draw.dispose();
			piece.leafDraw?.dispose();
			for ( const { geometry } of piece.surfaces ) geometry.dispose();
			for ( const leaf of piece.leaves ) for ( const { geometry } of leaf.surfaces ) geometry.dispose();

		}
		this.pieces.clear();
		this.group.clear();
		this.group.removeFromParent();

	}

	async #load() {

		const records = this.kit.families.flatMap( ( family ) => family.pieces );
		const loaded = await mapConcurrent( records, LOAD_CONCURRENCY, ( piece ) => this.#piece( piece ) );

		for ( const piece of loaded ) {

			this.pieces.set( piece.id, piece );
			this.group.add( piece.draw.group );
			if ( piece.leafDraw ) this.group.add( piece.leafDraw.group );

		}

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

		return {
			id: piece.id,
			triangles: piece.triangles ?? 0,
			surfaces,
			leaves,
			draw: new KitPieceDraw( `kit:${piece.id}`, surfaces ),
			leafDraw: leaves.length ? new KitPieceDraw( `kit:${piece.id}/leaves`, leaves.flatMap( ( leaf ) => leaf.surfaces ) ) : null
		};

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
