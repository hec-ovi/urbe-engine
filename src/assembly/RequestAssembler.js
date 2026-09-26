import { pickInt } from './hash.js';
import { landmarkFamilies } from './kit/Families.js';
import { chooseFamily } from './kit/FamilyChoice.js';
import { lotRectangle, plateSides } from './kit/LotRectangle.js';
import { loadFloorConstants, constantsForType, feasibleFloorRange, feasibleBasementRange } from './floorFeasibility.js';
import { signText } from './signText.js';
import { marqueeTextLimit } from './validators.js';

const THEME = 'cyberpunk';
/** What a parcel no approved design fits is drawn as: Exterior's own choice. */
const AUTO = 'auto';
/** Which approved design a unique building takes first, before a seeded pick. */
const LANDMARK_FIRST = [ 'garden-taper', 'corporate-sectors' ];

// A sign reads the parcel's name when the naming pass gave it one, else what
// the place is. Only parcel types a passer-by reads off the street are listed;
// every other type gets no sign at all, because a blank one is worse than none.
const VENUE_SIGN = {
	hotel: 'HOTEL',
	coffee_shop: 'COFFEE',
	commerce: 'MARKET',
	clinic: 'CLINIC',
	police: 'POLICE',
	restaurant: 'DINER'
};

/** What this kind of place letters on its marquee, or null when it has no sign. */
export function venueSign( type ) {

	return VENUE_SIGN[ type ] ?? null;

}

export class AssemblyError extends Error {

	constructor( code, message ) {

		super( message );
		this.code = code;

	}

}

/**
 * Pure adapter: atlas blueprint + connections output -> one exterior BuildingRequest per parcel.
 * Deterministic: same inputs, identical request. No IO beyond the injected constants.
 */
export class RequestAssembler {

	/**
	 * @param atlas CityBlueprint per ../atlas/CONTRACT.md
	 * @param connections ConnectionsOutput per ../connections/CONTRACT.md
	 * @param floorConstants exterior's floor-constants surface; defaults to the sibling file
	 */
	constructor( atlas, connections, floorConstants = loadFloorConstants() ) {

		this.worldSeed = atlas.meta.seed;
		this.buildingGrid = atlas.meta.buildingGrid;
		this.streetEdges = new Map( ( atlas.streets?.edges ?? [] ).map( ( edge ) => [ edge.id, edge ] ) );
		this.floorConstants = floorConstants;
		this.marqueeLimit = marqueeTextLimit();
		this.parcels = new Map( atlas.parcels.map( ( p ) => [ p.id, p ] ) );
		this.aperturesByBuilding = new Map();

		for ( const aperture of connections.apertures ) {

			const list = this.aperturesByBuilding.get( aperture.buildingId );
			if ( list ) list.push( aperture );
			else this.aperturesByBuilding.set( aperture.buildingId, [ aperture ] );

		}

	}

	/**
	 * @param parcelId atlas parcel id
	 * @param options.glb 'merged' (default, engine runtime mode) | 'named'
	 * @param options.floorCap optional above-ground floor cap (interior walkup
	 * mode); the cap wins over the atlas envelope minimum, aperture-driven
	 * minimums stay hard
	 * @param options.signage what the marquee reads: 'name' (default: the
	 * parcel's name, else its venue word), 'venue' (the word), 'none'
	 * @returns BuildingRequest per ../exterior/schemas/building-request.schema.json
	 * @throws AssemblyError E_PARCEL_UNKNOWN | E_ENVELOPE_INFEASIBLE | E_REQUEST_INVALID
	 */
	assemble( parcelId, { glb = 'merged', floorCap = null, signage = 'name' } = {} ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) throw new AssemblyError( 'E_PARCEL_UNKNOWN', `no parcel ${parcelId} in atlas blueprint` );

		const apertures = this.aperturesByBuilding.get( parcelId ) ?? [];
		const seed = `${this.worldSeed}:${parcelId}`;
		const floors = this.#chooseFloors( parcel, apertures, seed, floorCap );

		const request = {
			seed,
			buildingId: parcelId,
			parcel: {
				footprint: parcel.footprint,
				accessPoint: parcel.access.point,
				streetAccess: this.#streetAccess( parcel ),
				maxHeight: parcel.envelope.maxHeight,
				...( this.buildingGrid ? { buildingGrid: this.buildingGrid } : {} )
			},
			building: { type: parcel.type, tier: parcel.tier, floors },
			theme: THEME,
			apertures,
			options: { glb, architecture: this.#architecture( parcel, floors, apertures ) }
		};

		const text = this.#signText( parcel, signage );
		if ( text ) request.options.signage = { mode: 'marquee', text };

		const basements = this.#chooseBasements( parcel, apertures );
		if ( basements > 0 ) request.building.basements = basements;

		return request;

	}

	/**
	 * Which design this building is drawn as. A unique building wears an approved
	 * family whenever its own footprint, height and street take one: the landmark
	 * design first, then the corporate tower, then a seeded pick of the rest. A
	 * connection reaching above ground pins its face, including an uncut cable
	 * anchor: a tapered facade cannot leave an attachment at the old parcel plane.
	 * Everything else is Exterior's own choice for the programme.
	 */
	#architecture( parcel, floors, apertures ) {

		if ( ! parcel.landmark || ! lotRectangle( parcel.footprint ) ) return AUTO;

		// Exterior's own test (src/layout/sectionMassing.ts): an opening pins its
		// face once any of it stands above ground, wherever its bottom is.
		const fixedFaces = apertures.some( ( aperture ) => aperture.base >= 0 || aperture.base + aperture.height > 0 );
		// Exterior fits a family on the building grid, or on the footprint as it
		// stands when a connection pins its faces or no grid is published, and
		// puts face 0 along that first axis.
		const [ from, to ] = parcel.footprint;
		const angle = fixedFaces || ! this.buildingGrid
			? Math.atan2( to[ 1 ] - from[ 1 ], to[ 0 ] - from[ 0 ] ) : this.buildingGrid.angle;
		const fitting = landmarkFamilies( plateSides( parcel.footprint, angle ), floors, parcel, { fixedFaces } );

		return LANDMARK_FIRST.find( ( id ) => fitting.includes( id ) )
			?? chooseFamily( fitting, this.worldSeed, parcel.id ) ?? AUTO;

	}

	/** Authored street identity and geometry keep a corner access point unambiguous. */
	#streetAccess( parcel ) {

		const edge = this.streetEdges.get( parcel.access.edgeId );
		if ( ! edge ) throw new AssemblyError( 'E_REQUEST_INVALID',
			`${parcel.id}: access street ${parcel.access.edgeId} is absent from the Atlas street graph` );
		return { edgeId: edge.id, path: edge.path };

	}

	/**
	 * @param parcelId atlas parcel id
	 * @param options.blueprint the exterior blueprint document for this building
	 * @param options.shellGlb path to the named-mode shell GLB
	 * @returns InteriorRequest per ../interior/schemas/request.schema.json.
	 * It assigns no floor: Interior furnishes each one for the parcel's own
	 * type, reading a shared plan's class slugs as that type's programme, so
	 * the city and a building preview furnish a parcel alike
	 * @throws AssemblyError E_PARCEL_UNKNOWN
	 */
	assembleInterior( parcelId, { blueprint, shellGlb = null } ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) throw new AssemblyError( 'E_PARCEL_UNKNOWN', `no parcel ${parcelId} in atlas blueprint` );

		return {
			seed: `${this.worldSeed}:${parcelId}`,
			building: { id: parcelId, type: parcel.type, tier: parcel.tier },
			// Metadata interior keeps; a kit building has no GLB of its own.
			...( shellGlb ? { shellGlb } : {} ),
			blueprint,
			materialTheme: THEME
		};

	}

	/**
	 * Seeded pick inside the intersection of the atlas envelope and exterior's
	 * feasible floor count range for the parcel's apertures. A floorCap caps
	 * the top and overrides the envelope minimum below it.
	 */
	#chooseFloors( parcel, apertures, seed, floorCap ) {

		const { minFloors, maxFloors, maxHeight } = parcel.envelope;
		const constants = constantsForType( this.floorConstants, parcel.type );
		const range = feasibleFloorRange( {
			maxHeight,
			apertures,
			minFloorHeight: constants.minFloorHeight,
			maxFloorHeight: constants.maxFloorHeight
		} );

		if ( ! range ) {

			throw new AssemblyError( 'E_ENVELOPE_INFEASIBLE',
				`${parcel.id}: no ${parcel.type} floor count fits maxHeight ${maxHeight} m with its ${apertures.length} apertures` );

		}

		const high = Math.min( maxFloors, range.max, floorCap ?? Infinity );
		const low = Math.max( range.min, Math.min( minFloors, high ) );

		if ( low > high ) {

			throw new AssemblyError( 'E_ENVELOPE_INFEASIBLE',
				`${parcel.id}: envelope ${minFloors}..${maxFloors}${floorCap ? ` capped at ${floorCap}` : ''} misses feasible range ${range.min}..${range.max}` );

		}

		return pickInt( `${seed}:floors`, low, high );

	}

	/**
	 * The marquee text, or null for a parcel type with no sign: the name the
	 * naming pass gave the parcel, lettered per signText.js, else its venue word.
	 */
	#signText( parcel, signage ) {

		const venue = venueSign( parcel.type );

		if ( ! venue || signage === 'none' ) return null;
		if ( signage === 'venue' ) return venue;

		return signText( parcel.name, this.marqueeLimit ) ?? venue;

	}

	/** Below-ground apertures (tunnels) need basements deep enough to reach their base. */
	#chooseBasements( parcel, apertures ) {

		const range = feasibleBasementRange( { apertures, ...constantsForType( this.floorConstants, parcel.type ) } );
		if ( ! range ) throw new AssemblyError( 'E_ENVELOPE_INFEASIBLE', `${parcel.id}: fixed basement apertures cannot fit the active Exterior floor policy` );
		return range.min;

	}

}
