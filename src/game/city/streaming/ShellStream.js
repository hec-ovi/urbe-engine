import * as THREE from 'three/webgpu';
import { BuildingsLoader } from '../BuildingsLoader.js';
import { ShellCells } from './ShellCells.js';
import { SkylineGeometry } from './SkylineGeometry.js';
import { releaseShell } from './ReleaseShell.js';

const yieldTask = () => new Promise( resolve => setTimeout( resolve, 0 ) );

/** Serial spatial admission with original shell geometry and bounded residency. */
export class ShellStream {

	constructor( { catalog, factory, buildings, loadBuildings, cellSize = 128, loadRadius = 250,
		dropRadius = 350, skylineRadius = 1100, prepare, added, removed, onError = console.error,
		loader = new BuildingsLoader( factory ) } ) {

		if ( ! Number.isFinite( cellSize ) || cellSize <= 0 || ! Number.isFinite( loadRadius ) || loadRadius <= 0
			|| ! Number.isFinite( dropRadius ) || dropRadius <= loadRadius || ! Number.isFinite( skylineRadius ) || skylineRadius < dropRadius ) {

			throw new Error( 'E_SHELL_SETTINGS: invalid spatial distances' );

		}
		this.factory = factory;
		this.buildings = buildings;
		this.loadBuildings = loadBuildings;
		this.loader = loader;
		this.loadRadius = loadRadius;
		this.dropRadius = dropRadius;
		this.skylineRadius = skylineRadius;
		this.prepare = prepare;
		this.added = added;
		this.removed = removed;
		this.onError = onError;
		this.grid = new ShellCells( catalog.buildings, cellSize );
		this.group = new THREE.Group();
		this.group.name = 'streamed-city';
		this.doors = [];
		this.entrances = [];
		this.shellColliders = new Map();
		this.centers = new Map( catalog.buildings.map( record => [ record.id, new THREE.Vector3( ...record.center ) ] ) );
		this.pinned = new Set( [ ...buildings ].filter( ( [ , source ] ) => source.hasInterior ).map( ( [ id ] ) => id ) );
		this.resident = new Map();
		this.failed = new Set();
		this.pending = null;
		this.revision = 0;
		this.closed = false;
		this.skyline = null;

	}

	get triangles() {

		return [ ...this.resident.values() ].reduce( ( total, cell ) => total + cell.triangles, 0 );

	}

	async load( position ) {

		this.update( position );
		await this.settled();
		if ( this.failed.size ) throw new Error( 'E_SHELL_LOAD: initial shell admission failed' );
		return this;

	}

	update( position ) {

		if ( this.closed ) return;
		if ( ! Number.isFinite( position.x ) || ! Number.isFinite( position.z ) ) throw new Error( 'E_SHELL_POSITION: expected finite XZ' );
		if ( this.position && Math.hypot( position.x - this.position.x, position.z - this.position.z ) < 16 ) return;
		this.position = { x: position.x, z: position.z };
		this.revision ++;
		this.failed.clear();
		if ( ! this.pending ) this.pending = this.#run().finally( () => { this.pending = null; } );

	}

	async settled() {

		while ( this.pending ) await this.pending;

	}

	async dispose() {

		this.closed = true;
		await this.settled();
		for ( const cell of this.resident.values() ) this.#drop( cell );
		if ( this.skyline ) releaseShell( { group: this.skyline } );
		this.group.removeFromParent();

	}

	#wanted( cell, radius ) {

		return cell.records.some( record => this.pinned.has( record.id ) ) || this.grid.distance( cell, this.position ) <= radius;

	}

	async #run() {

		let seen = - 1;
		while ( ! this.closed && seen !== this.revision ) {

			seen = this.revision;
			const candidates = [ ...this.grid.cells.values() ].filter( cell => this.#wanted( cell, this.loadRadius ) );
			candidates.sort( ( a, b ) => this.grid.distance( a, this.position ) - this.grid.distance( b, this.position ) );
			for ( const cell of candidates ) {

				if ( this.closed ) return;
				if ( this.resident.has( cell.id ) || this.failed.has( cell.id ) || ! this.#wanted( cell, this.loadRadius ) ) continue;
				await this.#admit( cell );

			}
			if ( this.closed ) return;
			await this.#distant();

		}

	}

	async #admit( spatial ) {

		let cell;
		try {

			const ids = spatial.records.map( record => record.id );
			const missing = ids.filter( id => ! this.buildings.has( id ) );
			const incoming = missing.length ? await this.loadBuildings( missing ) : new Map();
			const sources = new Map( ids.map( id => [ id, this.buildings.get( id ) ?? incoming.get( id ) ] ) );
			if ( [ ...sources ].some( ( [ id, source ] ) => ! source || source.parcelId !== id ) ) throw new Error( 'E_SHELL_SOURCE: catalog/source mismatch' );
			if ( this.closed || ! this.#wanted( spatial, this.loadRadius ) ) return;
			cell = { ...await this.loader.load( sources ), id: spatial.id, ids, buildings: sources, spatial };
			await this.prepare?.( cell );
			if ( this.closed || ! this.#wanted( spatial, this.loadRadius ) ) {

				this.removed?.( cell );
				releaseShell( cell );
				return;

			}
			this.added?.( cell );
			for ( const [ id, source ] of sources ) this.buildings.set( id, source );
			for ( const [ id, geometry ] of cell.shellColliders ) this.shellColliders.set( id, geometry );
			this.doors.push( ...cell.doors );
			this.entrances.push( ...cell.entrances );
			this.resident.set( cell.id, cell );
			cell.group.visible = false;
			this.group.add( cell.group );

		} catch ( error ) {

			if ( cell ) { this.removed?.( cell ); releaseShell( cell ); }
			this.failed.add( spatial.id );
			this.onError( error );

		}

	}

	async #distant() {

		const retained = new Set( [ ...this.resident.values() ].filter( cell => this.#wanted( cell.spatial, this.dropRadius ) ).map( cell => cell.id ) );
		const geometry = new SkylineGeometry( this.factory );
		let slice = performance.now();
		for ( const cell of this.grid.cells.values() ) {

			if ( this.closed ) return;
			if ( retained.has( cell.id ) || this.grid.distance( cell, this.position ) > this.skylineRadius ) continue;
			for ( const record of cell.records ) geometry.add( record );
			if ( performance.now() - slice > 4 ) { await yieldTask(); slice = performance.now(); }

		}
		const group = await geometry.finish( yieldTask );
		try { await this.prepare?.( { id: 'skyline', group, ids: [], buildings: new Map(), doors: [], shellColliders: new Map() } ); }
		catch ( error ) { releaseShell( { group } ); this.onError( error ); return; }
		if ( this.closed ) { releaseShell( { group } ); return; }
		for ( const cell of this.resident.values() ) if ( ! retained.has( cell.id ) ) this.#drop( cell );
		if ( this.skyline ) releaseShell( { group: this.skyline } );
		this.skyline = group;
		this.group.add( group );
		for ( const cell of this.resident.values() ) cell.group.visible = true;

	}

	#drop( cell ) {

		this.removed?.( cell );
		for ( const id of cell.ids ) {

			this.buildings.delete( id );
			this.shellColliders.delete( id );

		}
		removeEntries( this.doors, new Set( cell.doors ) );
		removeEntries( this.entrances, new Set( cell.entrances ) );
		this.resident.delete( cell.id );
		releaseShell( cell );

	}

}

function removeEntries( array, entries ) {

	let write = 0;
	for ( const item of array ) if ( ! entries.has( item ) ) array[ write ++ ] = item;
	array.length = write;

}
