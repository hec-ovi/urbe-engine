import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { cityGltfLoader } from '../data/CityGltfLoader.js';
import { mapConcurrent } from './BuildingsLoader.js';
import { bake } from './GeometryBake.js';
import { shellMaterial } from './ShellSurface.js';
import { MaterialBatches } from './kit/MaterialBatches.js';

const LOAD_CONCURRENCY = 8;
/** A catalog key is theme, kind and tier; anything else is a node name. */
const KEY = /^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/;
/** Which diffuser a module's lit surface wears; a module not named here wears the canonical one. */
const FIXTURE_VARIANTS = { 'ceiling-led-strip': 'strip' };

/**
 * The city's whole room vocabulary, loaded once.
 *
 * Interior publishes one shared module set for the world: a wall segment, a
 * floor and ceiling tile, a door frame, a window return, the stair flights, the
 * lift car and its doors, a ceiling strip and a picture frame. A furnished
 * floor is a table of copies of those, so what comes out here is one batch per
 * material slot for the entire city, holding every module surface that wears
 * it: admitting a floor appends matrices to batches that already exist, and the
 * draw count follows the slots the catalog publishes rather than the modules
 * wearing them or the number of rooms standing. Every slot material is lit by
 * the room light pool, and each copy carries the fill of the room it stands in.
 *
 * A module file that is missing, refuses to decode or does not match the byte
 * count `modules.json` publishes fails the whole set with `E_INTERIOR_MODULE`.
 */
export class InteriorModules {

	/**
	 * @param catalog the validated `modules.json` document
	 * @param baseUrl the directory it was read from, which its file paths are relative to
	 * @param factory PbrMaterialFactory, for the material of each published slot
	 * @param roomLights RoomLights, whose pool lights every slot material
	 * @param readBinary reads one URL into an ArrayBuffer
	 */
	constructor( { catalog, baseUrl, factory, roomLights, loader = cityGltfLoader(), readBinary = fetchBinary } ) {

		this.catalog = catalog;
		this.baseUrl = String( baseUrl ).replace( /\/+$/, '' );
		this.factory = factory;
		this.roomLights = roomLights;
		this.loader = loader;
		this.readBinary = readBinary;
		this.modules = new Map();
		this.batches = new MaterialBatches( 'interior-modules', { fill: true } );
		this.group = this.batches.group;
		this.ready = this.#load();

	}

	/** One draw per material slot, for the whole city. */
	get batchCount() {

		return this.batches.batchCount;

	}

	/** How many module copies are standing. */
	get copyCount() {

		return this.batches.copies;

	}

	has( id ) {

		return this.modules.has( id );

	}

	/** Published bounds of one module, in its own metres. */
	boundsOf( id ) {

		const module = this.modules.get( id );

		return module ? { size: module.size, origin: module.origin } : null;

	}

	/** The catalog keys one module wears. */
	slotsOf( id ) {

		return this.modules.get( id )?.slots ?? [];

	}

	/** The module's own surfaces, for the lifts, which move their copies themselves. */
	surfacesOf( id ) {

		return this.modules.get( id )?.surfaces ?? [];

	}

	/** Room for the copies a floor is about to place, one reallocation per batch. */
	reserve( ids ) {

		this.batches.reserve( ids );

	}

	/**
	 * Draws one more copy of a module.
	 * @param fill Vector4 the fill of the room the copy stands in
	 * @returns a handle to hand back to `release`
	 */
	admit( id, matrix, fill ) {

		if ( ! this.modules.has( id ) ) throw moduleError( `no module ${id} in this catalog` );

		return this.batches.admit( id, matrix, null, fill );

	}

	release( handle ) {

		this.batches.release( handle );

	}

	dispose() {

		this.batches.dispose();
		for ( const module of this.modules.values() ) {

			for ( const { geometry } of module.surfaces ) geometry.dispose();
			this.roomLights.releaseSources( module.surfaces.map( ( surface ) => surface.source ) );

		}
		this.modules.clear();

	}

	async #load() {

		const loaded = await mapConcurrent( this.catalog.modules, LOAD_CONCURRENCY, ( module ) => this.#module( module ) );

		for ( const module of loaded ) this.modules.set( module.id, module );
		this.batches.add( loaded );

		return this;

	}

	async #module( record ) {

		const url = `${this.baseUrl}/${record.file}`;
		let scene;

		try {

			const bytes = await this.readBinary( url );
			if ( Number.isInteger( record.bytes ) && bytes.byteLength !== record.bytes ) {

				throw new Error( `${bytes.byteLength} bytes, the catalog publishes ${record.bytes}` );

			}
			( { scene } = await this.loader.parseAsync( bytes, `${this.baseUrl}/` ) );

		} catch ( cause ) {

			throw Object.assign( new Error( `E_INTERIOR_MODULE: ${url}: ${cause.message ?? cause}` ), { code: 'E_INTERIOR_MODULE', cause } );

		}

		const surfaces = readModule( scene, record, this.factory, this.roomLights );

		return {
			id: record.id,
			size: record.size,
			origin: record.origin,
			slots: record.materialSlots,
			triangles: record.triangles ?? 0,
			surfaces
		};

	}

}

/**
 * One module GLB read into what the city draws it with: its meshes baked into
 * the module's own frame and merged by material slot, one material per slot
 * built the way a shell surface is, so a lit diffuser is its own lamp, and
 * worn through the room light pool. Slot names are catalog keys, so a mesh
 * whose material name has been rewritten falls back to the slot the catalog
 * publishes at that position.
 */
function readModule( scene, record, factory, roomLights ) {

	scene.updateMatrixWorld( true );

	const slots = new Map();
	let next = 0;

	scene.traverse( ( node ) => {

		if ( ! node.isMesh ) return;

		const name = node.material?.name ?? '';
		const key = KEY.test( name ) ? name : record.materialSlots[ Math.min( next, record.materialSlots.length - 1 ) ];

		if ( ! slots.has( key ) ) {

			slots.set( key, [] );
			next ++;

		}
		slots.get( key ).push( bake( node ) );

	} );

	return [ ...slots ].map( ( [ key, geometries ] ) => {

		const geometry = geometries.length === 1 ? geometries[ 0 ] : BufferGeometryUtils.mergeGeometries( geometries, false );
		if ( geometries.length > 1 ) for ( const part of geometries ) part.dispose();
		geometry.computeBoundingBox();

		const source = shellMaterial( factory, { key, variantId: FIXTURE_VARIANTS[ record.id ] } );

		return { bucket: key, geometry, source, material: roomLights.materialFor( key, source ) };

	} );

}

export function moduleError( message ) {

	return Object.assign( new Error( `E_INTERIOR_MODULE: ${message}` ), { code: 'E_INTERIOR_MODULE' } );

}

async function fetchBinary( url ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );

	return response.arrayBuffer();

}
