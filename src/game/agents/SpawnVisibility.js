import * as THREE from 'three/webgpu';

/** Conservative admission for a whole body, including a margin for a camera turn. */
export class SpawnVisibility {

	constructor( camera, { fog = null, occluded = null } = {} ) {

		this.camera = camera;
		this.fog = fog;
		this.occluded = occluded;
		this.frustum = new THREE.Frustum();
		this.matrix = new THREE.Matrix4();
		this.projection = new THREE.Matrix4();
		this.sphere = new THREE.Sphere();
		this.view = new THREE.Vector3();
		this.ready = false;

	}

	update() {

		this.camera.updateMatrixWorld();
		this.projection.copy( this.camera.projectionMatrix );
		this.projection.elements[ 0 ] /= 1.2;
		this.projection.elements[ 5 ] /= 1.2;
		this.frustum.setFromProjectionMatrix( this.matrix.multiplyMatrices( this.projection, this.camera.matrixWorldInverse ), this.camera.coordinateSystem );
		this.ready = true;

	}

	hidden( point, radius = 1 ) {

		if ( ! this.ready ) return false;
		this.sphere.center.set( point.x, point.y + radius, point.z );
		this.sphere.radius = radius;
		if ( this.sphere.center.distanceTo( this.camera.position ) < radius + 6 ) return false;
		if ( ! this.frustum.intersectsSphere( this.sphere ) ) return true;
		this.view.copy( this.sphere.center ).applyMatrix4( this.camera.matrixWorldInverse );
		if ( this.fog?.visibilityAt( this.sphere.center, Math.max( 0, - this.view.z - radius ), radius ) < 0.02 ) return true;
		// Every tested silhouette point must be behind static world geometry.
		if ( ! this.occluded ) return false;
		return [ [ - radius, 0, 0 ], [ radius, 0, 0 ], [ 0, radius, 0 ], [ 0, 0, - radius ], [ 0, 0, radius ] ].every( ( [ x, y, z ] ) =>
			this.occluded( this.camera.position, { x: point.x + x, y: point.y + radius + y, z: point.z + z } ) );

	}

}

/** Walk upstream on the real graph, at most 40 m, to an unseen entry point. */
export function hiddenWalkEntry( routes, entry, hidden, reach = 40 ) {

	const queue = [ { ...entry, walked: 0 } ];
	const visited = new Set();
	for ( let index = 0; index < queue.length; index ++ ) {

		const current = queue[ index ];
		const { edge, direction, distance, walked } = current;
		const key = `${edge.id}:${direction}`;
		if ( visited.has( key ) ) continue;
		visited.add( key );
		const room = distance;
		const limit = Math.min( room, reach - walked );
		for ( let back = 0; back <= limit; back = Math.min( limit, back + 2 ) ) {

			const at = distance - back;
			if ( hidden( routes.pointAt( edge, at, direction ) ) ) return { ...entry, edge, direction, distance: at };
			if ( back === limit ) break;

		}
		if ( walked + room >= reach ) continue;
		const node = direction === 1 ? edge.from : edge.to;
		for ( const id of [ ...( routes.adjacency.get( node ) ?? [] ) ].sort() ) {

			const next = routes.edges.get( id );
			if ( ! next || next === edge || next.kind === 'crossing' ) continue;
			const toward = next.to === node ? 1 : - 1;
			queue.push( { edge: next, direction: toward, distance: next.length, walked: walked + room } );

		}

	}
	return null;

}
