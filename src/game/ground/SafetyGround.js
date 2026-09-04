import * as THREE from 'three/webgpu';
import { stationDepth } from './Stations.js';

/** An unbounded solid below authored geometry, with a render-distance surface. */
export class SafetyGround {

	constructor( { atlas, buildings, groups, physics, factory, camera } ) {

		let bottom = stationDepth( atlas );
		const bounds = new THREE.Box3();
		for ( const group of groups ) {

			bounds.setFromObject( group );
			if ( ! bounds.isEmpty() ) bottom = Math.min( bottom, bounds.min.y );

		}
		for ( const building of buildings.values() ) {

			for ( const floor of building.blueprint.floors ) bottom = Math.min( bottom, floor.elevation );

		}
		for ( const body of atlas.hydrology?.bodies ?? [] ) bottom = Math.min( bottom, body.elevation - body.depth );
		this.elevation = bottom - 2;
		this.physics = physics;
		this.handle = physics.addHalfSpace( this.elevation );
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry( 2, 2 ).rotateX( - Math.PI / 2 ),
			factory.build( 'cyberpunk/road/high_rich', 'street' )
		);
		this.mesh.name = 'ground:safety';
		this.mesh.receiveShadow = true;
		this.update( camera );

	}

	update( camera ) {

		const halfHeight = Math.tan( THREE.MathUtils.degToRad( camera.getEffectiveFOV() ) / 2 );
		const radius = camera.far * Math.hypot( 1, halfHeight, halfHeight * camera.aspect );
		this.mesh.position.set( camera.position.x, this.elevation, camera.position.z );
		this.mesh.scale.set( radius, 1, radius );
		const positions = this.mesh.geometry.getAttribute( 'position' );
		const uv = this.mesh.geometry.getAttribute( 'uv' );
		for ( let i = 0; i < positions.count; i ++ ) {

			uv.setXY( i, positions.getX( i ) * radius + camera.position.x, positions.getZ( i ) * radius + camera.position.z );

		}
		uv.needsUpdate = true;

	}

	dispose() {

		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.physics.remove( this.handle );
		this.handle = null;

	}

}
