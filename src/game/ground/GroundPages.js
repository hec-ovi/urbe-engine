import { groundPageGeometry, disposePageGeometry } from './GroundPageGeometry.js';

/** One material mesh per 512 m page, retaining unchanged pages across movement. */
export class GroundPages {

	constructor( group ) {

		this.group = group;
		this.pages = new Map();

	}

	async update( tiles, { prepare, wanted } ) {

		const desired = new Map();
		for ( const [ id, tile ] of tiles ) {

			if ( ! desired.has( tile.page ) ) desired.set( tile.page, new Map() );
			desired.get( tile.page ).set( id, tile );

		}
		for ( const [ id, page ] of this.pages ) if ( ! desired.has( id ) ) this.remove( id, page );
		for ( const [ id, owners ] of desired ) {

			if ( ! wanted() ) return;
			const existing = this.pages.get( id );
			const unchanged = existing && ! existing.dirty && existing.tiles.size === owners.size && [ ...owners ].every( ( [ key, tile ] ) => existing.tiles.get( key ) === tile );
			const page = unchanged ? existing : { tiles: owners, group: await groundPageGeometry( owners, wanted ), prepared: null };
			if ( ! page.group ) return;
			page.group.name = id;
			try {

				page.pending = true;
				if ( prepare && page.prepared !== prepare ) {

					await prepare( page.group, { wanted } );
					if ( ! wanted() ) continue;
					page.prepared = prepare;

				}
				if ( ! wanted() ) continue;
				if ( ! unchanged ) {

					if ( existing ) this.remove( id, existing );
					this.pages.set( id, page );
					this.group.add( page.group );

				}
				for ( const tile of owners.values() ) tile.visible = true;

			} finally {

				page.pending = false;
				if ( page.retired || this.pages.get( id ) !== page ) disposePageGeometry( page.group );

			}

		}

	}

	drop( tileId ) {

		for ( const [ id, page ] of this.pages ) if ( page.tiles.delete( tileId ) ) {

			if ( ! page.tiles.size ) this.remove( id, page );
			else page.dirty = true;

		}

	}

	remove( id, page ) {

		this.pages.delete( id );
		page.group.removeFromParent();
		if ( page.pending ) page.retired = true;
		else disposePageGeometry( page.group );

	}

	dispose() {

		for ( const [ id, page ] of this.pages ) this.remove( id, page );

	}

}
