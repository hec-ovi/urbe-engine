import * as THREE from 'three/webgpu';
import { transitVehiclesAt } from '../../../../connections/src/index.ts';

const DAY = 86400;
/** Past this a vehicle is hidden by the night fog, so it takes no instance. */
const DRAW_RADIUS = 320;
const UP = new THREE.Vector3( 0, 1, 0 );

/**
 * Places one transit mode directly from Connections' closed-form timetable.
 * It owns render instances only. There is no simulated vehicle position.
 */
export class TimetableVehicles {

	constructor( { routes, kind, factory, capacity, Model, groupName } ) {

		this.routes = routes.filter( ( route ) => route.kind === kind );
		this.capacity = capacity;
		this.live = 0;
		this.models = this.routes.length ? new Model( factory, capacity, kind ) : null;
		this.group = this.models?.group ?? emptyGroup( groupName );
		this.overrun = Math.max( 0, this.routes
			.flatMap( ( route ) => route.service.map( ( period ) => period.end ) )
			.reduce( ( a, b ) => Math.max( a, b ), 0 ) - DAY );

		this.matrix = new THREE.Matrix4();
		this.quaternion = new THREE.Quaternion();
		this.position = new THREE.Vector3();
		this.scale = new THREE.Vector3( 1, 1, 1 );

	}

	get count() {

		return this.live;

	}

	update( player, daySeconds ) {

		if ( ! this.models ) return;

		const vehicles = transitVehiclesAt( this.routes, daySeconds );
		if ( daySeconds < this.overrun ) vehicles.push( ...transitVehiclesAt( this.routes, daySeconds + DAY ) );

		const near = vehicles
			.map( ( vehicle ) => ( {
				vehicle,
				distance: Math.hypot( vehicle.position[ 0 ] - player.x, vehicle.position[ 2 ] - player.z )
			} ) )
			.filter( ( entry ) => entry.distance < DRAW_RADIUS )
			.sort( ( left, right ) => left.distance - right.distance || compareVehicle( left.vehicle, right.vehicle ) )
			.slice( 0, this.capacity );

		near.forEach( ( { vehicle }, slot ) => {

			this.position.fromArray( vehicle.position );
			this.quaternion.setFromAxisAngle( UP, Math.atan2( vehicle.heading[ 0 ], vehicle.heading[ 1 ] ) );
			this.matrix.compose( this.position, this.quaternion, this.scale );
			this.models.setInstance( slot, this.matrix );

		} );

		this.models.commit( near.length );
		this.live = near.length;

	}

}

function compareVehicle( left, right ) {

	return left.routeId.localeCompare( right.routeId )
		|| left.position[ 0 ] - right.position[ 0 ]
		|| left.position[ 1 ] - right.position[ 1 ]
		|| left.position[ 2 ] - right.position[ 2 ];

}

function emptyGroup( name ) {

	const group = new THREE.Group();
	group.name = name;

	return group;

}
