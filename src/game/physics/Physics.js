import RAPIER from '@dimforge/rapier3d-compat';

const STEP = 1 / 60;
const MAX_STEPS = 4;

/**
 * The Rapier world on a fixed 1/60 step, decoupled from the render tick.
 * Everything in the city is a fixed body, so there is no dynamic set to sleep;
 * the only thing that moves through it is the player's character collider.
 */
export class Physics {

	static async create() {

		await RAPIER.init();

		return new Physics( new RAPIER.World( { x: 0, y: - 9.81, z: 0 } ) );

	}

	constructor( world ) {

		this.rapier = RAPIER;
		this.world = world;
		this.world.timestep = STEP;
		this.accumulator = 0;

	}

	/** @returns how many fixed steps ran this frame. */
	step( delta ) {

		this.accumulator = Math.min( this.accumulator + delta, STEP * MAX_STEPS );
		let steps = 0;

		while ( this.accumulator >= STEP ) {

			this.world.step();
			this.accumulator -= STEP;
			steps ++;

		}

		return steps;

	}

	/** A fixed trimesh body from a three.js geometry, in world space. */
	addTrimesh( geometry ) {

		const position = geometry.getAttribute( 'position' );
		const vertices = position.array instanceof Float32Array
			? position.array
			: new Float32Array( position.array );
		const indices = geometry.index
			? new Uint32Array( geometry.index.array )
			: sequentialTriangleIndices( position.count );

		const body = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed() );
		const collider = this.world.createCollider( RAPIER.ColliderDesc.trimesh( vertices, indices ), body );

		return { body, collider, triangles: indices.length / 3 };

	}

	/**
	 * A fixed upright cylinder standing on the ground: street furniture the
	 * player bumps into, at a fraction of what the same shape costs as a
	 * trimesh.
	 * @param post { x, z, base, height, radius }
	 */
	addPost( { x, z, base, height, radius } ) {

		const body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.fixed().setTranslation( x, base + height / 2, z )
		);
		this.world.createCollider( RAPIER.ColliderDesc.cylinder( height / 2, radius ), body );

	}

	remove( handle ) {

		if ( ! handle ) return;

		this.world.removeRigidBody( handle.body );

	}

}

/** Dense triangle indices without an intermediate boxed JavaScript array. */
export function sequentialTriangleIndices( count ) {

	const indices = new Uint32Array( count );

	for ( let index = 0; index < count; index ++ ) indices[ index ] = index;

	return indices;

}
