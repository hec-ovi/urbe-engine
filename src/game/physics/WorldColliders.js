const INTERIOR_LOAD_RADIUS = 55;
const INTERIOR_DROP_RADIUS = 75;

/**
 * What the player can stand on and cannot walk through. The ground and every
 * building shell are fixed trimeshes built once: the shells carry their real
 * door and window openings, so a doorway is walkable without any special case.
 * Street furniture is a cylinder each, not a mesh. Interiors are heavy, so each
 * building's floors and stairs become a collider only while the player is near
 * it, and go away again further out. Hysteresis between the two radii stops a
 * boundary from thrashing.
 */
export class WorldColliders {

	constructor( physics ) {

		this.physics = physics;
		this.interiors = new Map();
		this.live = new Map();
		this.triangles = 0;

	}

	/** @param groundGeometry merged ground surface + curbs, world space */
	addGround( groundGeometry ) {

		this.triangles += this.physics.addTrimesh( groundGeometry ).triangles;

	}

	/** @param posts [{ x, z, base, height, radius }] lamp poles and the like */
	addPosts( posts ) {

		for ( const post of posts ) this.physics.addPost( post );

	}

	/** @param shells Map<parcelId, BufferGeometry|null> from BuildingsLoader */
	addShells( shells ) {

		for ( const geometry of shells.values() ) {

			if ( geometry ) this.triangles += this.physics.addTrimesh( geometry ).triangles;

		}

	}

	/** @param interiors Map<parcelId, { geometry, center }> */
	registerInteriors( interiors ) {

		for ( const [ parcelId, entry ] of interiors ) {

			if ( entry.geometry ) this.interiors.set( parcelId, entry );

		}

	}

	/** Loads and drops interior colliders around the player. Cheap to call every frame. */
	update( position ) {

		for ( const [ parcelId, entry ] of this.interiors ) {

			const distance = entry.center.distanceTo( position );
			const loaded = this.live.has( parcelId );

			if ( ! loaded && distance < INTERIOR_LOAD_RADIUS ) {

				this.live.set( parcelId, this.physics.addTrimesh( entry.geometry ) );

			} else if ( loaded && distance > INTERIOR_DROP_RADIUS ) {

				this.physics.remove( this.live.get( parcelId ) );
				this.live.delete( parcelId );

			}

		}

	}

	get liveInteriors() {

		return this.live.size;

	}

}
