import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { planAssembly } from '../../../../exterior/src/kit/index.ts';
import { AssemblyError } from '../RequestAssembler.js';
import { writeJsonFile } from '../JsonFile.js';
import { lotBays, piecesPerFloor } from './BayCount.js';
import { lotRectangle } from './LotRectangle.js';
import { chooseFamily } from './FamilyChoice.js';
import { schemaMessage, validateKitPlacements, validateKitRequest, validatePlacementPlan } from './KitSchemas.js';
import { blueprintFile, generatedFiles, placementsFile } from './KitFiles.js';

/**
 * One parcel, one placement table. Ordinary buildings are assembled from the
 * published piece kit instead of generated, so a city ships a few hundred
 * shared pieces and a small table per building instead of a unique shell each.
 *
 * Exterior plans in the parcel's own metres and hands back the same blueprint
 * a generated shell publishes, so everything downstream reads both the same
 * way: the streaming catalog, rooftop fitting and the game.
 */
export class KitAssembler {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param assembler the RequestAssembler both paths take their shared request fields from
	 * @param kit a loaded KitManifest
	 */
	constructor( atlas, assembler, kit ) {

		this.reasons = new Map();

		this.worldSeed = atlas.meta.seed;
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		this.assembler = assembler;
		this.kit = kit;

	}

	/**
	 * The kit building this parcel gets, or null when it keeps the generator:
	 * a landmark, a lot that is not a rectangle of whole bays, or no family
	 * that fits its height. Kit buildings have no basement, and link openings
	 * are not carved into pieces yet. `reasons` says why a parcel was skipped.
	 */
	candidate( parcelId ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) return this.#skip( parcelId, 'unknown parcel' );
		if ( parcel.landmark ) return this.#skip( parcelId, 'landmark' );

		const rectangle = lotRectangle( parcel.lot );

		if ( ! rectangle ) return this.#skip( parcelId, 'lot is not a rectangle' );

		const bays = lotBays( rectangle.width, rectangle.depth, this.kit.module );

		if ( ! bays ) return this.#skip( parcelId, 'lot is not whole bays' );

		let request = null;

		try {

			request = this.assembler.assemble( parcelId );

		} catch ( error ) {

			// An infeasible envelope is the generator path's failure to report.
			return this.#skip( parcelId, `envelope: ${error.message}` );

		}

		const fitting = this.kit.ids()
			.filter( ( id ) => this.kit.fitsLot( id, bays ) && this.#floors( id, parcel, request.building.floors ) );
		const family = chooseFamily( fitting, this.worldSeed, parcelId );

		if ( ! family ) return this.#skip( parcelId, 'no family fits the floors' );
		this.reasons.delete( parcelId );

		return {
			parcelId,
			family,
			bays,
			floors: this.#floors( family, parcel, request.building.floors ),
			signText: request.options.signage?.text ?? null,
			request: {
				family,
				buildingId: request.buildingId,
				// The published pieces were built with the kit's own seed, so the
				// table names exactly the files the game loads.
				seed: this.kit.seed,
				theme: request.theme,
				parcel: { ...request.parcel, footprint: rectangle.footprint },
				building: {
					type: request.building.type,
					tier: request.building.tier,
					floors: this.#floors( family, parcel, request.building.floors )
				}
			}
		};

	}

	/**
	 * Writes this parcel's placement table and its building blueprint, and drops
	 * the geometry of a generated shell that stood here before, so the folder
	 * holds one building and the world ships no dead GLB.
	 * @returns the placement table document
	 * @throws AssemblyError E_KIT_FIT | E_KIT_PLACEMENTS
	 */
	build( parcelId, parcelDir ) {

		const chosen = this.candidate( parcelId );

		if ( ! chosen ) throw new AssemblyError( 'E_KIT_FIT', `${parcelId}: no kit family fits this parcel` );

		const { blueprint, ...plan } = this.#plan( chosen );
		const document = this.#document( chosen, plan, blueprint );

		mkdirSync( parcelDir, { recursive: true } );
		for ( const name of generatedFiles( parcelId ) ) rmSync( join( parcelDir, name ), { force: true } );
		writeJsonFile( join( parcelDir, placementsFile( parcelId ) ), document );
		writeJsonFile( join( parcelDir, blueprintFile( parcelId ) ), blueprint );

		return document;

	}

	#skip( parcelId, reason ) {

		this.reasons.set( parcelId, reason );
		return null;

	}

	/** The floor count a family can stand on this parcel, or null when none can. */
	#floors( family, parcel, wanted ) {

		const range = this.kit.fitsFloors( family, parcel.envelope.maxHeight );

		if ( ! range ) return null;

		const max = Math.min( range.max, parcel.envelope.maxFloors );

		return max >= range.min ? Math.min( Math.max( wanted, range.min ), max ) : null;

	}

	/** Exterior's plan for one building, checked against both published schemas. */
	#plan( { parcelId, bays, floors, request } ) {

		const invalid = validateKitRequest( request );

		if ( invalid.length ) {

			throw new AssemblyError( 'E_KIT_FIT', `${parcelId}: kit request: ${schemaMessage( invalid )}` );

		}

		let plan = null;

		try {

			plan = planAssembly( request );

		} catch ( error ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: ${error.code ?? error.name}: ${error.message}` );

		}

		const errors = validatePlacementPlan( plan );

		if ( errors.length ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: placement schema: ${schemaMessage( errors )}` );

		}

		if ( plan.placements.length !== floors * piecesPerFloor( bays ) ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS',
				`${parcelId}: ${plan.placements.length} pieces do not tile ${bays.across} by ${bays.deep} bays over ${floors} floors` );

		}

		return plan;

	}

	#document( { parcelId, family, bays, floors, signText, request }, plan, blueprint ) {

		const ring = blueprint.bounds.footprint;
		const xs = ring.map( ( point ) => point[ 0 ] );
		const zs = ring.map( ( point ) => point[ 1 ] );
		const document = {
			parcel: parcelId,
			family,
			baysAcross: bays.across,
			baysDeep: bays.deep,
			floors,
			signText,
			lot: request.parcel.footprint,
			bounds: {
				min: [ Math.min( ...xs ), 0, Math.min( ...zs ) ],
				max: [ Math.max( ...xs ), blueprint.bounds.height, Math.max( ...zs ) ]
			},
			plan
		};
		const errors = validateKitPlacements( document );

		if ( errors.length ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: placement table: ${schemaMessage( errors )}` );

		}

		return document;

	}

}
