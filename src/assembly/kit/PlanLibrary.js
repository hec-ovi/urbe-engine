import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyError } from '../RequestAssembler.js';
import { writeJsonFile } from '../JsonFile.js';
import { planBlueprintFile, planFile, PLANS_FOLDER } from './KitFiles.js';
import { packPlanBlueprint } from './PlanBlueprint.js';
import { planFrom } from './KitPlanning.js';
import { schemaMessage, validateKitPlan } from './KitSchemas.js';

/** The theme every ordinary building is dressed in. */
const THEME = 'cyberpunk';
/** The type and tier a plan is drawn for; neither moves a piece. */
const PLAN_BUILDING = { type: 'residential', tier: 'rich' };

/**
 * The buildings a city actually has, each planned once.
 *
 * Every parcel used to ship Exterior's whole placement plan, which is the same
 * few hundred pieces over and over: a 3 x 3 km city is thousands of copies of a
 * few dozen buildings. So a plan is drawn once per distinct family, bay count
 * and floor count, at the world origin with face 0 running along +X, and every
 * parcel carries only the id of its plan and the frame it stands in. The
 * runtime composes one world matrix per piece out of the two.
 */
export class PlanLibrary {

	/**
	 * @param kit a loaded KitManifest; its own seed names the published pieces
	 * @param buildingGrid the city's construction lattice, which is where the
	 * room envelope behind the facade is fitted; a plan is fitted on the same
	 * lattice as the parcels it stands on
	 */
	constructor( kit, buildingGrid = null ) {

		this.kit = kit;
		this.buildingGrid = buildingGrid;
		this.plans = new Map();
		this.blueprints = new Map();

	}

	/** Every plan this city uses, by id. */
	get size() {

		return this.plans.size;

	}

	/**
	 * The plan for one building, drawn the first time it is asked for.
	 * @throws AssemblyError E_KIT_FIT | E_KIT_PLACEMENTS
	 */
	plan( family, bays, floors ) {

		const id = planId( family, bays, floors );
		const held = this.plans.get( id );

		if ( held ) return held;

		const { document, blueprint } = this.#draw( id, family, bays, floors );

		this.plans.set( id, document );
		this.blueprints.set( id, blueprint );

		return document;

	}

	/** The blueprint of one plan, in the plan's own frame. */
	blueprint( id ) {

		return this.blueprints.get( id ) ?? null;

	}

	/** The height a family's bands reach at this floor count. */
	height( family, floors ) {

		const { bands } = this.kit.family( family );

		return bands.ground.height + ( floors - 2 ) * bands.middle.height + bands.crown.height;

	}

	/**
	 * Writes the plans this run drew under `<out>/kit/plans/` and drops the ones
	 * no standing building names any more, so the folder holds exactly the
	 * buildings the world has. A partial run keeps the plans it did not redraw.
	 * @param used every plan id the world's kit parcels name
	 * @param composed the plans whose parcels read their blueprint from here; a
	 * parcel an earlier run left a blueprint of its own keeps reading that one,
	 * so a run that redraws part of a city does not have to redraw every plan
	 * @returns the used ids, sorted
	 * @throws AssemblyError E_KIT_PLACEMENTS when a standing parcel names a plan
	 * this out dir does not hold
	 */
	publish( outDir, used = new Set( this.plans.keys() ), composed = used ) {

		const directory = join( outDir, PLANS_FOLDER );

		mkdirSync( directory, { recursive: true } );
		for ( const [ id, plan ] of this.plans ) {

			writeJsonFile( join( directory, planFile( id ) ), plan );
			writeJsonFile( join( directory, planBlueprintFile( id ) ), this.blueprints.get( id ) );

		}
		for ( const name of readdirSync( directory ) ) {

			if ( ! used.has( name.replace( /(\.blueprint)?\.json$/, '' ) ) ) rmSync( join( directory, name ), { force: true } );

		}

		const missing = [ ...used ].filter( ( id ) => ! existsSync( join( directory, planFile( id ) ) )
			|| ( composed.has( id ) && ! existsSync( join( directory, planBlueprintFile( id ) ) ) ) );

		if ( missing.length ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${missing.length} buildings name plans this world does not hold: ${missing.join( ', ' )}` );

		}

		return [ ...used ].sort();

	}

	#draw( id, family, bays, floors ) {

		const request = {
			family,
			buildingId: id,
			// The published pieces were built with the kit's own seed, so the plan
			// names exactly the files the game loads.
			seed: this.kit.seed,
			theme: THEME,
			parcel: {
				footprint: rectangle( bays.across * this.kit.module.bay, bays.deep * this.kit.module.bay ),
				accessPoint: [ bays.across * this.kit.module.bay / 2, 0 ],
				maxHeight: this.height( family, floors ),
				...( this.buildingGrid ? { buildingGrid: this.buildingGrid } : {} )
			},
			building: { ...PLAN_BUILDING, floors },
			// Face 0 is the street side of every plan; the parcel's frame turns it.
			entranceEdge: 0
		};
		const { blueprint, ...plan } = planFrom( request, { id, bays, floors } );

		// A plan is read thousands of times and written once, so it names each
		// piece file once and every copy by its index.
		const pieces = [ ...new Set( plan.placements.map( ( piece ) => piece.piece ) ) ];
		const document = {
			id, family: plan.family, baysAcross: bays.across, baysDeep: bays.deep, floors,
			bands: plan.bands,
			pieces,
			placements: plan.placements.map( ( { piece, face, position, rotationY } ) => ( {
				piece: pieces.indexOf( piece ), face, position, rotationY
			} ) ),
			signAnchors: plan.signAnchors, doors: plan.doors
		};
		const invalidPlan = validateKitPlan( document );

		if ( invalidPlan.length ) throw new AssemblyError( 'E_KIT_PLACEMENTS', `${id}: plan document: ${schemaMessage( invalidPlan )}` );

		return { document, blueprint: packPlanBlueprint( blueprint ) };

	}

}

/** What a plan is named after: the four things that decide where every piece goes. */
export function planId( family, { across, deep }, floors ) {

	return `${family}-${across}x${deep}x${floors}f`;

}

/** A lot rectangle at the origin, wound the way Exterior reads a footprint. */
function rectangle( width, depth ) {

	return [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ];

}

/** One piece copy as the world sees it, to the millimetre a plan is written in. */
function copyKey( piece, position, rotationY ) {

	const turn = ( ( rotationY % ( Math.PI * 2 ) ) + Math.PI * 2 ) % ( Math.PI * 2 );

	return `${piece}|${position.map( ( value ) => value.toFixed( 5 ) ).join( ',' )}|${turn.toFixed( 5 )}`;

}

/**
 * Whether a plan placed in this frame stands exactly where Exterior planned the
 * same building on the parcel itself. The two are one building described twice:
 * the plan starts at its entrance face, the parcel plan at the lot's first
 * corner, so they agree on the copies and not on their order. A silent drift
 * between them would move every piece of every building that shares the plan.
 */
export function placesAs( plan, frame, planned ) {

	if ( plan.placements.length !== planned.placements.length ) return false;

	const cos = Math.cos( frame.rotationY );
	const sin = Math.sin( frame.rotationY );
	const placed = plan.placements.map( ( { piece, position: [ x, y, z ], rotationY } ) => copyKey( plan.pieces[ piece ], [
		frame.origin[ 0 ] + x * cos + z * sin,
		frame.origin[ 1 ] + y,
		frame.origin[ 2 ] - x * sin + z * cos
	], frame.rotationY + rotationY ) ).sort();
	const wanted = planned.placements
		.map( ( { piece, position, rotationY } ) => copyKey( piece, position, rotationY ) ).sort();

	return placed.every( ( key, index ) => key === wanted[ index ] );

}
