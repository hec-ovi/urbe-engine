import { pickInt } from './hash.js';

export class AssemblyError extends Error {

	constructor( code, message ) {

		super( message );
		this.code = code;

	}

}

/**
 * Pure adapter: atlas blueprint + connections output -> one exterior BuildingRequest per parcel.
 * Deterministic: same inputs, identical request. No IO.
 */
export class RequestAssembler {

	/**
	 * @param atlas CityBlueprint per ../atlas/CONTRACT.md
	 * @param connections ConnectionsOutput per ../connections/CONTRACT.md
	 */
	constructor( atlas, connections ) {

		this.worldSeed = atlas.meta.seed;
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
	 * @throws AssemblyError E_PARCEL_UNKNOWN
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
			theme: 'cyberpunk',
			apertures,
			options: { glb }
		};

		const basements = this.#chooseBasements( parcel, apertures );
		if ( basements > 0 ) request.building.basements = basements;

		return request;

	}

	/**
	 * Seeded pick inside the envelope, raised so the nominal height covers the
	 * topmost above-ground aperture (a floor plate must land at every base).
	 */
	#chooseFloors( parcel, apertures, seed ) {

		const { minFloors, maxFloors, floorHeight } = parcel.envelope;
		let floors = pickInt( `${seed}:floors`, minFloors, maxFloors );

		for ( const aperture of apertures ) {

			const top = aperture.base + aperture.height;
			if ( top <= 0 ) continue;
			floors = Math.max( floors, Math.ceil( top / floorHeight ) );

		}

		return Math.min( floors, maxFloors );

	}

	/** Below-ground apertures (tunnels) need basements deep enough to reach their base. */
	#chooseBasements( parcel, apertures ) {

		let depth = 0;

		for ( const aperture of apertures ) {

			if ( aperture.base < 0 ) depth = Math.max( depth, - aperture.base );

		}

		return Math.ceil( depth / parcel.envelope.floorHeight );

	}

}
