/**
 * Moving collision for the exact Exterior leaf meshes. Each collider has the
 * same hinge and local triangles as its rendered pivot, then receives that
 * pivot's rotation after every interaction step.
 */
export class DoorColliders {

	constructor( physics, doors ) {

		this.triangles = 0;

		for ( const door of doors ) for ( const leaf of door.pivots ) {

			if ( ! leaf.colliderGeometry ) continue;

			leaf.collision = physics.addKinematicTrimesh( leaf.colliderGeometry, leaf.pivot.position );
			this.triangles += leaf.collision.triangles;
			leaf.colliderGeometry.dispose();
			leaf.colliderGeometry = null;

		}

	}

	sync( door ) {

		for ( const leaf of door.pivots ) {

			if ( ! leaf.collision ) continue;
			leaf.collision.body.setNextKinematicRotation( leaf.pivot.quaternion );

		}

	}

}
