import { FrameBudget } from '../../../app/FrameBudget.js';
import { HitchLog } from '../../debug/HitchLog.js';
import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { ReadBudget } from '../../data/ReadBudget.js';
import { MaterialBatches } from './MaterialBatches.js';
import { decodePlan, pieceError, readPlanFile } from './PlanFile.js';

/** Plan files in flight at once, over every cell asking for one. */
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
 * plan's files are read the first time a cell that stands on it opens, through
 * `fetch`, and decoded and merged into the draws when that cell is built,
 * through `want`.
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
	 * @param blueprints the city's [plan blueprints](../../data/PlanBlueprints.js)
	 * @param slice the frame budget decoding a plan is paced by
	 * @param hitches the log each step of standing a plan is named in
	 * @param readBinary reads one URL into an ArrayBuffer
	 */
	constructor( { kit, baseUrl, factory, blueprints, slice = new FrameBudget( { paced: false } ), hitches = new HitchLog(), loader = cityGltfLoader(), readBinary = fetchBinary } ) {

		/** plan id -> what the index publishes for it */
		this.index = new Map( kit.plans.map( ( plan ) => [ plan.id, plan ] ) );
		this.baseUrl = String( baseUrl ).replace( /\/+$/, '' );
		this.factory = factory;
		this.loader = loader;
		this.blueprints = blueprints;
		this.slice = slice;
		this.hitches = hitches;
		this.readBinary = readBinary;
		/** plan id -> its id, lot bays, surfaces, scenery and leaves, once it stands */
		this.plans = new Map();
		/** plan id -> its file, read and checked, until the decode consumes it */
		this.files = new Map();
		/** plan id -> the decode in flight, so a plan stands once for the city */
		this.reading = new Map();
		/** plan id -> why it will never stand */
		this.failures = new Map();
		// Cells read ahead of the one being built, so the plans asked for first
		// are the ones read first.
		this.budget = new ReadBudget( LOAD_CONCURRENCY );
		this.batches = new MaterialBatches( 'kit-plans', { hitches } );
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
	 * The files these plans are published as, in hand and checked.
	 *
	 * Reading is the one part of standing a plan that is not work for the main
	 * thread, so this is what a stream opening a cell ahead of the one it is
	 * building asks for. It never rejects: a file that does not arrive is a
	 * plan that will not stand, which `want` reports when that cell is built.
	 */
	fetch( planIds ) {

		return Promise.all( this.#pending( planIds ).map( ( id ) => this.#file( id ).catch( () => null ) ) );

	}

	/**
	 * Stands every plan these ids name: their files in hand, decoded and merged
	 * into the draws. The files are read for all of them at once and decoded one
	 * at a time under the frame budget, because decoding is the main thread.
	 *
	 * @returns when each of them is either standing or recorded as failed
	 */
	async want( planIds ) {

		const wanted = this.#pending( planIds );

		for ( const id of wanted ) this.#file( id ).catch( () => null );
		for ( const id of wanted ) {

			await this.slice.step();
			await this.#stand( id );

		}

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
		this.files.clear();
		for ( const plan of this.plans.values() ) {

			for ( const { geometry } of [ ...plan.surfaces, ...plan.scenery ] ) geometry.dispose();
			for ( const leaf of plan.leaves ) for ( const { geometry } of leaf.surfaces ) geometry.dispose();

		}
		this.plans.clear();

	}

	/** The plans these ids name that could still stand. */
	#pending( planIds ) {

		return [ ...new Set( planIds ) ]
			.filter( ( id ) => this.index.has( id ) && ! this.plans.has( id ) && ! this.failures.has( id ) );

	}

	/** One plan's file, read once however many cells ask for it at the same time. */
	#file( planId ) {

		let reading = this.files.get( planId );

		if ( ! reading ) {

			reading = this.budget.run( () => readPlanFile( this.index.get( planId ), this ) );
			this.files.set( planId, reading );

		}

		return reading;

	}

	/** One plan, decoded once however many cells ask for it at the same time. */
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

			const plan = await decodePlan( this.index.get( planId ), await this.#file( planId ), this );
			const entries = [ { id: plan.id, surfaces: plan.surfaces } ];

			if ( plan.leaves.length ) entries.push( { id: LEAVES( plan.id ), surfaces: plan.leaves.flatMap( ( leaf ) => leaf.surfaces ) } );
			if ( plan.scenery.length ) entries.push( { id: SCENERY( plan.id ), surfaces: plan.scenery } );
			this.hitches.time( 'plan batches', () => this.batches.add( entries, { castShadow: true } ) );
			this.plans.set( planId, plan );

		} catch ( error ) {

			this.failures.set( planId, error.code === 'E_KIT_PIECES' ? error : pieceError( planId, error ) );

		}
		// The file is in the draws now, or it never will be; either way the city
		// no longer holds its bytes.
		this.files.delete( planId );

	}

}

async function fetchBinary( url ) {

	return ( await ok( url ) ).arrayBuffer();

}

async function ok( url ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );

	return response;

}
