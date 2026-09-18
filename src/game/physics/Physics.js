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
	 * One fixed body carrying a compound of upright cuboids. Rapier keeps a
	 * compound as a single broad-phase entry, so a whole cell of kit buildings
	 * costs one body and no triangle cooking at all.
	 * @param boxes [{ center: [x,y,z], halfExtents: [hx,hy,hz], rotationY }]
	 */
	addBoxes( boxes ) {

		const body = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed() );

		try {

			for ( const { center, halfExtents, rotationY = 0 } of boxes ) {

				if ( ! finiteTriple( center ) || ! finiteTriple( halfExtents ) || halfExtents.some( ( value ) => value <= 0 ) || ! Number.isFinite( rotationY ) ) {

					throw new Error( 'E_PHYSICS_BOXES: a cuboid needs a finite centre, positive half extents and a finite yaw' );

				}
				this.world.createCollider(
					RAPIER.ColliderDesc.cuboid( halfExtents[ 0 ], halfExtents[ 1 ], halfExtents[ 2 ] ).setDensity( 0 )
						.setTranslation( center[ 0 ], center[ 1 ], center[ 2 ] )
						.setRotation( { x: 0, y: Math.sin( rotationY / 2 ), z: 0, w: Math.cos( rotationY / 2 ) } ),
					body
				);

			}

			return { body, boxes: boxes.length, triangles: 0 };

		} catch ( error ) { this.world.removeRigidBody( body ); throw error; }

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
