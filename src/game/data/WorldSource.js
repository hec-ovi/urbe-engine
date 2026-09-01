import { runConnections } from '../../assembly/connectionsRunner.js';

/**
 * Everything the game reads off disk, and nothing else: the atlas blueprint,
 * the connections document generated from it, and the per-parcel exterior
 * blueprint plus interior NPC support written by `npm run assemble-city`.
 * Parcels without an assembled building are reported as unbuilt.
 */
export class WorldSource {

	constructor( { blueprintUrl, outBase } ) {

		this.blueprintUrl = blueprintUrl;
		this.outBase = outBase;

	}

	async #json( url ) {

		const response = await fetch( url );

		if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );

		return response.json();

	}

	/** @returns { atlas, connections, buildings, unbuilt } */
	async load() {

		const atlas = await this.#json( this.blueprintUrl );

		const connections = await runConnections( atlas, { seed: atlas.meta.seed } );

		const results = await Promise.all(
			atlas.parcels.map( ( parcel ) => this.#loadBuilding( parcel.id ) )
		);

		const buildings = new Map();
		const unbuilt = [];

		for ( const result of results ) {

			if ( result.blueprint ) buildings.set( result.parcelId, result );
			else unbuilt.push( result.parcelId );

		}

		return { atlas, connections, buildings, unbuilt };

	}

	/** A parcel the batch skipped simply has no blueprint; that is not an error. */
	async #loadBuilding( parcelId ) {

		const base = `${this.outBase}/${parcelId}`;

		try {

			const [ blueprint, npc ] = await Promise.all( [
				this.#json( `${base}/${parcelId}.blueprint.json` ),
				this.#json( `${base}/interior/npc.json` )
			] );

			return { parcelId, blueprint, npc, glbUrl: `${base}/interior/building.glb` };

		} catch {

			return { parcelId, blueprint: null };

		}

	}

}
