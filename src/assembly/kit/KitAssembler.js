import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyError } from '../RequestAssembler.js';
import { writeJsonFile } from '../JsonFile.js';
import { lotBays } from './BayCount.js';
import { lotRectangle } from './LotRectangle.js';
import { chooseFamily } from './FamilyChoice.js';
import { MIN_FLOORS, fittingFamilies } from './Families.js';
import { BlockTemplates } from './BlockTemplates.js';
import { TemplateDressing } from './TemplateDressing.js';
import { PlanFrame } from './PlanBlueprint.js';
import { schemaMessage, validateKitPlacements } from './KitSchemas.js';
import { blueprintFile, generatedFiles, placementsFile } from './KitFiles.js';

const QUARTER = Math.PI / 2;
/** What a storey costs in height, which is what caps a lot's floor count. */
const PITCH = 4.5;

/**
 * One parcel, one placement record.
 *
 * An ordinary building is not generated per parcel: it is the plan it stands
 * from, generated once for the whole city, plus the frame it stands in. So this
 * decides what each parcel is (which family, how many floors, which lot face
 * its entrance takes), registers that plan, and once the plans are drawn writes
 * a record of well under a kilobyte.
 *
 * A block Atlas tiled from a template is dressed by the template, so the city
 * repeats a handful of block designs with one variation each. A block Atlas
 * tiled on its own keeps the per-parcel choice.
 */
export class KitAssembler {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param assembler the RequestAssembler both paths take their shared request fields from
	 * @param plans the PlanLibrary this city's buildings are drawn into
	 */
	constructor( atlas, assembler, plans ) {

		this.reasons = new Map();
		/** parcelId -> what it builds, decided once */
		this.chosen = new Map();

		this.worldSeed = atlas.meta.seed;
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		this.assembler = assembler;
		this.plans = plans;
		this.templates = new BlockTemplates( atlas );
		this.dressing = new TemplateDressing( atlas, this.templates );

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
	 * The kit building this parcel gets, or null when it keeps the generator: a
	 * landmark, a lot that is not a rectangle of whole bays, a lot a merge took
	 * over, or an envelope no shared building fits. `reasons` says why a parcel
	 * was skipped.
	 */
	candidate( parcelId ) {

		if ( this.chosen.has( parcelId ) ) return this.chosen.get( parcelId );

		const decided = this.#decide( parcelId );

		this.chosen.set( parcelId, decided );

		return decided;

	}

	#decide( parcelId ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) return this.#skip( parcelId, 'unknown parcel' );
		if ( parcel.landmark ) return this.#skip( parcelId, 'landmark' );

		const dressed = this.dressing.of( parcelId );

		if ( dressed?.absorbedBy ) return this.#skip( parcelId, `merged into ${dressed.absorbedBy}` );

		const rectangle = lotRectangle( dressed?.lot ?? parcel.lot );

		if ( ! rectangle ) return this.#skip( parcelId, 'lot is not a rectangle' );

		const bays = lotBays( rectangle.width, rectangle.depth );

		if ( ! bays ) return this.#skip( parcelId, 'lot is not whole bays' );

		let request = null;

		try {

			request = this.assembler.assemble( parcelId );

		} catch ( error ) {

			// An infeasible envelope is the generator path's failure to report.
			return this.#skip( parcelId, `envelope: ${error.message}` );

		}

		const floors = dressed?.floors ?? this.#floors( parcel, request.building.floors );

		if ( ! floors ) return this.#skip( parcelId, 'envelope is shorter than a shared building' );
		this.reasons.delete( parcelId );

		const face = this.#entranceFace( rectangle.footprint, parcel.access.point );
		const oriented = face % 2 === 0 ? bays : { across: bays.deep, deep: bays.across };
		const family = dressed
			? dressed.family
			: chooseFamily( fittingFamilies( oriented, floors, parcel ), this.worldSeed, parcelId );

		return {
			parcelId,
			signText: request.options.signage?.text ?? null,
			absorbs: dressed?.absorbs ?? null,
			plan: this.plans.want( family, oriented, floors ),
			frame: this.#frame( rectangle.footprint, face )
		};

	}

	/**
	 * Writes this parcel's placement record and drops whatever a generated shell
	 * left here before, so the folder holds one building and the world ships no
	 * dead geometry. Its blueprint stays with the plan: this parcel's is that
	 * document in the frame below.
	 * @returns the placement record
	 * @throws AssemblyError E_KIT_FIT | E_KIT_PLANS
	 */
	build( parcelId, parcelDir ) {

		const chosen = this.candidate( parcelId );

		if ( ! chosen ) throw new AssemblyError( 'E_KIT_FIT', `${parcelId}: ${this.reasons.get( parcelId ) ?? 'no shared building fits this parcel'}` );

		const blueprint = this.plans.blueprint( chosen.plan.id );

		if ( ! blueprint ) throw new AssemblyError( 'E_KIT_PLANS', `${parcelId}: plan ${chosen.plan.id} was not drawn` );

		const document = this.#document( chosen, blueprint );

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

	/** How tall this parcel stands: what its request asked for, inside its envelope. */
	#floors( parcel, wanted ) {

		const max = Math.min( parcel.envelope.maxFloors, Math.floor( parcel.envelope.maxHeight / PITCH ) );

		return max >= MIN_FLOORS ? Math.min( Math.max( wanted, MIN_FLOORS ), max ) : null;

	}

	/** Which lot face the street reaches: the edge the access point stands nearest. */
	#entranceFace( footprint, access ) {

		let nearest = 0;
		let best = Infinity;

		for ( let face = 0; face < 4; face ++ ) {

			const distance = toSegment( access, footprint[ face ], footprint[ ( face + 1 ) % 4 ] );

			if ( distance < best ) {

				best = distance;
				nearest = face;

			}

		}

		return nearest;

	}

	/**
	 * Where the plan stands: its origin is the lot corner the entrance face runs
	 * from, and its face 0 is that face, so one plan serves every parcel of the
	 * same building whichever street it fronts.
	 */
	#frame( footprint, face ) {

		const from = footprint[ face ];
		const to = footprint[ ( face + 1 ) % 4 ];
		const turn = Math.atan2( - ( to[ 1 ] - from[ 1 ] ), to[ 0 ] - from[ 0 ] ) / QUARTER;

		return {
			origin: [ from[ 0 ], 0, from[ 1 ] ],
			// Lot edges turn by exact quarters; keep the frame exact too.
			rotationY: Math.round( turn ) * QUARTER
		};

	}

	#document( { parcelId, signText, absorbs, plan, frame }, blueprint ) {

		const ring = new PlanFrame( frame ).ring( blueprint.bounds.footprint );
		const xs = ring.map( ( point ) => point[ 0 ] );
		const zs = ring.map( ( point ) => point[ 1 ] );
		const document = {
			parcel: parcelId,
			plan: plan.id,
			origin: frame.origin,
			rotationY: frame.rotationY,
			lot: this.parcels.get( parcelId ).lot,
			bounds: {
				min: [ Math.min( ...xs ), 0, Math.min( ...zs ) ],
				max: [ Math.max( ...xs ), blueprint.bounds.height, Math.max( ...zs ) ]
			},
			signText,
			family: plan.family,
			floors: plan.floors,
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

/** How far a point stands from one lot edge. */
function toSegment( point, from, to ) {

	const dx = to[ 0 ] - from[ 0 ];
	const dz = to[ 1 ] - from[ 1 ];
	const length = dx * dx + dz * dz;
	const along = length > 0
		? Math.max( 0, Math.min( 1, ( ( point[ 0 ] - from[ 0 ] ) * dx + ( point[ 1 ] - from[ 1 ] ) * dz ) / length ) )
		: 0;

	return Math.hypot( point[ 0 ] - ( from[ 0 ] + dx * along ), point[ 1 ] - ( from[ 1 ] + dz * along ) );

}
