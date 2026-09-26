import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AssemblyError } from '../RequestAssembler.js';
import { writeJsonFile, sha256 } from '../JsonFile.js';
import { markUsed, share, sharedPath, sharedRoot, STAGING } from '../SharedResources.js';
import { dressingClass, drawnAs, lettered } from './DressingClass.js';
import { BAY, PITCH } from './Families.js';
import { PLAN_INDEX_FILE, planBlueprintFile, planGlbFile, PLANS_KIND } from './KitFiles.js';
import { schemaMessage, validatePlanIndex } from './KitSchemas.js';

/** The theme every ordinary building is dressed in. */
const THEME = 'cyberpunk';
/** A plan is a building, not a city, so its seed is its own and never a world's. */
const PLAN_SEED = 'plans';
/** Room above the storeys so the generator can pitch a taller ground floor. */
const HEADROOM = 6;
/** The shape of the sign field a business carries, which the city letters. */
/** Letter cells of the blank marquee a business plan carries over its entrance; the parcel's word is lettered on it at runtime. */
const SIGN_CELLS = 10;
const ID = /^(.+?)-(?:([a-z_]+)-([a-z_]+)-)?(\d+)x(\d+)x(\d+)f$/;

/**
 * The distinct buildings a city has, each generated once.
 *
 * A parcel used to ship its own shell, which is the same building over and over:
 * a 1 km city is hundreds of copies of a hundred or so buildings. So the unit of
 * repetition is the whole building. A plan is a family, a bay count across and
 * deep, a floor count and the programme it is dressed for; Exterior generates it
 * once on a canonical lot at the origin with face 0 along +X, and every parcel
 * of that plan carries the frame it stands in and nothing else.
 *
 * A plan's bytes are the same for every city built from the same Exterior, so
 * they stand in the shared store under the hash of what they are, and a second
 * city built tonight redraws none of them.
 */
export class PlanLibrary {

	/**
	 * @param workers ExteriorWorkers, which generate the shells
	 * @param version the Exterior package version the shells are drawn by
	 * @param stage a scratch directory shells are generated into before sharing
	 */
	constructor( { workers, version = exteriorVersion(), seed = PLAN_SEED, stage = join( sharedRoot(), STAGING ) } ) {

		this.workers = workers;
		this.version = version;
		this.seed = seed;
		this.stage = stage;
		/** plan id -> plan record */
		this.plans = new Map();
		/** plan id -> its blueprint, in the plan's own frame */
		this.blueprints = new Map();
		/** plan id -> why it could not be drawn */
		this.failures = new Map();

	}

	get size() {

		return this.plans.size;

	}

	/**
	 * Registers the plan one parcel stands from, drawn later with all the others.
	 * @param family an approved family id, or null for Exterior's ordinary output
	 * @param use the `{ type, tier }` of the parcel standing on it, which decides
	 * the [dressing class](DressingClass.js) the building is drawn for; the
	 * family's own when a caller wants the plain shared building
	 */
	want( family, bays, floors, use = programmeOf( family ) ) {

		const id = planId( family, bays, floors, dressingClass( use ) );
		const held = this.plans.get( id );

		if ( held ) return held;

		const plan = { id, ...this.#place( id ) };

		this.plans.set( id, plan );

		return plan;

	}

	/** The blueprint of one plan, in the plan's own frame. */
	blueprint( id ) {

		return this.blueprints.get( id ) ?? null;

	}

	/** Where one plan's shell and blueprint stand, for any id this Exterior draws. */
	folder( id ) {

		return join( sharedRoot(), this.#place( id ).shared );

	}

	/** Where one plan's blueprint stands on disk. */
	blueprintPath( id ) {

		return join( this.folder( id ), planBlueprintFile( id ) );

	}

	/**
	 * Draws every registered plan that is not in the shared store already, all of
	 * them at once across the workers, and reads back each one's blueprint.
	 * @returns { drawn, reused, failed, ms }
	 */
	async draw() {

		const started = performance.now();
		const pending = [ ...this.plans.values() ];
		let reused = 0;
		let drawn = 0;

		await Promise.all( pending.map( async ( plan ) => {

			try {

				// Marked first, so a sweep beside this batch spares it from here on.
				if ( markUsed( join( sharedRoot(), plan.shared ) ) && standing( plan ) ) reused ++;
				else {

					await this.#generate( plan );
					drawn ++;

				}

				this.blueprints.set( plan.id, JSON.parse( readFileSync( this.blueprintPath( plan.id ), 'utf8' ) ) );

			} catch ( error ) {

				this.failures.set( plan.id, `${error.code ?? 'ERROR'}: ${error.message}` );
				this.plans.delete( plan.id );

			}

		} ) );

		return { drawn, reused, failed: this.failures.size, ms: Math.round( performance.now() - started ) };

	}

	/** How many bytes the plans this world stands on take in the shared store. */
	bytes( used = [ ...this.plans.keys() ] ) {

		return used.reduce( ( total, id ) => total
			+ statSync( join( this.folder( id ), planGlbFile( id ) ) ).size
			+ statSync( this.blueprintPath( id ) ).size, 0 );

	}

	/**
	 * Publishes the index of the plans this world stands on, in the shared store
	 * beside them, and returns the reference its manifest binds.
	 * @param used every plan id the world's kit parcels name
	 * @throws AssemblyError E_KIT_PLANS when a standing parcel names a plan whose
	 * shell the store does not hold
	 */
	publish( used = [ ...this.plans.keys() ] ) {

		const ids = [ ...used ].sort();
		const plans = ids.map( ( id ) => this.#entry( id ) );
		const missing = ids.filter( ( id, at ) => ! plans[ at ] );

		if ( missing.length ) {

			throw new AssemblyError( 'E_KIT_PLANS',
				`${missing.length} buildings name plans this store does not hold: ${missing.join( ', ' )}` );

		}

		const index = { version: 1, exterior: this.version, seed: this.seed, plans };
		const errors = validatePlanIndex( index );

		if ( errors.length ) throw new AssemblyError( 'E_KIT_PLANS', `plan index: ${schemaMessage( errors )}` );

		const directory = join( this.stage, 'plan-index' );

		rmSync( directory, { recursive: true, force: true } );
		mkdirSync( directory, { recursive: true } );
		const file = join( directory, PLAN_INDEX_FILE );
		writeJsonFile( file, index );
		const hash = sha256( readFileSync( file ) );

		return { file: PLAN_INDEX_FILE, sha256: hash, shared: share( 'kit', hash, directory, { move: true } ) };

	}

	/**
	 * What a plan is: the request that draws it and the Exterior that draws it,
	 * hashed together, so a change to either one is a new set of bytes rather
	 * than a stale shell reused.
	 */
	#place( id ) {

		const { family, programme, tier, bays, floors } = planParts( id );
		const parts = { id, family, programme, tier, baysAcross: bays.across, baysDeep: bays.deep, floors };
		const request = this.#request( parts );
		const hash = createHash( 'sha256' )
			.update( JSON.stringify( { request, exterior: this.version } ) ).digest( 'hex' );

		return { ...parts, request, hash, shared: sharedPath( PLANS_KIND, hash ) };

	}

	/** One plan as the world's index names it, or null when its shell is missing. */
	#entry( id ) {

		const place = this.#place( id );

		if ( ! markUsed( join( sharedRoot(), place.shared ) ) || ! standing( place ) ) return null;

		const glb = join( this.folder( id ), planGlbFile( id ) );

		return {
			id, family: place.family,
			baysAcross: place.baysAcross, baysDeep: place.baysDeep, floors: place.floors,
			glb: `${place.shared}/${planGlbFile( id )}`,
			blueprint: `${place.shared}/${planBlueprintFile( id )}`,
			bytes: statSync( glb ).size,
			sha256: sha256( readFileSync( glb ) )
		};

	}

	/** One shell, generated into a scratch folder and moved into the store whole. */
	async #generate( plan ) {

		const directory = join( this.stage, plan.hash );

		rmSync( directory, { recursive: true, force: true } );
		await this.workers.run( plan.request, directory );
		share( PLANS_KIND, plan.hash, directory, { move: true } );

	}

	#request( { id, family, programme, tier, baysAcross, baysDeep, floors } ) {

		const width = baysAcross * BAY;
		const depth = baysDeep * BAY;

		return {
			seed: `${this.seed}:${id}`,
			buildingId: id,
			parcel: {
				footprint: [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ],
				// Face 0 is the street side of every plan; the parcel's frame turns it.
				accessPoint: [ width / 2, 0 ],
				maxHeight: floors * PITCH + HEADROOM
			},
			building: { type: drawnAs( programme ), tier, floors },
			theme: THEME,
			// A plan with no family is the generator's own building, on the plain
			// rectangular plate every copy of it stands on. A business carries an
			// empty sign field and never a word: one building stands on many lots,
			// so the city letters each parcel's own word on it at draw time.
			options: {
				glb: 'merged',
				...( family ? { architecture: family } : {} ),
				...( lettered( programme ) ? { signage: { mode: 'marquee', cells: SIGN_CELLS } } : {} )
			}
		};

	}

}

/**
 * What a plan is named after: everything that decides what is drawn. The
 * dressing class is in the name only when it is not the family's own, so the
 * shared building of a family keeps the short name.
 */
function planId( family, { across, deep }, floors, { programme, tier } ) {

	const own = dressingClass( programmeOf( family ) );
	const dressing = programme === own.programme && tier === own.tier ? '' : `${programme}-${tier}-`;

	return `${family ?? 'plain'}-${dressing}${across}x${deep}x${floors}f`;

}

/** And all of it back out of the name, so any id resolves to its bytes. */
function planParts( id ) {

	const found = ID.exec( id );

	if ( ! found ) throw new AssemblyError( 'E_KIT_PLANS', `${id} is not a plan id` );

	const family = found[ 1 ] === 'plain' ? null : found[ 1 ];
	const own = dressingClass( programmeOf( family ) );

	return {
		family,
		programme: found[ 2 ] ?? own.programme,
		tier: found[ 3 ] ?? own.tier,
		bays: { across: Number( found[ 4 ] ), deep: Number( found[ 5 ] ) },
		floors: Number( found[ 6 ] )
	};

}

/** The programme a family's own shared building is drawn for. */
function programmeOf( family ) {

	if ( ! family ) return { type: 'residential', tier: 'mid' };

	return family === 'corporate-sectors'
		? { type: 'corpo', tier: 'high_rich' }
		: { type: 'residential', tier: 'high_rich' };

}

/** Whether this plan's shell and blueprint already stand in the store. */
function standing( { id, shared } ) {

	const at = ( name ) => join( sharedRoot(), shared, name );

	return existsSync( at( planGlbFile( id ) ) ) && existsSync( at( planBlueprintFile( id ) ) );

}

/** Which Exterior drew a plan, so a new generator never reuses an old shell. */
function exteriorVersion() {

	const file = fileURLToPath( new URL( '../../../../exterior/package.json', import.meta.url ) );

	return JSON.parse( readFileSync( file, 'utf8' ) ).version;

}

/**
 * Which Exterior drew the plans a world already stands on, read from the plan
 * index its manifest binds, or null for a world that has no kit buildings yet.
 * @param outDir the world's directory
 */
export function worldExteriorVersion( outDir ) {

	const manifest = join( outDir, 'manifest.json' );
	if ( ! existsSync( manifest ) ) return null;

	const { kit } = JSON.parse( readFileSync( manifest, 'utf8' ) );
	const index = kit?.shared ? join( sharedRoot(), kit.shared, PLAN_INDEX_FILE ) : null;

	return index && existsSync( index ) ? JSON.parse( readFileSync( index, 'utf8' ) ).exterior ?? null : null;

}
