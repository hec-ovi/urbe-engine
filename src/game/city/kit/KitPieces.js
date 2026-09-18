import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { documentHash } from '../../data/WorldDocument.js';
import { mapConcurrent } from '../BuildingsLoader.js';
import { MaterialBatches } from './MaterialBatches.js';
import { readShell } from './KitGeometry.js';

const LOAD_CONCURRENCY = 8;
/** The entrance leaves of a plan, drawn with it unless the parcel swings them. */
const LEAVES = ( planId ) => `${planId}/leaves`;

/**
 * Every distinct building the city has, loaded once.
 *
 * A plan is one Exterior shell generated on a canonical lot, and a city of
 * hundreds of buildings is a hundred or so of them. Each plan's GLB is read
 * through the shared city GLTF loader, its materials resolved through the same
 * PBR factory the original shells use, and its geometry fed into one batch per
 * material. Admitting a parcel appends one copy per surface to batches that
 * already exist, so the draw count follows the materials the plans wear and not
 * the number of buildings standing.
 *
 * A plan file that is missing, refuses to decode or does not match the length
 * and hash the index publishes for it fails the whole set with `E_KIT_PIECES`:
 * a city drawn from half its buildings is worse than one that says why it
 * cannot start.
 */
export class KitPieces {

	/**
	 * @param kit the world's plan index document
	 * @param baseUrl the shared store root its file paths are relative to
	 * @param readBinary reads one URL into an ArrayBuffer
	 * @param readJson reads one URL into a parsed document
	 */
	constructor( { kit, baseUrl, factory, loader = cityGltfLoader(), readBinary = fetchBinary, readJson = fetchJson } ) {

		this.kit = kit;
		this.baseUrl = String( baseUrl ).replace( /\/+$/, '' );
		this.factory = factory;
		this.loader = loader;
		this.readBinary = readBinary;
		this.readJson = readJson;
		/** plan id -> its id, lot bays, surfaces and leaves */
		this.plans = new Map();
		this.batches = new MaterialBatches( 'kit-plans' );
		this.group = this.batches.group;
		this.ready = this.#load();

	}

	/** One draw per material, for the whole city. */
	get batchCount() {

		return this.batches.batchCount;

	}

	has( planId ) {

		return this.plans.has( planId );

	}

	/** What one copy of this building costs to draw. */
	trianglesOf( planId ) {

		return this.plans.get( planId )?.triangles ?? 0;

	}

	/** The entrance's addressable leaves, for a parcel that swings its own door. */
	leaves( planId ) {

		return this.plans.get( planId )?.leaves ?? [];

	}

	/** Room for the copies a cell is about to place, one reallocation per batch. */
	reserve( planIds ) {

		this.batches.reserve( planIds.flatMap( ( id ) => this.plans.get( id )?.leaves.length ? [ id, LEAVES( id ) ] : [ id ] ) );

	}

	/**
	 * Draws one more copy of a plan.
	 * @param swinging true when this parcel owns its entrance leaves as moving
	 *   pivots, so the shared copies of them stay out of the batches
	 * @returns one handle per copy, to hand back to `release`
	 */
	admit( planId, matrix, color, { swinging = false } = {} ) {

		const plan = this.plans.get( planId );
		if ( ! plan ) throw placementError( `no plan ${planId} in this world` );

		const handle = this.batches.admit( planId, matrix, color );
		if ( ! swinging && plan.leaves.length ) handle.leaf = this.batches.admit( LEAVES( planId ), matrix, color );

		return handle;

	}

	release( handle ) {

		this.batches.release( handle );
		if ( handle.leaf ) this.batches.release( handle.leaf );

	}

	dispose() {

		this.batches.dispose();
		for ( const plan of this.plans.values() ) {

			for ( const { geometry } of plan.surfaces ) geometry.dispose();
			for ( const leaf of plan.leaves ) for ( const { geometry } of leaf.surfaces ) geometry.dispose();

		}
		this.plans.clear();

	}

	async #load() {

		const loaded = await mapConcurrent( this.kit.plans, LOAD_CONCURRENCY, ( plan ) => this.#plan( plan ) );
		const entries = [];

		for ( const plan of loaded ) {

			this.plans.set( plan.id, plan );
			entries.push( { id: plan.id, surfaces: plan.surfaces } );
			if ( plan.leaves.length ) entries.push( { id: LEAVES( plan.id ), surfaces: plan.leaves.flatMap( ( leaf ) => leaf.surfaces ) } );

		}
		this.batches.build( entries, { castShadow: true } );

		return this;

	}

	async #plan( entry ) {

		const url = `${this.baseUrl}/${entry.glb}`;
		let blueprint;
		let scene;

		try {

			blueprint = await this.readJson( `${this.baseUrl}/${entry.blueprint}` );
			const bytes = await this.readBinary( url );
			if ( Number.isInteger( entry.bytes ) && bytes.byteLength !== entry.bytes ) {

				throw new Error( `${bytes.byteLength} bytes, the index publishes ${entry.bytes}` );

			}
			if ( entry.sha256 && await documentHash( bytes ) !== entry.sha256 ) throw new Error( 'byte hash mismatch' );
			( { scene } = await this.loader.parseAsync( bytes, `${this.baseUrl}/` ) );

		} catch ( cause ) {

			throw Object.assign( new Error( `E_KIT_PIECES: ${url}: ${cause.message ?? cause}` ), { code: 'E_KIT_PIECES', cause } );

		}

		const { surfaces, leaves } = readShell( scene, this.factory, blueprint );

		return {
			id: entry.id, baysAcross: entry.baysAcross, baysDeep: entry.baysDeep,
			surfaces, leaves,
			triangles: surfaces.reduce( ( sum, { geometry } ) => sum + triangles( geometry ), 0 )
				+ leaves.reduce( ( sum, leaf ) => sum + leaf.surfaces.reduce( ( part, { geometry } ) => part + triangles( geometry ), 0 ), 0 )
		};

	}

}

export function placementError( message ) {

	return Object.assign( new Error( `E_KIT_PLACEMENT: ${message}` ), { code: 'E_KIT_PLACEMENT' } );

}

function triangles( geometry ) {

	return ( geometry.getIndex()?.count ?? geometry.getAttribute( 'position' ).count ) / 3;

}

async function fetchBinary( url ) {

	return ( await ok( url ) ).arrayBuffer();

}

async function fetchJson( url ) {

	return ( await ok( url ) ).json();

}

async function ok( url ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );

	return response;

}
