import { FrameBudget } from '../app/FrameBudget.js';
import { BuildingsLoader } from './city/BuildingsLoader.js';
import { ShellStream } from './city/streaming/ShellStream.js';
import { KitPieces } from './city/kit/KitPieces.js';
import { KitCellLoader } from './city/kit/KitCells.js';
import { Neon } from './city/Neon.js';
import { LitWindows } from './city/LitWindows.js';
import { DoorColliders } from './physics/index.js';
import { Haze } from './light/Haze.js';

/** Kit cells are cheap enough to keep a wider window resident than merged shells. */
const KIT_LOAD_RADIUS = 384;
const KIT_DROP_RADIUS = 640;

/** Binds shell admission to the game's render, fixture and physics ports. */
export class ShellScene {

	constructor( { atlas, catalog, factory, buildings, loadBuildings, physics, colliders, interiors, haze, kit = null } ) {

		this.atlas = atlas;
		this.parcels = new Map( atlas.parcels.map( parcel => [ parcel.id, parcel ] ) );
		Object.assign( this, { factory, physics, colliders, interiors, haze } );
		this.cells = new Map();
		// One budget for the whole of admitting a cell: decoding a plan and
		// building a building give the frame its turn through the same slice.
		// It starts unpaced, because a load has no frame to protect and the
		// cells around the spawn have to stand before play begins.
		this.slice = new FrameBudget( { paced: false } );
		this.pieces = kit ? new KitPieces( { kit: kit.document, baseUrl: kit.baseUrl, blueprints: kit.blueprints, factory, slice: this.slice } ) : null;
		this.stream = new ShellStream( {
			catalog, factory, buildings, loadBuildings,
			loader: this.pieces
				? new KitCellLoader( { pieces: this.pieces, factory, slice: this.slice } )
				: new BuildingsLoader( factory, undefined, {}, this.slice ),
			...( this.pieces ? { loadRadius: KIT_LOAD_RADIUS, dropRadius: KIT_DROP_RADIUS } : {} ),
			prepare: cell => this.#prepare( cell ),
			added: cell => { this.cells.set( cell.id, cell ); this.onFixturesChanged?.(); },
			removed: cell => this.#remove( cell )
		} );
		// The kit draws belong to the whole city, not to any one cell, so they
		// hang off the stream itself. A cell's copies only enter them when the
		// stream turns that cell visible, which is after the skyline that still
		// carries its impostors has been rebuilt without them.
		if ( this.pieces ) this.stream.group.add( this.pieces.group );

	}

	get pinnedGlows() {

		return [ ...this.cells.values() ].filter( cell => cell.pinned ).flatMap( cell => cell.glows );

	}

	get streamedGlows() {

		return [ ...this.cells.values() ].filter( cell => ! cell.pinned ).flatMap( cell => cell.glows );

	}

	async #prepare( cell ) {

		if ( cell.ids.length ) {

			const atlas = { ...this.atlas, parcels: cell.ids.map( id => this.parcels.get( id ) ) };
			const neon = new Neon( atlas, cell.buildings, this.factory ).build();
			cell.glows = neon.glows;
			cell.pinned = [ ...cell.buildings.values() ].some( building => building.hasInterior );
			cell.windows = new LitWindows( atlas, cell.buildings, this.factory );
			cell.group.add( neon.group, cell.windows.build( { enabled: this.interiors } ) );
			if ( this.haze ) {

				cell.haze = Haze.build( neon.glows, this.haze );
				if ( cell.haze ) cell.group.add( cell.haze );

			}

		}
		this.night?.addGroup( cell.group );
		// A cell brings the plans it is the first to stand on, and each of those
		// can bring a batch with a program the city has not compiled yet.
		await this.warmup?.warmAll( this.pieces?.group );
		await this.warmup?.warmAll( cell.group );
		// One fixed body for the whole cell: every kit building in it is a
		// compound of cuboids, with nothing to cook across frames.
		if ( cell.boxColliders?.length ) this.colliders.addBoxes( `kit:${cell.id}`, cell.boxColliders );
		for ( const [ id, geometry ] of cell.shellColliders ) {

			if ( ! await this.colliders.addBand( `shell:${id}`, geometry ) ) throw new Error( `shell ${id}: collision admission cancelled` );
			geometry?.dispose();

		}
		cell.shellColliders.clear();
		new DoorColliders( this.physics, cell.doors );

	}

	#remove( cell ) {

		this.colliders.dropBand( `kit:${cell.id}` );
		for ( const id of cell.ids ) this.colliders.dropBand( `shell:${id}` );
		for ( const door of cell.doors ) for ( const leaf of door.pivots ) {

			if ( leaf.collision ) this.physics.remove( leaf.collision );
			leaf.collision = null;

		}
		cell.windows?.dispose();
		cell.windows?.group.removeFromParent();
		if ( cell.haze ) {

			cell.haze.geometry.dispose();
			cell.haze.material.dispose();
			cell.haze.removeFromParent();

		}
		this.cells.delete( cell.id );
		this.onFixturesChanged?.();

	}

}
