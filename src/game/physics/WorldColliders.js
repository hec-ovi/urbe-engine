import { BandAdmission } from './BandAdmission.js';
import { HitchLog } from '../debug/HitchLog.js';

/**
 * Installs exact static geometry, cuboid compounds and streamed floor
 * collision. Triangle sources prepare in bounded pieces before becoming solid;
 * cuboids are solid the moment they are admitted. Every admission is held by
 * its id and released by `dropBand`.
 */
export class WorldColliders {

	/** @param hitches the log every cooked piece and cuboid compound is named in */
	constructor( physics, { hitches = new HitchLog() } = {} ) {

		this.physics = physics;
		this.hitches = hitches;
		this.live = new Map();
		this.pending = new Map();
		this.triangles = 0;
		this.boxes = 0;

	}

	/** Prepares exact static triangles in bounded pieces before enabling each source. */
	async addStaticsAsync( geometries, { sliceMs = 8, release = false } = {} ) {

		let since = performance.now();

		let index = 0;
		for ( const item of geometries ) {

			const [ label, geometry ] = labelled( item, index );
			try {

				const admission = new BandAdmission( this.physics, geometry, this.hitches );
				await admission.prepare();
				this.triangles += admission.handles.reduce( ( sum, handle ) => sum + handle.triangles, 0 );

			} catch ( error ) {

				throw new Error( `${label} collider failed: ${error?.message ?? error}`, { cause: error } );

			} finally {

				if ( release ) geometry?.dispose();

			}
			index ++;

			if ( performance.now() - since >= sliceMs ) {

				await taskYield();
				since = performance.now();

			}

		}

	}

	/** Installs fixed posts across frames during scene loading. */
	async addPostsAsync( posts ) {

		let since = performance.now();
		for ( const post of posts ) {

			this.physics.addPost( post );
			if ( performance.now() - since >= 4 ) {

				await taskYield();
				since = performance.now();

			}

		}

	}

	/**
	 * A cuboid compound becomes solid at once: cuboids need no cooking, so there
	 * is nothing to spread across frames. One id, one fixed body.
	 * @param boxes [{ center, halfExtents, rotationY }]
	 */
	addBoxes( id, boxes ) {

		if ( this.live.has( id ) ) return true;
		const handle = this.hitches.time( `cuboids ${id}`, () => this.physics.addBoxes( boxes ) );
		this.live.set( id, { boxes: handle.boxes, cancel: () => this.physics.remove( handle ) } );
		this.boxes += handle.boxes;
		return true;

	}

	/** Exact floor triangles prepare while disabled, then become solid together. */
	async addBand( id, geometry ) {

		if ( this.live.has( id ) ) return true;
		if ( this.pending.has( id ) ) return this.pending.get( id ).ready;
		const admission = new BandAdmission( this.physics, geometry, this.hitches );
		this.pending.set( id, admission );
		admission.ready = admission.prepare().then( ready => {

			const accepted = ready && ! admission.cancelled && this.pending.get( id ) === admission;
			if ( accepted ) this.live.set( id, admission );
			return accepted;

		} ).finally( () => { if ( this.pending.get( id ) === admission ) this.pending.delete( id ); } );
		return admission.ready;

	}

	/** And stops being solid when the stream takes it out of the scene. */
	dropBand( id ) {

		this.pending.get( id )?.cancel();
		this.pending.delete( id );
		const live = this.live.get( id );
		if ( live ) {

			this.boxes -= live.boxes ?? 0;
			live.cancel();

		}
		this.live.delete( id );

	}

	get liveBands() {

		return this.live.size;

	}

}

function taskYield() {

	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

}

function labelled( item, index ) {

	return Array.isArray( item ) && item.length === 2 && typeof item[ 0 ] === 'string'
		? [ item[ 0 ], item[ 1 ] ]
		: [ `static world geometry ${index}`, item ];

}
