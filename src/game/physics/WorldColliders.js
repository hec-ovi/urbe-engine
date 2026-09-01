/**
 * What the player can stand on and cannot walk through. The ground and every
 * building shell are fixed trimeshes built once: the shells carry their real
 * door and window openings, so a doorway is walkable without any special case.
 * Street furniture is a cylinder each, not a mesh.
 *
 * Interiors are heavy and arrive a floor band at a time, so a band becomes a
 * trimesh when the stream puts it in the scene and goes away when it takes it
 * out: what the player can walk on is exactly what they can see.
 */
export class WorldColliders {

	constructor( physics ) {

		this.physics = physics;
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

	/** One floor band of one building becomes solid. */
	addBand( id, geometry ) {

		if ( ! geometry || this.live.has( id ) ) return;

		this.live.set( id, this.physics.addTrimesh( geometry ) );

	}

	/** And stops being solid when the stream takes it out of the scene. */
	dropBand( id ) {

		const handle = this.live.get( id );

		if ( ! handle ) return;

		this.physics.remove( handle );
		this.live.delete( id );

	}

	get liveBands() {

		return this.live.size;

	}

}
