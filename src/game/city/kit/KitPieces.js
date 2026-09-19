import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { mapConcurrent } from '../BuildingsLoader.js';
import { MaterialBatches } from './MaterialBatches.js';
import { pieceError, readPlan } from './PlanFile.js';

const LOAD_CONCURRENCY = 8;
/** The entrance leaves of a plan, drawn with it unless the parcel swings them. */
const LEAVES = ( planId ) => `${planId}/leaves`;
/** The fake rooms behind a plan's glass, drawn unless the parcel opens a real interior. */
const SCENERY = ( planId ) => `${planId}/scenery`;

/**
 * The distinct buildings this city stands on, read as it needs them.
 *
 * A plan is one Exterior shell generated on a canonical lot, and a city of
 * hundreds of buildings is a hundred or so of them: several hundred megabytes
 * of GLB for a kilometre of city and more for three. None of it is read to
 * start playing. The index alone says which plans the world publishes, and a
 * plan's files are read, checked, decoded and merged into the draws the first
 * time a cell that stands on it asks for it, through `want`.
 *
 * Merging means one batch per material for the whole city: each plan's
 * primitives go into the batch its material owns, which grows to take them, so
 * the draw count follows the materials the plans wear and never the number of
 * plans read or buildings standing.
 *
 * A plan whose files are missing or corrupt never stands. It is recorded with
 * its `E_KIT_PIECES` cause and the parcels that are copies of it stay empty
 * lots, because one building the city cannot draw is not a reason to refuse the
 * rest of it.
 */
export class KitPieces {

	/**
	 * @param kit the world's plan index document
	 * @param baseUrl the shared store root its file paths are relative to
	 * @param readBinary reads one URL into an ArrayBuffer
	 * @param readJson reads one URL into a parsed document
	 */
	constructor( { kit, baseUrl, factory, loader = cityGltfLoader(), readBinary = fetchBinary, readJson = fetchJson } ) {

		/** plan id -> what the index publishes for it */
		this.index = new Map( kit.plans.map( ( plan ) => [ plan.id, plan ] ) );
		this.baseUrl = String( baseUrl ).replace( /\/+$/, '' );
		this.factory = factory;
		this.loader = loader;
		this.readBinary = readBinary;
		this.readJson = readJson;
		/** plan id -> its id, lot bays, surfaces, scenery and leaves, once it stands */
		this.plans = new Map();
		/** plan id -> the read still in flight, so a plan is read once for the city */
		this.reading = new Map();
		/** plan id -> why it will never stand */
		this.failures = new Map();
		this.batches = new MaterialBatches( 'kit-plans' );
		this.group = this.batches.group;

	}

	/** One draw per material, for the whole city. */
	get batchCount() {

		return this.batches.batchCount;

	}

	/** Whether this world's index names the plan at all. */
	published( planId ) {

		return this.index.has( planId );

	}

	/** Whether the plan is standing, which is what a copy of it needs. */
	has( planId ) {

		return this.plans.has( planId );

	}

	/** Why a published plan will never stand, or null while it still can. */
	failure( planId ) {

		return this.failures.get( planId ) ?? null;

	}

	/**
	 * Stands every plan these ids name, reading the ones this city has not read
	 * yet and waiting on the ones another cell is already reading.
	 *
	 * @returns when each of them is either standing or recorded as failed
	 */
	want( planIds ) {

		const wanted = [ ...new Set( planIds ) ]
			.filter( ( id ) => this.index.has( id ) && ! this.plans.has( id ) && ! this.failures.has( id ) );

		return mapConcurrent( wanted, LOAD_CONCURRENCY, ( id ) => this.#stand( id ) );

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

		this.batches.reserve( planIds.flatMap( ( id ) => {

			const plan = this.plans.get( id );

			return [ id, ...( plan?.leaves.length ? [ LEAVES( id ) ] : [] ), ...( plan?.scenery.length ? [ SCENERY( id ) ] : [] ) ];

		} ) );

	}

	/**
	 * Draws one more copy of a plan.
	 * @param swinging true when this parcel owns its entrance leaves as moving
	 *   pivots, so the shared copies of them stay out of the batches
	 * @param interior true when this parcel opens a real interior behind its
	 *   glass, so the plan's fake rooms stay out of the batches
	 * @returns one handle per copy, to hand back to `release`
	 */
	admit( planId, matrix, color, { swinging = false, interior = false } = {} ) {

		const plan = this.plans.get( planId );
		if ( ! plan ) throw this.failures.get( planId ) ?? pieceError( planId, 'the city has not read it' );

		const handle = this.batches.admit( planId, matrix, color );
		if ( ! swinging && plan.leaves.length ) handle.leaf = this.batches.admit( LEAVES( planId ), matrix, color );
		if ( ! interior && plan.scenery.length ) handle.scenery = this.batches.admit( SCENERY( planId ), matrix, color );

		return handle;

	}

	release( handle ) {

		this.batches.release( handle );
		if ( handle.leaf ) this.batches.release( handle.leaf );
		if ( handle.scenery ) this.batches.release( handle.scenery );

	}

	dispose() {

		this.batches.dispose();
		for ( const plan of this.plans.values() ) {

			for ( const { geometry } of [ ...plan.surfaces, ...plan.scenery ] ) geometry.dispose();
			for ( const leaf of plan.leaves ) for ( const { geometry } of leaf.surfaces ) geometry.dispose();

		}
		this.plans.clear();

	}

	/** One plan, read once however many cells ask for it at the same time. */
	#stand( planId ) {

		let reading = this.reading.get( planId );

		if ( ! reading ) {

			reading = this.#read( planId ).finally( () => this.reading.delete( planId ) );
			this.reading.set( planId, reading );

		}

		return reading;

	}

	async #read( planId ) {

		try {

			const plan = await readPlan( this.index.get( planId ), this );
			const entries = [ { id: plan.id, surfaces: plan.surfaces } ];

			if ( plan.leaves.length ) entries.push( { id: LEAVES( plan.id ), surfaces: plan.leaves.flatMap( ( leaf ) => leaf.surfaces ) } );
			if ( plan.scenery.length ) entries.push( { id: SCENERY( plan.id ), surfaces: plan.scenery } );
			this.batches.add( entries, { castShadow: true } );
			this.plans.set( planId, plan );

		} catch ( error ) {

			this.failures.set( planId, error.code === 'E_KIT_PIECES' ? error : pieceError( planId, error ) );

		}

	}

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
