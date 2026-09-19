import * as THREE from 'three/webgpu';
import { readWorldDocument } from '../../data/WorldDocument.js';
import { BuildingsLoader, mapConcurrent } from '../BuildingsLoader.js';
import { KitPlacement, placementError } from './KitPlacement.js';
import { KitCellInstances } from './KitCellInstances.js';
import { buildingBoxes } from './KitColliders.js';
import { interiorOpenings } from './KitOpenings.js';
import { mainDoor, swingLeaves } from './KitDoors.js';
import { tintFor } from './KitTint.js';

/** Placement records are pure reads, so a cell asks for all of them at once. */
const READ_CONCURRENCY = 8;

/**
 * The shell stream's loader port for a city built from shared building plans.
 *
 * It answers with the same result an original shell cell has, so the stream,
 * the neon, the lit windows and the physics ports cannot tell the two apart:
 * a group, the doors, the entrances, the collider sources, the source centres
 * and a triangle count. What differs is where the work lands. Nothing is
 * merged and nothing is cooked: showing a cell appends one matrix per building
 * to draws the city already owns, and dropping it takes those matrices back
 * out. Landmark parcels in the same cell still load their own shell through the
 * original loader.
 *
 * A cell is also where the city reads its buildings: the plans its parcels
 * stand on are asked for here, so only what stands near the player is ever
 * fetched, and a cell waits on its own plans rather than on the whole set.
 * `open` is that reading, kept apart from the building so the stream can leave
 * a cell whose files are still coming and stand the ones whose plans are here.
 */
export class KitCellLoader {

	/**
	 * @param pieces KitPieces
	 * @param readJson reads one URL into a parsed document
	 * @param shells the original loader, for landmark parcels
	 * @param onError receives the plans this cell could not stand
	 */
	constructor( { pieces, factory, readJson = readPlacements, shells = new BuildingsLoader( factory ), onError = console.error } ) {

		this.pieces = pieces;
		this.factory = factory;
		this.readJson = readJson;
		this.shells = shells;
		this.onError = onError;
		/** source -> its placement record, so opening a cell and building it read it once */
		this.records = new WeakMap();

	}

	/**
	 * Everything this cell has to read, read and nothing more: its parcels'
	 * placement records and the files the plans they name are published as.
	 * Decoding those plans is the building cell's own work, so the stream can
	 * leave a cell whose files are still coming, build the cells whose plans
	 * already stand, and keep one cell's geometry work on the main thread.
	 *
	 * @param buildings Map<parcelId, BuildingSource>
	 */
	async open( buildings ) {

		const kit = kitSources( buildings );
		if ( ! kit.length ) return;

		const records = await mapConcurrent( kit, READ_CONCURRENCY, ( source ) => this.#record( source ) );
		await this.pieces.fetch( records.map( ( record ) => record.plan ) );

	}

	/** One parcel's placement record, read once however often it is asked for. */
	#record( source ) {

		let reading = this.records.get( source );

		if ( ! reading ) {

			reading = Promise.resolve( this.readJson( source.placementsUrl ) ).catch( ( error ) => {

				// A failed read is not an answer, so the next caller asks again.
				this.records.delete( source );
				throw error;

			} );
			this.records.set( source, reading );

		}

		return reading;

	}

	/** @param buildings Map<parcelId, BuildingSource> */
	async load( buildings ) {

		const kit = kitSources( buildings );
		const placed = new Set( kit );
		const rest = new Map( [ ...buildings ].filter( ( [ , source ] ) => ! placed.has( source ) ) );
		const base = rest.size ? await this.shells.load( rest ) : empty();

		const group = new THREE.Group();
		group.name = 'kit-cell';
		const standing = [];
		const boxColliders = [];
		const emptyLots = new Map();
		let triangles = 0;

		try {

			const records = await mapConcurrent( kit, READ_CONCURRENCY, ( source ) => this.#record( source ) );
			for ( const [ index, source ] of kit.entries() ) {

				if ( this.pieces.published( records[ index ].plan ) ) continue;

				throw placementError( `${source.parcelId} stands from ${records[ index ].plan}, which this world does not publish` );

			}
			// The plans this cell's buildings are copies of, read now if this is
			// the first cell in the city to stand on them.
			await this.pieces.want( records.map( ( record ) => record.plan ) );

			for ( const [ index, source ] of kit.entries() ) {

				const record = records[ index ];

				// A plan the city cannot read leaves its copies as empty lots.
				if ( ! this.pieces.has( record.plan ) ) {

					emptyLots.set( record.plan, [ ...( emptyLots.get( record.plan ) ?? [] ), source.parcelId ] );
					continue;

				}

				const placement = new KitPlacement( source.parcelId, record, this.pieces.plans.get( record.plan ) );
				// A kit parcel's blueprint is its plan's, composed into this frame,
				// so its doors and its holes are read exactly where a shell's are.
				const blueprint = source.blueprint ?? null;
				const door = blueprint ? mainDoor( blueprint ) : null;
				const swinging = Boolean( source.hasInterior && door && swingLeaves( door, placement, this.pieces ) );

				triangles += this.pieces.trianglesOf( record.plan );
				boxColliders.push( ...buildingBoxes( placement, {
					openings: interiorOpenings( placement, blueprint ),
					leaf: swinging ? null : door
				} ) );
				base.centers.set( source.parcelId, placement.center );
				standing.push( {
					placement,
					colour: tintFor( placement.family, placement.tint, new THREE.Color() ),
					swinging,
					interior: Boolean( source.hasInterior )
				} );

				if ( ! swinging ) continue;

				for ( const leaf of door.pivots ) group.add( leaf.pivot );
				base.doors.push( door );
				base.entrances.push( door );

			}

		} catch ( error ) {

			base.disposeModelInstances?.();
			throw error;

		}

		for ( const [ plan, parcels ] of emptyLots ) this.onError( emptyLotError( plan, parcels, this.pieces.failure( plan ) ) );

		if ( base.group.children.length ) group.add( base.group );

		const instances = new KitCellInstances( this.pieces, standing );

		return {
			...base,
			group: instances.bind( group ),
			boxColliders,
			triangles: base.triangles + triangles,
			disposeModelInstances: () => {

				instances.hide();
				base.disposeModelInstances?.();

			}
		};

	}

}

/** The parcels of a cell that stand on a shared plan. */
function kitSources( buildings ) {

	return [ ...buildings.values() ].filter( ( source ) => source.source === 'kit' && source.placementsUrl );

}

/** What a plan the city cannot read costs: these parcels, and nothing else. */
function emptyLotError( planId, parcels, cause ) {

	return Object.assign(
		new Error( `E_KIT_PIECES: ${planId} does not stand, so ${parcels.join( ', ' )} stay empty lots: ${cause.message}` ),
		{ code: 'E_KIT_PIECES', cause }
	);

}

/** A cell of kit parcels alone still answers with every field a shell cell has. */
function empty() {

	return {
		group: new THREE.Group(),
		doors: [],
		entrances: [],
		shellColliders: new Map(),
		centers: new Map(),
		triangles: 0,
		unsupportedDoors: [],
		unresolvedModelInstances: []
	};

}

async function readPlacements( url ) {

	return ( await readWorldDocument( url ) ).data;

}
