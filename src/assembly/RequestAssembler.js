import { pickInt } from './hash.js';
import { loadFloorConstants, constantsForType, feasibleFloorRange } from './floorFeasibility.js';

const THEME = 'cyberpunk';

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
		this.floorConstants = floorConstants;
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
	 * @returns BuildingRequest per ../exterior/schemas/building-request.schema.json
	 * @throws AssemblyError E_PARCEL_UNKNOWN | E_ENVELOPE_INFEASIBLE
	 */
	assemble( parcelId, { glb = 'merged' } = {} ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) throw new AssemblyError( 'E_PARCEL_UNKNOWN', `no parcel ${parcelId} in atlas blueprint` );

		const apertures = this.aperturesByBuilding.get( parcelId ) ?? [];
		const seed = `${this.worldSeed}:${parcelId}`;

		const request = {
			seed,
			buildingId: parcelId,
			parcel: {
				footprint: parcel.footprint,
				accessPoint: parcel.access.point,
				maxHeight: parcel.envelope.maxHeight
			},
			building: {
				type: parcel.type,
				tier: parcel.tier,
				floors: this.#chooseFloors( parcel, apertures, seed )
			},
			theme: THEME,
			apertures,
			options: { glb }
		};

		const basements = this.#chooseBasements( parcel, apertures );
		if ( basements > 0 ) request.building.basements = basements;

		return request;

	}

	/**
	 * @param parcelId atlas parcel id
	 * @param options.blueprint the exterior blueprint document for this building
	 * @param options.shellGlb path to the named-mode shell GLB
	 * @returns InteriorRequest per ../interior/schemas/request.schema.json;
	 * assignments omitted so interior derives kinds from the blueprint floor slots
	 * @throws AssemblyError E_PARCEL_UNKNOWN
	 */
	assembleInterior( parcelId, { blueprint, shellGlb } ) {

		const parcel = this.parcels.get( parcelId );

		if ( ! parcel ) throw new AssemblyError( 'E_PARCEL_UNKNOWN', `no parcel ${parcelId} in atlas blueprint` );

		return {
			seed: `${this.worldSeed}:${parcelId}`,
			building: { id: parcelId, type: parcel.type, tier: parcel.tier },
			shellGlb,
			blueprint,
			materialTheme: THEME
		};

	}

	/**
	 * Seeded pick inside the intersection of the atlas envelope and exterior's
	 * feasible floor count range for the parcel's apertures.
	 */
	#chooseFloors( parcel, apertures, seed ) {

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
				`${parcel.id}: no feasible floor count for maxHeight ${maxHeight} with its apertures` );

		}

		const low = Math.max( minFloors, range.min );
		const high = Math.min( maxFloors, range.max );

		if ( low > high ) {

			throw new AssemblyError( 'E_ENVELOPE_INFEASIBLE',
				`${parcel.id}: envelope ${minFloors}..${maxFloors} misses feasible range ${range.min}..${range.max}` );

		}

		return pickInt( `${seed}:floors`, low, high );

	}

	/** Below-ground apertures (tunnels) need basements deep enough to reach their base. */
	#chooseBasements( parcel, apertures ) {

		let depth = 0;

		for ( const aperture of apertures ) {

			if ( aperture.base < 0 ) depth = Math.max( depth, - aperture.base );

		}

		if ( depth === 0 ) return 0;

		const { maxFloorHeight } = constantsForType( this.floorConstants, parcel.type );

		return Math.ceil( depth / maxFloorHeight );

	}

}
