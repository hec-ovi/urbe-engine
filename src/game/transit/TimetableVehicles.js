import * as THREE from 'three/webgpu';
import { stepPresence } from '../agents/Presence.js';
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
		this.residents = new Map();
		this.epoch = 0;
		this.lastTime = null;
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

	update( player, daySeconds, delta = 1, visibility = null ) {

		if ( ! this.models ) return;

		if ( this.lastTime !== null && this.lastTime - daySeconds > DAY / 2 ) this.epoch += DAY;
		this.lastTime = daySeconds;
		const vehicles = tripsAt( this.routes, daySeconds, this.epoch );
		if ( daySeconds < this.overrun ) vehicles.push( ...tripsAt( this.routes, daySeconds + DAY, this.epoch - DAY ) );

		const distanceTo = vehicle => Math.hypot( vehicle.position[ 0 ] - player.x, vehicle.position[ 2 ] - player.z );
		const active = new Map( vehicles.map( vehicle => [ vehicle.id, vehicle ] ) );
		for ( const [ id, resident ] of this.residents ) {

			const vehicle = active.get( id );
			if ( vehicle ) resident.vehicle = vehicle;
			const point = new THREE.Vector3( ...resident.vehicle.position );
			const distance = distanceTo( resident.vehicle );
			const hidden = visibility?.hidden( point, 8 ) ?? true;
			const leaving = ! vehicle || distance > DRAW_RADIUS + 60 || ( distance > DRAW_RADIUS + 30 && hidden );
			resident.presence = leaving && hidden ? 0 : stepPresence( resident.presence, leaving, delta );
			if ( leaving && resident.presence === 0 ) this.residents.delete( id );

		}
		for ( const vehicle of vehicles.sort( ( a, b ) => distanceTo( a ) - distanceTo( b ) || compareVehicle( a, b ) ) ) {

			if ( this.residents.size >= this.capacity ) break;
			if ( distanceTo( vehicle ) >= DRAW_RADIUS || this.residents.has( vehicle.id ) ) continue;
			this.residents.set( vehicle.id, { vehicle, presence: stepPresence( 0, false, delta ) } );

		}
		const near = [ ...this.residents.values() ];

		near.forEach( ( { vehicle, presence }, slot ) => {

			this.position.fromArray( vehicle.position );
			this.quaternion.setFromAxisAngle( UP, Math.atan2( vehicle.heading[ 0 ], vehicle.heading[ 1 ] ) );
			this.matrix.compose( this.position, this.quaternion, this.scale );
			this.models.setInstance( slot, this.matrix, presence );

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

/** Name each position with its exact scheduled departure, retaining Connections order. */
function tripsAt( routes, time, epoch ) {

	const departures = [];
	for ( const route of routes ) for ( const period of route.service ) {

		const duration = route.template.at( - 1 ).arrive;
		if ( duration <= 0 ) continue;
		const first = period.start + period.phase;
		for ( let k = Math.max( 0, Math.ceil( ( time - duration - first ) / period.headway ) ); ; k ++ ) {

			const departure = first + k * period.headway;
			if ( departure > time || departure >= period.end ) break;
			departures.push( `trip:${route.id.length}:${route.id}:${departure + epoch}` );

		}

	}
	return transitVehiclesAt( routes, time ).map( ( vehicle, index ) => ( { ...vehicle, id: departures[ index ] } ) );

}
