import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyError } from '../RequestAssembler.js';
import { writeJsonFile } from '../JsonFile.js';
import { lotBays } from './BayCount.js';
import { lotRectangle } from './LotRectangle.js';
import { chooseFamily } from './FamilyChoice.js';
import { BlockTemplates } from './BlockTemplates.js';
import { TemplateDressing } from './TemplateDressing.js';
import { PlanLibrary, placesAs } from './PlanLibrary.js';
import { blueprintDrift, parcelBlueprint } from './PlanBlueprint.js';
import { planFrom } from './KitPlanning.js';
import { schemaMessage, validateKitPlacements } from './KitSchemas.js';
import { blueprintFile, generatedFiles, placementsFile } from './KitFiles.js';

const QUARTER = Math.PI / 2;

/**
 * One parcel, one placement record. Ordinary buildings are assembled from the
 * published piece kit instead of generated, so a city ships a few hundred
 * shared pieces, one plan per distinct building and a frame per parcel.
 *
 * A block Atlas tiled from a template is dressed by the template, so the city
 * repeats a handful of block designs with one variation each. A block Atlas
 * tiled on its own keeps the per-parcel choice.
 *
 * Exterior plans the parcel's own building so the record can be checked against
 * it: the pieces have to stand where the plan puts them, and the blueprint the
 * plan composes for this frame has to be the one Exterior drew here.
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
		this.templates = new BlockTemplates( atlas );
		this.dressing = new TemplateDressing( atlas, this.templates, kit );
		this.plans = new PlanLibrary( kit, atlas.meta.buildingGrid ?? null );

	}

	/**
	 * The parcel whose merged building covers this one, or null. A block's
	 * variation can join two adjacent lots into one rectangular building; the
	 * lot it took over stands empty and ships no files.
	 */
	absorbedBy( parcelId ) {

		return this.dressing.of( parcelId )?.absorbedBy ?? null;

	}

	/**
	 * The kit building this parcel gets, or null when it keeps the generator:
	 * a landmark, a lot that is not a rectangle of whole bays, a lot a merge
	 * took over, or no family that fits it. Kit buildings have no basement, and
	 * link openings are not carved into pieces yet. `reasons` says why a parcel
	 * was skipped.
	 */
	candidate( parcelId ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) return this.#skip( parcelId, 'unknown parcel' );
		if ( parcel.landmark ) return this.#skip( parcelId, 'landmark' );

		const dressed = this.dressing.of( parcelId );

		if ( dressed?.absorbedBy ) return this.#skip( parcelId, `merged into ${dressed.absorbedBy}` );

		const rectangle = lotRectangle( dressed?.lot ?? parcel.lot );

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

		const dressing = dressed ?? this.#perParcel( parcelId, parcel, bays, request.building.floors );

		if ( ! dressing ) return this.#skip( parcelId, 'no family fits the floors' );
		this.reasons.delete( parcelId );

		return {
			parcelId,
			family: dressing.family,
			floors: dressing.floors,
			bays,
			footprint: rectangle.footprint,
			signText: request.options.signage?.text ?? null,
			absorbs: dressed?.absorbs ?? null,
			templated: Boolean( dressed ),
			request: {
				family: dressing.family,
				buildingId: request.buildingId,
				// The published pieces were built with the kit's own seed, so the
				// blueprint names exactly the files the game loads.
				seed: this.kit.seed,
				theme: request.theme,
				parcel: {
					...request.parcel,
					footprint: rectangle.footprint,
					maxHeight: this.plans.height( dressing.family, dressing.floors )
				},
				building: {
					type: request.building.type,
					tier: request.building.tier,
					floors: dressing.floors
				}
			}
		};

	}

	/**
	 * Writes this parcel's placement record and drops whatever a generated shell
	 * left here before, so the folder holds one building and the world ships no
	 * dead geometry. The blueprint stays with the plan: this parcel's is the
	 * plan's document in the frame below, which is checked here against the one
	 * Exterior draws for the parcel itself.
	 * @returns the placement record
	 * @throws AssemblyError E_KIT_FIT | E_KIT_PLACEMENTS
	 */
	build( parcelId, parcelDir ) {

		const chosen = this.candidate( parcelId );

		if ( ! chosen ) throw new AssemblyError( 'E_KIT_FIT', `${parcelId}: ${this.reasons.get( parcelId ) ?? 'no kit family fits this parcel'}` );

		// Exterior plans this exact parcel: the blueprint everything downstream
		// reads, and the pieces the plan the record names has to stand as.
		const { blueprint, ...planned } = planFrom( chosen.request,
			{ id: parcelId, bays: chosen.bays, floors: chosen.floors } );
		const frame = this.#frame( chosen, planned );
		const plan = this.plans.plan( chosen.family, frame.bays, chosen.floors );

		if ( ! placesAs( plan, frame, planned ) ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: plan ${plan.id} does not stand where this parcel was planned` );

		}

		const document = this.#document( chosen, plan, frame, blueprint );
		const drift = blueprintDrift( parcelBlueprint( this.plans.blueprint( plan.id ), document ), blueprint );

		if ( drift ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: plan ${plan.id} composes a different building at ${drift}` );

		}

		mkdirSync( parcelDir, { recursive: true } );
		for ( const name of generatedFiles( parcelId ) ) rmSync( join( parcelDir, name ), { force: true } );
		rmSync( join( parcelDir, blueprintFile( parcelId ) ), { force: true } );
		writeJsonFile( join( parcelDir, placementsFile( parcelId ) ), document );

		return document;

	}

	#skip( parcelId, reason ) {

		this.reasons.set( parcelId, reason );
		return null;

	}

	/** What a parcel on an untiled block wears: its own family and its own floors. */
	#perParcel( parcelId, parcel, bays, wanted ) {

		const fitting = this.kit.ids()
			.filter( ( id ) => this.kit.fitsLot( id, bays ) && this.#floors( id, parcel, wanted ) );
		const family = chooseFamily( fitting, this.worldSeed, parcelId );

		return family ? { family, floors: this.#floors( family, parcel, wanted ) } : null;

	}

	/**
	 * The floor count a family can stand on this parcel, or null when none can.
	 * The floor minimum is the published family's own; the kit states how short
	 * its bands can stand and the parcel envelope states how tall.
	 */
	#floors( family, parcel, wanted ) {

		const range = this.kit.fitsFloors( family, parcel.envelope.maxHeight );

		if ( ! range ) return null;

		const max = Math.min( range.max, parcel.envelope.maxFloors );

		return max >= range.min ? Math.min( Math.max( wanted, range.min ), max ) : null;

	}

	/**
	 * Where the plan stands: its origin is the lot corner the entrance face runs
	 * from, and its face 0 is that face, so one plan serves every parcel of the
	 * same building whichever street it fronts.
	 */
	#frame( { footprint, bays }, planned ) {

		const face = entranceFace( planned );
		const from = footprint[ face ];
		const to = footprint[ ( face + 1 ) % 4 ];
		const turn = Math.atan2( - ( to[ 1 ] - from[ 1 ] ), to[ 0 ] - from[ 0 ] ) / QUARTER;

		return {
			face,
			origin: [ from[ 0 ], 0, from[ 1 ] ],
			// Lot edges turn by exact quarters; keep the frame exact too.
			rotationY: Math.round( turn ) * QUARTER,
			bays: face % 2 === 0 ? bays : { across: bays.deep, deep: bays.across }
		};

	}

	#document( { parcelId, family, floors, signText, absorbs }, plan, frame, blueprint ) {


		const ring = blueprint.bounds.footprint;
		const xs = ring.map( ( point ) => point[ 0 ] );
		const zs = ring.map( ( point ) => point[ 1 ] );
		const document = {
			parcel: parcelId,
			plan: plan.id,
			origin: frame.origin,
			rotationY: frame.rotationY,
			face: frame.face,
			lot: this.parcels.get( parcelId ).lot,
			bounds: {
				min: [ Math.min( ...xs ), 0, Math.min( ...zs ) ],
				max: [ Math.max( ...xs ), blueprint.bounds.height, Math.max( ...zs ) ]
			},
			signText,
			family,
			floors,
			// What the parcel is used for, which its own type and tier decide and
			// the shared plan cannot say.
			floorKinds: blueprint.floors.map( ( floor ) => floor.kind ),
			exteriorStyle: blueprint.facade.exteriorStyle,
			tint: parcelId,
			...( absorbs ? { absorbs } : {} )
		};
		const errors = validateKitPlacements( document );

		if ( errors.length ) {

			throw new AssemblyError( 'E_KIT_PLACEMENTS', `${parcelId}: placement record: ${schemaMessage( errors )}` );

		}

		return document;

	}

}

/** Which lot face the entrance bay sits in; Exterior picks it from the street access. */
function entranceFace( planned ) {

	const entrance = planned.placements.find( ( piece ) => piece.piece.endsWith( '/entrance-bay' ) );

	return entrance?.face ?? planned.placements[ planned.doors?.[ 0 ]?.placement ]?.face ?? 0;

}
