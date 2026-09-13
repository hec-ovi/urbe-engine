import { BandAdmission } from './BandAdmission.js';

/**
 * Installs exact static geometry and admits streamed floor collision.
 * Each source prepares in bounded pieces before becoming solid.
 */
export class WorldColliders {

	constructor( physics ) {

		this.physics = physics;
		this.live = new Map();
		this.pending = new Map();
		this.triangles = 0;

	}

	/** Prepares exact static triangles in bounded pieces before enabling each source. */
	async addStaticsAsync( geometries, { sliceMs = 8, release = false } = {} ) {

		let since = performance.now();

		let index = 0;
		for ( const item of geometries ) {

			const [ label, geometry ] = labelled( item, index );
			try {

				const admission = new BandAdmission( this.physics, geometry );
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

	/** Exact floor triangles prepare while disabled, then become solid together. */
	async addBand( id, geometry ) {

		if ( this.live.has( id ) ) return true;
		if ( this.pending.has( id ) ) return this.pending.get( id ).ready;
		const admission = new BandAdmission( this.physics, geometry );
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
		this.live.get( id )?.cancel();
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
