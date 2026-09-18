import * as THREE from 'three/webgpu';
import { readWorldDocument } from '../../data/WorldDocument.js';
import { BuildingsLoader, mapConcurrent } from '../BuildingsLoader.js';
import { KitPlacement } from './KitPlacement.js';
import { KitCellInstances } from './KitCellInstances.js';
import { buildingBoxes } from './KitColliders.js';
import { interiorOpenings } from './KitOpenings.js';
import { mainDoor, swingLeaves } from './KitDoors.js';
import { placementError } from './KitPieces.js';
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
 */
export class KitCellLoader {

	/**
	 * @param pieces KitPieces
	 * @param readJson reads one URL into a parsed document
	 * @param shells the original loader, for landmark parcels
	 */
	constructor( { pieces, factory, readJson = readPlacements, shells = new BuildingsLoader( factory ) } ) {

		this.pieces = pieces;
		this.factory = factory;
		this.readJson = readJson;
		this.shells = shells;

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

			for ( const [ index, source ] of kit.entries() ) {

				const record = records[ index ];

				if ( ! this.pieces.has( record.plan ) ) {

					throw placementError( `${source.parcelId} stands from ${record.plan}, which this world does not publish` );

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
					swinging
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
