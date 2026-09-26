import * as THREE from 'three/webgpu';
import { cityGltfLoader } from '../data/CityGltfLoader.js';
import { ImportedModels } from '../props/ImportedModels.js';
import { KitPieceDraw } from './kit/KitPieceDraw.js';

const WHITE = new THREE.Color( 1, 1, 1 );

/**
 * The furniture a furnished floor stands on, loaded once for the city.
 *
 * A layout names catalog furniture by id. Each model is read through the same
 * imported-model path the street props use, which stands it on the floor with
 * its footprint centred and scales it uniformly to the height the catalog
 * publishes, which is the frame a placement's position, rotation and scale
 * assume. What comes out is one instanced draw per model material part, shared
 * by every floor in the city, so a tower of identical desks costs one draw. The
 * parts wear their own materials lit by the room light pool, and each copy
 * carries the fill of the room it stands in.
 */
export class InteriorProps {

	/**
	 * @param catalog the furniture catalog `building.props` names
	 * @param baseUrl the directory it was read from, which `modelUri` is relative to
	 * @param roomLights RoomLights, whose pool lights every part
	 * @param loadAsset reads one model URL into `{ scene }`
	 */
	constructor( { catalog, baseUrl, roomLights, loadAsset = ( url ) => cityGltfLoader().loadAsync( url ) } ) {

		this.entries = new Map( ( catalog?.assets ?? [] ).map( ( asset ) => [ asset.id, asset ] ) );
		this.roomLights = roomLights;
		this.models = new ImportedModels( loadAsset, baseUrl );
		this.props = new Map();
		this.loading = new Map();
		/** Ids the catalog does not publish that a floor has named, each warned about once. */
		this.absent = new Set();
		this.group = new THREE.Group();
		this.group.name = 'interior-props';

	}

	/** One draw per model material part, for the whole city. */
	get drawCount() {

		let total = 0;
		for ( const prop of this.props.values() ) total += prop.draw.meshes.length;

		return total;

	}

	has( id ) {

		return this.props.has( id );

	}

	/** The prop's normalised parts, for collision. */
	surfacesOf( id ) {

		return this.props.get( id )?.surfaces ?? [];

	}

	/**
	 * Loads whatever of these ids is not standing yet. Resolves when all are.
	 * An id the catalog does not publish, a local-only model this machine
	 * lacks, stands nowhere: the first request naming it warns once.
	 */
	async prepare( ids ) {

		const wanted = [ ...new Set( ids ) ];
		const absent = wanted.filter( ( id ) => ! this.entries.has( id ) && ! this.absent.has( id ) );

		if ( absent.length ) {

			for ( const id of absent ) this.absent.add( id );
			console.warn( `interior furniture ${absent.join( ', ' )} is not in this world's catalog; its placements stand empty` );

		}

		await Promise.all( wanted.filter( ( id ) => this.entries.has( id ) ).map( ( id ) => this.#prop( id ) ) );

	}

	/** @param fill Vector4 the fill of the room the copy stands in */
	admit( id, matrix, fill ) {

		const prop = this.props.get( id );
		if ( ! prop ) throw propError( `no furniture ${id} in this catalog` );

		return prop.draw.add( matrix, WHITE, { slot: - 1 }, fill );

	}

	release( handle ) {

		handle.draw.remove( handle );

	}

	dispose() {

		for ( const prop of this.props.values() ) {

			prop.draw.dispose();
			this.roomLights.releaseSources( prop.surfaces.map( ( part ) => part.material ) );

		}
		this.props.clear();
		this.loading.clear();
		this.absent.clear();
		this.models.dispose();
		this.group.clear();
		this.group.removeFromParent();

	}

	#prop( id ) {

		if ( this.props.has( id ) ) return Promise.resolve();
		if ( this.loading.has( id ) ) return this.loading.get( id );

		const entry = this.entries.get( id );
		const pending = this.models
			.load( { id, file: entry.modelUri, height: heightOf( entry ) } )
			.then( ( surfaces ) => {

				const parts = surfaces.map( ( part, index ) => ( { ...part, bucket: index, material: this.roomLights.materialFor( id, part.material ) } ) );
				const prop = { id, surfaces, draw: new KitPieceDraw( `furniture:${id}`, parts, { fill: true } ) };
				this.props.set( id, prop );
				this.group.add( prop.draw.group );

			} )
			.finally( () => this.loading.delete( id ) );

		this.loading.set( id, pending );

		return pending;

	}

}

/**
 * The catalog measures a model as `[width, depth, height]`, flat on the ground.
 * The mesh itself is Y up, and Interior places it with one uniform scale, so
 * the height is the one axis to normalise against.
 */
function heightOf( entry ) {

	const height = entry.dimensionsMeters?.[ 2 ];
	if ( ! ( height > 0 ) ) throw propError( `furniture ${entry.id} publishes no height` );

	return height;

}

export function propError( message ) {

	return Object.assign( new Error( `E_INTERIOR_PROP: ${message}` ), { code: 'E_INTERIOR_PROP' } );

}
