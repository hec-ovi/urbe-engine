import * as THREE from 'three/webgpu';
import { readWorldDocument } from '../../data/WorldDocument.js';
import { BuildingsLoader, mapConcurrent } from '../BuildingsLoader.js';
import { KitPlacement } from './KitPlacement.js';
import { KitCellInstances } from './KitCellInstances.js';
import { buildingBoxes } from './KitColliders.js';
import { interiorOpenings } from './KitOpenings.js';
import { kitDoor } from './KitDoors.js';
import { placementError } from './KitPieces.js';
import { tintFor } from './KitTint.js';

/** Placement tables are pure reads, so a cell asks for all of them at once. */
const READ_CONCURRENCY = 8;

/**
 * The shell stream's loader port for a city built from kit pieces.
 *
 * It answers with the same result an original shell cell has, so the stream,
 * the neon, the lit windows and the physics ports cannot tell the two apart:
 * a group, the doors, the entrances, the collider sources, the source centres
 * and a triangle count. What differs is where the work lands. Nothing is
 * merged and nothing is cooked: showing a cell appends one matrix per piece
 * copy to draws the city already owns, and dropping it takes those matrices
 * back out. Landmark parcels in the same cell still load their own shell
 * through the original loader.
 */
export class KitCellLoader {

	/**
	 * @param pieces KitPieces
	 * @param plansUrl where the city's building plans stand, `<world>/kit/plans`
	 * @param readJson reads one URL into a parsed document
	 * @param shells the original loader, for landmark parcels
	 */
	constructor( { pieces, factory, plansUrl = 'kit/plans', readJson = readPlacements, shells = new BuildingsLoader( factory ) } ) {

		this.pieces = pieces;
		this.factory = factory;
		this.plansUrl = plansUrl;
		this.readJson = readJson;
		this.shells = shells;
		// A city has a few dozen plans and thousands of buildings, so each plan
		// is read once and every cell that wants it waits on that same read.
		this.plans = new Map();

	}

	/** One building plan, read once per city. */
	plan( id ) {

		const held = this.plans.get( id );

		if ( held ) return held;

		const reading = this.readJson( `${this.plansUrl}/${id}.json` ).catch( ( error ) => {

			this.plans.delete( id );
			throw error;

		} );

		this.plans.set( id, reading );

		return reading;

	}

	/** @param buildings Map<parcelId, BuildingSource> */
	async load( buildings ) {

		const kit = [ ...buildings.values() ].filter( ( source ) => source.source === 'kit' && source.placementsUrl );
		const placed = new Set( kit );
		const rest = new Map( [ ...buildings ].filter( ( [ , source ] ) => ! placed.has( source ) ) );
		const base = rest.size ? await this.shells.load( rest ) : empty();

		await this.pieces.ready;

		const group = new THREE.Group();
		group.name = 'kit-cell';
		const standing = [];
		const boxColliders = [];
		let triangles = 0;

		try {

			const records = await mapConcurrent( kit, READ_CONCURRENCY, ( source ) => this.readJson( source.placementsUrl ) );
			const plans = new Map( await Promise.all( [ ...new Set( records.map( ( record ) => record.plan ) ) ]
				.map( async ( id ) => [ id, await this.plan( id ) ] ) ) );

			for ( const [ index, source ] of kit.entries() ) {

				const record = records[ index ];
				const placement = new KitPlacement( source.parcelId, record, plans.get( record.plan ), this.pieces.kit.module );
				const door = source.hasInterior ? kitDoor( placement, this.pieces ) : null;

				triangles += this.#counted( placement );
				boxColliders.push( ...buildingBoxes( placement, {
					swinging: Boolean( door ),
					openings: interiorOpenings( placement, source.blueprint ?? null )
				} ) );
				base.centers.set( source.parcelId, placement.center );
				standing.push( {
					placement,
					colour: tintFor( placement.family, placement.tint, new THREE.Color() ),
					swinging: Boolean( door )
				} );

				if ( ! door ) continue;

				for ( const leaf of door.pivots ) group.add( leaf.pivot );
				base.doors.push( door );
				base.entrances.push( door );

			}

		} catch ( error ) {

			base.disposeModelInstances?.();
			throw error;

		}

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

	/** Checks this building against the kit. @returns what one copy costs to draw. */
	#counted( placement ) {

		let triangles = 0;

		for ( const piece of placement.placements ) {

			if ( ! this.pieces.has( piece.piece ) ) {

				throw placementError( `${placement.parcelId} places ${piece.piece}, which this kit does not publish` );

			}
			triangles += this.pieces.trianglesOf( piece.piece );

		}

		return triangles;

	}

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
