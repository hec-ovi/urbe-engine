import { ShellStream } from './city/streaming/ShellStream.js';
import { Neon } from './city/Neon.js';
import { LitWindows } from './city/LitWindows.js';
import { DoorColliders } from './physics/index.js';
import { Haze } from './light/Haze.js';

/** Binds shell admission to the game's render, fixture and physics ports. */
export class ShellScene {

	constructor( { atlas, catalog, factory, buildings, loadBuildings, physics, colliders, interiors, haze } ) {

		this.atlas = atlas;
		this.parcels = new Map( atlas.parcels.map( parcel => [ parcel.id, parcel ] ) );
		Object.assign( this, { factory, physics, colliders, interiors, haze } );
		this.cells = new Map();
		this.stream = new ShellStream( {
			catalog, factory, buildings, loadBuildings,
			prepare: cell => this.#prepare( cell ),
			added: cell => { this.cells.set( cell.id, cell ); this.onFixturesChanged?.(); },
			removed: cell => this.#remove( cell )
		} );

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
		await this.warmup?.warmAll( cell.group );
		for ( const [ id, geometry ] of cell.shellColliders ) {

			if ( ! await this.colliders.addBand( `shell:${id}`, geometry ) ) throw new Error( `shell ${id}: collision admission cancelled` );
			geometry?.dispose();

		}
		cell.shellColliders.clear();
		new DoorColliders( this.physics, cell.doors );

	}

	#remove( cell ) {

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
