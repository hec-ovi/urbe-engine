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

	/**
	 * One fixed step now, whatever the accumulator holds: colliders admitted
	 * or enabled since the last step then answer queries. For a world that
	 * holds still before anything dynamic moves in it, as a game does while
	 * it opens paused.
	 */
	refresh() {

		this.world.step();

	}

	/** The solid below an infinite horizontal plane. */
	addHalfSpace( elevation ) {

		if ( ! Number.isFinite( elevation ) ) throw new Error( 'E_PHYSICS_FLOOR: elevation must be finite' );
		const body = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed().setTranslation( 0, elevation, 0 ) );
		const shape = new RAPIER.HalfSpace( { x: 0, y: 1, z: 0 } );
		const collider = this.world.createCollider( new RAPIER.ColliderDesc( shape ), body );
		return { body, collider, triangles: 0 };

	}

	/** A fixed trimesh body from a three.js geometry, in world space. */
	addTrimesh( geometry, { enabled = true } = {} ) {

		const position = geometry.getAttribute( 'position' );
		const vertices = position.array instanceof Float32Array
			? position.array
			: new Float32Array( position.array );
		const indices = geometry.index
			? new Uint32Array( geometry.index.array )
			: sequentialTriangleIndices( position.count );

		const body = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed().setEnabled( enabled ) );
		try {

			// Fixed surfaces need no mass or inertia calculation when admitted.
			const collider = this.world.createCollider( RAPIER.ColliderDesc.trimesh( vertices, indices ).setDensity( 0 ), body );
			return { body, collider, triangles: indices.length / 3 };

		} catch ( error ) { this.world.removeRigidBody( body ); throw error; }

	}

	/** A moving surface in body-local coordinates with a world-space rigid pose. */
	addKinematicTrimesh( geometry, position, rotation = { x: 0, y: 0, z: 0, w: 1 } ) {

		const attribute = geometry.getAttribute( 'position' );
		const vertices = attribute.array instanceof Float32Array
			? attribute.array
			: new Float32Array( attribute.array );
		const indices = geometry.index
			? new Uint32Array( geometry.index.array )
			: sequentialTriangleIndices( attribute.count );
		const body = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.kinematicPositionBased()
				.setTranslation( position.x, position.y, position.z ).setRotation( rotation )
		);
		const collider = this.world.createCollider( RAPIER.ColliderDesc.trimesh( vertices, indices ), body );

		return { body, collider, triangles: indices.length / 3 };

	}

	/**
	 * One fixed body carrying a compound of upright cuboids: one collider whose
	 * shape is every cuboid at its place, so Rapier keeps a whole floor or a
	 * whole cell of kit buildings as a single broad-phase entry and builds it
	 * in one call, where a collider per cuboid was a thousand calls and a
	 * thousand entries for the next step to fit into its tree.
	 * @param boxes [{ center: [x,y,z], halfExtents: [hx,hy,hz], rotationY }]
	 */
	addBoxes( boxes ) {

		const shapes = [], positions = [], rotations = [];
		for ( const { center, halfExtents, rotationY = 0 } of boxes ) {

			if ( ! finiteTriple( center ) || ! finiteTriple( halfExtents ) || halfExtents.some( ( value ) => value <= 0 ) || ! Number.isFinite( rotationY ) ) {

				throw new Error( 'E_PHYSICS_BOXES: a cuboid needs a finite centre, positive half extents and a finite yaw' );

			}
			shapes.push( new RAPIER.Cuboid( halfExtents[ 0 ], halfExtents[ 1 ], halfExtents[ 2 ] ) );
			positions.push( { x: center[ 0 ], y: center[ 1 ], z: center[ 2 ] } );
			rotations.push( { x: 0, y: Math.sin( rotationY / 2 ), z: 0, w: Math.cos( rotationY / 2 ) } );

		}
		const body = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed() );
		if ( shapes.length ) this.world.createCollider( RAPIER.ColliderDesc.compound( shapes, positions, rotations ).setDensity( 0 ), body );

		return { body, boxes: boxes.length, triangles: 0 };

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

function finiteTriple( values ) {

	return Array.isArray( values ) && values.length === 3 && values.every( ( value ) => Number.isFinite( value ) );

}

/** Dense triangle indices without an intermediate boxed JavaScript array. */
export function sequentialTriangleIndices( count ) {

	const indices = new Uint32Array( count );

	for ( let index = 0; index < count; index ++ ) indices[ index ] = index;

	return indices;

}
