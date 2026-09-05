import { Quaternion, Vector3 } from 'three/webgpu';

/**
 * Moving collision for the exact Exterior leaf meshes. Each collider has the
 * same local triangles as its rendered pivot and receives its complete world
 * translation and rotation after every interaction step.
 */
export class DoorColliders {

	constructor( physics, doors ) {

		this.triangles = 0;
		this.position = new Vector3();
		this.rotation = new Quaternion();

		for ( const door of doors ) for ( const leaf of door.pivots ) {

			if ( ! leaf.colliderGeometry ) continue;

			this.#pose( leaf.pivot );
			leaf.collision = physics.addKinematicTrimesh( leaf.colliderGeometry, this.position, this.rotation );
			this.triangles += leaf.collision.triangles;
			leaf.colliderGeometry.dispose();
			leaf.colliderGeometry = null;

		}

	}

	sync( door ) {

		for ( const leaf of door.pivots ) {

			if ( ! leaf.collision ) continue;
			this.#pose( leaf.pivot );
			leaf.collision.body.setNextKinematicTranslation( this.position );
			leaf.collision.body.setNextKinematicRotation( this.rotation );

		}

	}

	#pose( pivot ) {

		pivot.getWorldPosition( this.position );
		pivot.getWorldQuaternion( this.rotation );

	}

}
