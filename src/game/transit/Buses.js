import * as THREE from 'three/webgpu';
import { transitVehiclesAt } from '../../../../connections/src/index.ts';
import { BusModel } from './BusModel.js';

const DAY = 86400;
/** Past this a bus is a speck behind the night fog, so it takes no instance. */
const DRAW_RADIUS = 320;

/**
 * The buses that are running right now. Where each one is is closed form in
 * the connections library: given the routes and the time of day it returns
 * every in-service vehicle's position and heading, so there is no fleet to
 * simulate, nothing to spawn or despawn, and no drift between what the
 * timetable says and what is on the street. This class only turns that answer
 * into instance matrices.
 *
 * Nothing here holds per-vehicle state, so the cost of a frame is one call to
 * the library plus one matrix per bus in sight.
 */
export class Buses {

	/**
	 * @param routes `networks.transit.routes` per ../../../../connections/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 * @param capacity how many buses may be on screen at once
	 */
	constructor( { routes, factory, capacity } ) {

		this.routes = routes.filter( ( route ) => route.kind === 'bus' );
		this.capacity = capacity;
		this.live = 0;
		this.models = this.routes.length ? new BusModel( factory, capacity ) : null;
		this.group = this.models?.group ?? emptyGroup();
		// The day span runs past midnight, so a night service's last hour is
		// timetabled at 24:00 and beyond while the clock's day seconds wrap at
		// 24:00. Asking again a day later is what keeps that hour on the road.
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

	/**
	 * No delta: a bus's place is a function of the clock alone, so a frame
	 * asks the timetable rather than integrating the last one.
	 * @param player the player's feet, in world metres
	 * @param daySeconds seconds since midnight, the clock's own unit
	 */
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
			.sort( ( a, b ) => a.distance - b.distance )
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

const UP = new THREE.Vector3( 0, 1, 0 );

function emptyGroup() {

	const group = new THREE.Group();
	group.name = 'buses';

	return group;

}
