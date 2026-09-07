import { BandAdmission } from './BandAdmission.js';

/**
 * What the player can stand on and cannot walk through. The ground and every
 * building shell are fixed trimeshes built once: the shells carry their real
 * door and window openings, so a doorway is walkable without any special case.
 * Street furniture is a cylinder each, not a mesh.
 *
 * Interior floor bands prepare exact collision pieces across frames, then
 * become solid together. Taking a band out removes every piece.
 */
export class WorldColliders {

	constructor( physics ) {

		this.physics = physics;
		this.live = new Map();
		this.pending = new Map();
		this.triangles = 0;

	}

	/**
	 * One piece of the world that never moves and is always solid: the ground,
	 * a building shell, a bridge deck, a bus shelter. World space, merged.
	 */
	addStatic( geometry, label = 'static world geometry' ) {

		if ( ! geometry ) return;

		try {

			this.triangles += this.physics.addTrimesh( geometry ).triangles;

		} catch ( error ) {

			const position = geometry.getAttribute?.( 'position' );
			const triangles = position ? position.count / 3 : 0;
			throw new Error( `${label} collider failed (${triangles} triangles): ${error?.message ?? error}`, { cause: error } );

		}

	}

	/** @param geometries any iterable of them */
	addStatics( geometries ) {

		let index = 0;
		for ( const item of geometries ) {

			const [ label, geometry ] = labelled( item, index ++ );
			this.addStatic( geometry, label );

		}

	}

	/**
	 * Adds a large set without holding the main thread across the whole city.
	 * Each geometry is still one exact trimesh; the yield only separates cooks.
	 */
	async addStaticsAsync( geometries, { sliceMs = 8, release = false } = {} ) {

		let since = performance.now();

		let index = 0;
		for ( const item of geometries ) {

			const [ label, geometry ] = labelled( item, index );
			try {

				this.addStatic( geometry, label );

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

	/** @param posts [{ x, z, base, height, radius }] lamp poles and the like */
	addPosts( posts ) {

		for ( const post of posts ) this.physics.addPost( post );

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
