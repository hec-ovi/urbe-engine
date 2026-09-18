import { planBlueprintFile } from '../../assembly/kit/KitFiles.js';
import { parcelBlueprint } from '../../assembly/kit/PlanBlueprint.js';

/**
 * Manifest-bound building documents, with one shared request budget. A parcel
 * assembled from kit pieces carries its placement table instead of a shell GLB,
 * and a furnished one carries the three placement layouts its floors reuse.
 *
 * A kit parcel's blueprint belongs to the plan it stands from, so it is read
 * once for the whole city and composed into each parcel's frame here. A world
 * whose manifest does not say so keeps a blueprint beside each parcel and is
 * read that way. Every consumer downstream gets the same document.
 */
export class BuildingSource {

	constructor( { manifest, outBase, plansUrl, readJson } ) {

		this.ids = new Set( manifest.parcels );
		this.interiors = new Set( manifest.interiors );
		// Which path assembly took for each parcel. A world with no kit took the
		// per-parcel generator for every one of them.
		this.sources = manifest.sources ?? {};
		// What each kit parcel stands from, and where its blueprint is read.
		this.buildings = manifest.buildings ?? {};
		this.outBase = outBase;
		this.plansUrl = plansUrl;
		this.readJson = readJson;
		this.plans = new Map();
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
		const source = this.sources[ parcelId ] === 'kit' ? 'kit' : 'shell';
		const blueprint = source === 'kit' && this.buildings[ parcelId ]?.blueprint === 'plan'
			? await this.#kitBlueprint( parcelId, `${base}/${parcelId}.placements.json` )
			: await this.#json( `${base}/${parcelId}.blueprint.json` );
		const hasInterior = this.interiors.has( parcelId );
		const [ npc, interior ] = hasInterior
			? await Promise.all( [ this.#json( `${base}/interior/npc.json` ), this.#interior( base ) ] )
			: [ null, null ];

		return {
			parcelId, blueprint, npc, interior, hasInterior, source,
			...( source === 'kit'
				? { placementsUrl: `${base}/${parcelId}.placements.json` }
				: { shellUrl: `${base}/${parcelId}.glb` } )
		};

	}

	/** This parcel's blueprint: its plan's document, in the frame it stands in. */
	async #kitBlueprint( parcelId, placementsUrl ) {

		const record = await this.#json( placementsUrl );
		let plan = this.plans.get( record.plan );

		if ( ! plan ) {

			plan = this.#json( `${this.plansUrl}/${planBlueprintFile( record.plan )}` );
			this.plans.set( record.plan, plan );

		}

		try {

			return parcelBlueprint( await plan, record );

		} catch ( error ) {

			throw inputError( `${parcelId} stands from plan ${record.plan}, whose blueprint this world does not hold: ${error.message}` );

		}

	}

	/** The building manifest and the three layouts its floors name, beside it. */
	async #interior( base ) {

		const building = await this.#json( `${base}/interior/building.json` );
		const names = Object.entries( building.layouts );
		const tables = await Promise.all( names.map( ( [ , file ] ) => this.#json( `${base}/interior/${file}` ) ) );

		return { building, layouts: Object.fromEntries( names.map( ( [ id ], at ) => [ id, tables[ at ] ] ) ) };

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
