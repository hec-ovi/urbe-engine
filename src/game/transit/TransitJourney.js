import { TransitJourneyBoundary } from './TransitJourneyBoundary.js';

const DAY = 86400;
const HALF_DAY = DAY / 2;
export const TRANSIT_BOARD_REACH = 3;

const ERROR = {
	invalid: 'E_TRANSIT_INVALID_DATA',
	absentRoute: 'E_TRANSIT_ABSENT_ROUTE',
	wrongPlace: 'E_TRANSIT_WRONG_PLACE',
	outOfService: 'E_TRANSIT_OUT_OF_SERVICE',
	missed: 'E_TRANSIT_MISSED_VEHICLE',
	moving: 'E_TRANSIT_MOVING_VEHICLE',
	outOfReach: 'E_TRANSIT_OUT_OF_REACH',
	alreadyAboard: 'E_TRANSIT_ALREADY_ABOARD',
	notAboard: 'E_TRANSIT_NOT_ABOARD'
};

/**
 * Serializable boarding state over Atlas places and Connections timetables.
 * Vehicle locations are always recomputed from route shape and schedule time.
 */
export class TransitJourney {

	constructor( { atlas, routes, state = initialState(), boundary = new TransitJourneyBoundary() } ) {

		this.boundary = boundary;
		this.atlas = atlas;
		this.routes = Array.isArray( routes ) ? routes : [];
		this.routeById = new Map();
		this.places = new Map();
		const stateValid = this.boundary.valid( 'journey-state', state );
		this._state = stateValid ? clone( state ) : initialState();
		this.dataValid = stateValid && this.boundary.valid( 'transit-data', { atlas, routes } )
			&& this.#indexAndValidate();
		this.overrun = this.dataValid ? Math.max( 0, ...this.routes
			.flatMap( ( route ) => route.service.map( ( period ) => period.end - DAY ) ) ) : 0;
		if ( this.dataValid && this._state.status === 'aboard' ) this.dataValid = this.#validRestoredTrip();

	}

	get state() {

		return clone( this._state );

	}

	/** Lists only services dwelling at this published place and within reach now. */
	listBoardable( request ) {

		if ( ! this.dataValid || ! this.boundary.valid( 'service-query', request ) ) return this.#out( 'service-list', fail( ERROR.invalid ) );
		if ( this._state.status === 'aboard' ) return this.#out( 'service-list', fail( ERROR.alreadyAboard ) );

		const place = this.places.get( placeKey( request.place ) );
		if ( ! place ) return this.#out( 'service-list', fail( ERROR.wrongPlace ) );
		const clock = this.#advanceClock( request.daySeconds );
		const queryTimes = [ clock ];
		if ( this._state.clock.dayOffset === 0 && request.daySeconds < this.overrun ) queryTimes.push( clock + DAY );

		const services = queryTimes.flatMap( ( time ) => this.#boardableAt( place, request.position, time ) );
		const unique = deduplicateServices( services );
		if ( unique.length && queryTimes.length > 1 && unique[ 0 ].arrivalTime >= DAY ) {

			this._state.clock.dayOffset = DAY;

		}

		return this.#out( 'service-list', { ok: true, services: unique, state: this.state } );

	}

	/** Boards one exact route departure while it dwells at the requested stop. */
	board( request ) {

		if ( ! this.dataValid || ! this.boundary.valid( 'board-request', request ) ) return this.#out( 'board-result', fail( ERROR.invalid ) );
		if ( this._state.status === 'aboard' ) return this.#out( 'board-result', fail( ERROR.alreadyAboard ) );
		const route = this.routeById.get( request.routeId );
		if ( ! route ) return this.#out( 'board-result', fail( ERROR.absentRoute ) );

		const place = this.places.get( placeKey( request.place ) );
		const stop = route.stops[ request.stopIndex ];
		if ( ! place || ! stop || place.kind !== placeKind( route.kind ) || place.id !== stop.stopId ) {

			return this.#out( 'board-result', fail( ERROR.wrongPlace ) );

		}
		if ( tripIdentity( route.id, request.serviceDeparture ) !== request.tripId
			|| !scheduledDeparture( route, request.serviceDeparture ) ) {

			return this.#out( 'board-result', fail( ERROR.outOfService ) );

		}

		const currentTime = this.#timeForTrip( request.daySeconds, request.serviceDeparture, routeDuration( route ) );
		const elapsed = currentTime - request.serviceDeparture;
		const timing = route.template[ request.stopIndex ];
		if ( elapsed < 0 || elapsed > routeDuration( route ) ) return this.#out( 'board-result', fail( ERROR.outOfService ) );
		if ( elapsed > timing.depart ) return this.#out( 'board-result', fail( ERROR.missed ) );
		if ( elapsed < timing.arrive ) return this.#out( 'board-result', fail( ERROR.moving ) );
		if ( distance( request.position, placePosition( place, stop ) ) > TRANSIT_BOARD_REACH ) {

			return this.#out( 'board-result', fail( ERROR.outOfReach ) );

		}

		const service = serviceDescription( route, request.stopIndex, request.serviceDeparture, place );
		this._state = {
			status: 'aboard',
			clock: { dayOffset: currentTime - request.daySeconds, lastDaySeconds: request.daySeconds },
			tripId: request.tripId,
			routeId: route.id,
			serviceDeparture: request.serviceDeparture,
			boardedStopIndex: request.stopIndex
		};

		return this.#out( 'board-result', { ok: true, service, state: this.state } );

	}

	/** Returns the exact shape position, heading and remaining published stops. */
	update( request ) {

		if ( ! this.dataValid || ! this.boundary.valid( 'journey-update-request', request ) ) {

			return this.#out( 'journey-update-result', fail( ERROR.invalid ) );

		}
		if ( this._state.status !== 'aboard' ) return this.#out( 'journey-update-result', fail( ERROR.notAboard ) );

		const route = this.routeById.get( this._state.routeId );
		if ( ! route ) return this.#out( 'journey-update-result', fail( ERROR.absentRoute ) );
		const currentTime = this.#timeForTrip( request.daySeconds, this._state.serviceDeparture, routeDuration( route ) );
		const elapsed = currentTime - this._state.serviceDeparture;
		const vehicle = vehicleAt( route, elapsed );
		if ( ! vehicle ) return this.#out( 'journey-update-result', fail( ERROR.outOfService ) );
		this._state.clock = { dayOffset: currentTime - request.daySeconds, lastDaySeconds: request.daySeconds };

		const dwell = dwellIndex( route, elapsed );
		const nextStops = route.stops.flatMap( ( stop, index ) => route.template[ index ].depart < elapsed ? [] : [ {
			stopId: stop.stopId,
			stopIndex: index,
			arrivalTime: this._state.serviceDeparture + route.template[ index ].arrive,
			departureTime: this._state.serviceDeparture + route.template[ index ].depart,
			position: this.#publishedPosition( route, index )
		} ] );

		return this.#out( 'journey-update-result', {
			ok: true,
			tripId: this._state.tripId,
			routeId: route.id,
			lineId: route.lineId,
			kind: route.kind,
			position: vehicle.position,
			heading: vehicle.heading,
			nextStops,
			canDisembark: dwell !== -1,
			state: this.state
		} );

	}

	/** Leaves the vehicle only while it is dwelling, at the published place. */
	disembark( request ) {

		if ( ! this.dataValid || ! this.boundary.valid( 'disembark-request', request ) ) {

			return this.#out( 'disembark-result', fail( ERROR.invalid ) );

		}
		if ( this._state.status !== 'aboard' ) return this.#out( 'disembark-result', fail( ERROR.notAboard ) );

		const route = this.routeById.get( this._state.routeId );
		if ( ! route ) return this.#out( 'disembark-result', fail( ERROR.absentRoute ) );
		const currentTime = this.#timeForTrip( request.daySeconds, this._state.serviceDeparture, routeDuration( route ) );
		const elapsed = currentTime - this._state.serviceDeparture;
		if ( elapsed < 0 || elapsed > routeDuration( route ) ) return this.#out( 'disembark-result', fail( ERROR.outOfService ) );
		const index = dwellIndex( route, elapsed );
		if ( index === -1 ) return this.#out( 'disembark-result', fail( ERROR.moving ) );

		const tripId = this._state.tripId;
		const stop = route.stops[ index ];
		const place = this.places.get( `${placeKind( route.kind )}:${stop.stopId}` );
		const position = placePosition( place, stop );
		const clock = { dayOffset: currentTime - request.daySeconds, lastDaySeconds: request.daySeconds };
		this._state = { status: 'waiting', clock };

		return this.#out( 'disembark-result', {
			ok: true,
			tripId,
			routeId: route.id,
			place: { kind: place.kind, id: place.id },
			position,
			state: this.state
		} );

	}

	#indexAndValidate() {

		const collections = [
			[ 'bus-stop', this.atlas.transit.busStops ],
			[ 'train-station', this.atlas.transit.trainStations ],
			[ 'subway-station', this.atlas.transit.subwayStations ]
		];
		for ( const [ kind, places ] of collections ) for ( const place of places ) {

			const key = `${kind}:${place.id}`;
			if ( this.places.has( key ) ) return false;
			this.places.set( key, { ...place, kind } );

		}

		for ( const route of this.routes ) {

			if ( this.routeById.has( route.id ) || route.template.length !== route.stops.length ) return false;
			this.routeById.set( route.id, route );
			let lastShapeDistance = -Infinity;
			let lastDeparture = -Infinity;
			const shapeLength = pathLength( route.shape );
			for ( let index = 0; index < route.stops.length; index ++ ) {

				const stop = route.stops[ index ];
				const timing = route.template[ index ];
				if ( !this.places.has( `${placeKind( route.kind )}:${stop.stopId}` )
					|| stop.shapeDist < lastShapeDistance || stop.shapeDist > shapeLength + 1e-6
					|| timing.arrive < lastDeparture || timing.depart < timing.arrive ) return false;
				lastShapeDistance = stop.shapeDist;
				lastDeparture = timing.depart;

			}
			let periodEnd = -Infinity;
			for ( const period of route.service ) {

				if ( period.start < periodEnd || period.end <= period.start || period.phase >= period.headway ) return false;
				periodEnd = period.end;

			}

		}
		return true;

	}

	#validRestoredTrip() {

		const route = this.routeById.get( this._state.routeId );
		return Boolean( route
			&& route.stops[ this._state.boardedStopIndex ]
			&& tripIdentity( route.id, this._state.serviceDeparture ) === this._state.tripId
			&& scheduledDeparture( route, this._state.serviceDeparture ) );

	}

	#advanceClock( daySeconds ) {

		const previous = this._state.clock.lastDaySeconds;
		if ( previous !== null && previous - daySeconds > HALF_DAY ) this._state.clock.dayOffset += DAY;
		this._state.clock.lastDaySeconds = daySeconds;
		return daySeconds + this._state.clock.dayOffset;

	}

	#timeForTrip( daySeconds, serviceDeparture, duration ) {

		const base = this.#advanceClock( daySeconds );
		const candidates = [ base - DAY, base, base + DAY ].filter( ( value ) => value >= 0 );
		const currentTime = candidates.sort( ( left, right ) => intervalDistance( left, serviceDeparture, serviceDeparture + duration )
			- intervalDistance( right, serviceDeparture, serviceDeparture + duration ) )[ 0 ];
		return currentTime;

	}

	#boardableAt( place, playerPosition, time ) {

		const cycles = [ this._state.clock.dayOffset, this._state.clock.dayOffset - DAY, 0 ]
			.filter( ( value, index, all ) => value >= 0 && all.indexOf( value ) === index );
		const services = [];
		for ( const route of this.routes ) {

			if ( place.kind !== placeKind( route.kind ) ) continue;
			for ( let stopIndex = 0; stopIndex < route.stops.length; stopIndex ++ ) {

				const stop = route.stops[ stopIndex ];
				if ( stop.stopId !== place.id ) continue;
				if ( distance( playerPosition, placePosition( place, stop ) ) > TRANSIT_BOARD_REACH ) continue;
				const timing = route.template[ stopIndex ];
				for ( const period of route.service ) for ( const cycle of cycles ) {

					const first = period.start + period.phase + cycle;
					const k = Math.floor( ( time - timing.arrive - first ) / period.headway );
					if ( k < 0 ) continue;
					const serviceDeparture = first + k * period.headway;
					if ( serviceDeparture - cycle >= period.end ) continue;
					if ( time < serviceDeparture + timing.arrive || time > serviceDeparture + timing.depart ) continue;
					services.push( serviceDescription( route, stopIndex, serviceDeparture, place ) );

				}

			}

		}
		return services;

	}

	#publishedPosition( route, stopIndex ) {

		const stop = route.stops[ stopIndex ];
		return placePosition( this.places.get( `${placeKind( route.kind )}:${stop.stopId}` ), stop );

	}

	#out( schema, result ) {

		return this.boundary.valid( schema, result ) ? result : fail( ERROR.invalid );

	}

}

function initialState() {

	return { status: 'waiting', clock: { dayOffset: 0, lastDaySeconds: null } };

}

function fail( error ) {

	return { ok: false, error };

}

function clone( value ) {

	return JSON.parse( JSON.stringify( value ) );

}

function placeKind( routeKind ) {

	return routeKind === 'bus' ? 'bus-stop' : `${routeKind}-station`;

}

function placeKey( place ) {

	return `${place.kind}:${place.id}`;

}

function placePosition( place, routeStop = null ) {

	if ( place.kind === 'bus-stop' ) return [ place.position[ 0 ], routeStop?.y ?? 0, place.position[ 1 ] ];
	return [ place.position[ 0 ], place.level, place.position[ 1 ] ];

}

function distance( left, right ) {

	return Math.hypot( left[ 0 ] - right[ 0 ], left[ 1 ] - right[ 1 ], left[ 2 ] - right[ 2 ] );

}

function routeDuration( route ) {

	return route.template.at( -1 ).arrive;

}

function pathLength( path ) {

	let total = 0;
	for ( let index = 1; index < path.length; index ++ ) total += distance( path[ index - 1 ], path[ index ] );
	return total;

}

function intervalDistance( value, start, end ) {

	return value < start ? start - value : value > end ? value - end : 0;

}

/** Route id length makes ids containing punctuation unambiguous. */
export function tripIdentity( routeId, serviceDeparture ) {

	return `trip:${routeId.length}:${routeId}:${serviceDeparture}`;

}

function scheduledDeparture( route, absoluteDeparture ) {

	const baseCycle = Math.floor( absoluteDeparture / DAY ) * DAY;
	for ( const cycle of [ baseCycle, baseCycle - DAY ] ) for ( const period of route.service ) {

		const departure = absoluteDeparture - cycle;
		const first = period.start + period.phase;
		const steps = ( departure - first ) / period.headway;
		if ( departure >= first && departure < period.end && Number.isInteger( steps ) ) return true;

	}
	return false;

}

function serviceDescription( route, stopIndex, serviceDeparture, place ) {

	const timing = route.template[ stopIndex ];
	const stop = route.stops[ stopIndex ];
	return {
		tripId: tripIdentity( route.id, serviceDeparture ),
		routeId: route.id,
		lineId: route.lineId,
		kind: route.kind,
		stopId: stop.stopId,
		stopIndex,
		serviceDeparture,
		arrivalTime: serviceDeparture + timing.arrive,
		departureTime: serviceDeparture + timing.depart,
		nextStopId: route.stops[ stopIndex + 1 ]?.stopId ?? null,
		destinationStopId: route.stops.at( -1 ).stopId,
		position: placePosition( place, stop )
	};

}

function deduplicateServices( services ) {

	const found = new Map();
	for ( const service of services ) found.set( `${service.tripId}:${service.stopIndex}`, service );
	return [ ...found.values() ].sort( ( left, right ) => left.arrivalTime - right.arrivalTime
		|| left.routeId.localeCompare( right.routeId ) || left.stopIndex - right.stopIndex );

}

function dwellIndex( route, elapsed ) {

	return route.template.findIndex( ( timing ) => elapsed >= timing.arrive && elapsed <= timing.depart );

}

function vehicleAt( route, elapsed ) {

	const template = route.template;
	if ( elapsed < 0 || elapsed > routeDuration( route ) ) return null;
	let index = 0;
	while ( index < template.length - 1 && elapsed > template[ index ].depart ) index ++;
	let shapeDistance;
	if ( elapsed <= template[ index ].depart && elapsed >= template[ index ].arrive ) {

		shapeDistance = route.stops[ index ].shapeDist;

	} else {

		const before = template[ index - 1 ];
		const after = template[ index ];
		const fraction = after.arrive === before.depart ? 1 : ( elapsed - before.depart ) / ( after.arrive - before.depart );
		shapeDistance = route.stops[ index - 1 ].shapeDist
			+ fraction * ( route.stops[ index ].shapeDist - route.stops[ index - 1 ].shapeDist );

	}
	return pointOnShape( route.shape, shapeDistance );

}

function pointOnShape( shape, shapeDistance ) {

	let travelled = 0;
	for ( let index = 1; index < shape.length; index ++ ) {

		const segment = distance( shape[ index - 1 ], shape[ index ] );
		if ( travelled + segment >= shapeDistance || index === shape.length - 1 ) {

			const fraction = segment < 1e-9 ? 0 : Math.min( 1, Math.max( 0, ( shapeDistance - travelled ) / segment ) );
			const from = shape[ index - 1 ];
			const to = shape[ index ];
			const dx = to[ 0 ] - from[ 0 ];
			const dz = to[ 2 ] - from[ 2 ];
			const groundLength = Math.hypot( dx, dz );
			return {
				position: [
					from[ 0 ] + dx * fraction,
					from[ 1 ] + ( to[ 1 ] - from[ 1 ] ) * fraction,
					from[ 2 ] + dz * fraction
				],
				heading: groundLength < 1e-9 ? [ 1, 0 ] : [ dx / groundLength, dz / groundLength ]
			};

		}
		travelled += segment;

	}
	const last = shape.at( -1 );
	return { position: [ ...last ], heading: [ 1, 0 ] };

}
