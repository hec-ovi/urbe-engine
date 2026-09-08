/** Manifest-bound building documents, with one shared request budget. */
export class BuildingSource {

	constructor( { manifest, outBase, readJson } ) {

		this.ids = new Set( manifest.parcels );
		this.interiors = new Set( manifest.interiors );
		this.floors = manifest.floors;
		this.outBase = outBase;
		this.readJson = readJson;
		this.active = 0;
		this.queue = [];

	}

	async load( ids ) {

		if ( ! Array.isArray( ids ) || ids.some( id => typeof id !== 'string' || ! this.ids.has( id ) ) ) {

			throw inputError( 'building IDs must belong to this manifest' );

		}
		if ( new Set( ids ).size !== ids.length ) throw inputError( 'building IDs must be unique' );
		const buildings = await Promise.all( ids.map( id => this.#building( id ) ) );
		return new Map( buildings.map( building => [ building.parcelId, building ] ) );

	}

	async #building( parcelId ) {

		const base = `${this.outBase}/${parcelId}`;
		const blueprint = await this.#json( `${base}/${parcelId}.blueprint.json` );
		const hasInterior = this.interiors.has( parcelId );
		const [ npc, floors ] = hasInterior ? await Promise.all( [
			this.#json( `${base}/interior/npc.json` ),
			Promise.all( this.floors[ parcelId ].map( async tag => ( {
				...await this.#json( `${base}/interior/floors/${tag}.json` ),
				glbUrl: `${base}/interior/floors/${tag}.glb`
			} ) ) )
		] ) : [ null, [] ];
		return { parcelId, blueprint, npc, floors, hasInterior, shellUrl: `${base}/${parcelId}.glb` };

	}

	#json( url ) {

		return new Promise( ( resolve, reject ) => {

			this.queue.push( { url, resolve, reject } );
			this.#drain();

		} );

	}

	#drain() {

		while ( this.active < 8 && this.queue.length ) {

			const { url, resolve, reject } = this.queue.shift();
			this.active ++;
			Promise.resolve().then( () => this.readJson( url ) ).then( resolve, reject ).finally( () => {

				this.active --;
				this.#drain();

			} );

		}

	}

}

function inputError( message ) {

	return Object.assign( new Error( `E_WORLD_BUILDINGS: ${message}` ), { code: 'E_WORLD_BUILDINGS' } );

}
