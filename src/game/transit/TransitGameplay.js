import { TransitJourney } from './TransitJourney.js';

/** Game-facing transit interaction, kept separate from rendering and DOM. */
export class TransitGameplay {

	constructor( { atlas, routes, state, journey, locator, controller } ) {

		this.locator = locator;
		this.controller = controller;
		this.restoreRejected = false;
		this.journey = journey ?? new TransitJourney( { atlas, routes, ...( state ? { state } : {} ) } );
		if ( state && ! this.journey.valid ) {

			const fresh = new TransitJourney( { atlas, routes } );
			if ( fresh.valid ) {

				this.journey = fresh;
				this.restoreRejected = true;

			}

		}
		this.latest = null;
		this.services = [];
		this.offered = [];

	}

	get state() {

		return this.journey.state;

	}

	get aboard() {

		return this.state.status === 'aboard';

	}

	/** Updates the ride, or finds current services when higher-priority E targets leave the key free. */
	update( { daySeconds, interactionBlocked = false } ) {

		const feet = this.controller.body.feet;
		const position = [ feet.x, feet.y, feet.z ];
		const place = this.locator.transitPlace( feet.x, feet.y, feet.z );
		this.latest = { daySeconds, position, place };

		if ( this.aboard ) return this.#ride( daySeconds );
		if ( interactionBlocked || ! place ) {

			this.services = [];
			return waitingView();

		}

		const result = this.journey.listBoardable( { position, place, daySeconds } );
		this.services = result.ok ? result.services : [];
		return {
			aboard: false,
			prompt: servicePrompt( this.services ),
			status: null,
			services: this.services,
			result
		};

	}

	/** Uses the last validated frame. Multiple candidates are returned for explicit selection. */
	activate() {

		if ( this.aboard ) return this.#leave();
		if ( this.services.length === 0 ) return null;
		if ( this.services.length > 1 ) {

			this.offered = [ ...this.services ];
			return { action: 'choose', services: this.offered };

		}
		return this.board( this.services[ 0 ] );

	}

	/** Boards the selected candidate through TransitJourney's current dwell and reach checks. */
	board( service ) {

		if ( ! this.latest?.place ) return { action: 'board', result: { ok: false, error: 'E_TRANSIT_WRONG_PLACE' } };
		const allowed = [ ...this.services, ...this.offered ].some( ( candidate ) => sameService( candidate, service ) );
		if ( ! allowed ) return { action: 'board', result: { ok: false, error: 'E_TRANSIT_INVALID_DATA' } };
		const { position, place, daySeconds } = this.latest;
		const result = this.journey.board( {
			position,
			place,
			daySeconds,
			tripId: service.tripId,
			routeId: service.routeId,
			stopIndex: service.stopIndex,
			serviceDeparture: service.serviceDeparture
		} );
		this.offered = [];
		if ( result.ok ) {

			const ride = this.journey.update( { daySeconds } );
			if ( ride.ok ) this.controller.beginRide( ride.position, ride.heading );

		}
		return { action: 'board', result };

	}

	cancelSelection() {

		this.offered = [];

	}

	#ride( daySeconds ) {

		const result = this.journey.update( { daySeconds } );
		if ( ! result.ok ) return { aboard: true, prompt: null, status: null, services: [], result };
		if ( result.autoDisembarked ) {

			this.controller.endRide( result.position );
			return { aboard: false, prompt: null, status: null, services: [], result };

		}
		if ( this.controller.movementLocked ) this.controller.carry( result.position, result.heading );
		else this.controller.beginRide( result.position, result.heading );

		const current = result.canDisembark ? result.nextStops[ 0 ] : null;
		const next = result.nextStops[ result.canDisembark ? 1 : 0 ] ?? null;
		return {
			aboard: true,
			prompt: current ? `E  leave ${result.kind} ${result.lineId} at ${current.stopId}` : null,
			status: {
				kind: result.kind,
				lineId: result.lineId,
				nextStopId: next?.stopId ?? null,
				nextArrivalTime: next?.arrivalTime ?? null
			},
			services: [],
			result
		};

	}

	#leave() {

		const result = this.journey.disembark( { daySeconds: this.latest.daySeconds } );
		if ( result.ok ) this.controller.endRide( result.position );
		return { action: 'disembark', result };

	}

}

export function transitServiceLabel( service ) {

	return `${title( service.kind )} ${service.lineId} to ${service.destinationStopId}, departs ${clock( service.departureTime )}`;

}

export function transitStatusLabel( status ) {

	if ( ! status ) return null;
	const next = status.nextStopId
		? `next ${status.nextStopId}${status.nextArrivalTime === null ? '' : ` ${clock( status.nextArrivalTime )}`}`
		: 'final stop';
	return `${status.kind.toUpperCase()} ${status.lineId} · ${next}`;

}

export function transitErrorMessage( code ) {

	return {
		E_TRANSIT_INVALID_DATA: 'Transit data is no longer valid.',
		E_TRANSIT_ABSENT_ROUTE: 'That route is no longer available.',
		E_TRANSIT_WRONG_PLACE: 'Move back to the published stop or platform.',
		E_TRANSIT_OUT_OF_SERVICE: 'That service is no longer running.',
		E_TRANSIT_MISSED_VEHICLE: 'That vehicle has already left.',
		E_TRANSIT_MOVING_VEHICLE: 'Wait until the vehicle stops.',
		E_TRANSIT_OUT_OF_REACH: 'Move closer to the stop or platform.',
		E_TRANSIT_ALREADY_ABOARD: 'You are already aboard.',
		E_TRANSIT_NOT_ABOARD: 'You are not aboard.'
	}[ code ] ?? 'Transit is unavailable.';

}

function waitingView() {

	return { aboard: false, prompt: null, status: null, services: [], result: null };

}

function servicePrompt( services ) {

	if ( services.length === 0 ) return null;
	if ( services.length > 1 ) return `E  choose a service (${services.length} boarding)`;
	return `E  board ${transitServiceLabel( services[ 0 ] )}`;

}

function sameService( left, right ) {

	return left.tripId === right?.tripId && left.stopIndex === right?.stopIndex;

}

function title( value ) {

	return value.charAt( 0 ).toUpperCase() + value.slice( 1 );

}

function clock( seconds ) {

	const wrapped = ( seconds % 86400 + 86400 ) % 86400;
	const hour = Math.floor( wrapped / 3600 );
	const minute = Math.floor( ( wrapped % 3600 ) / 60 );
	const second = Math.floor( wrapped % 60 );
	return [ hour, minute, second ].map( ( part ) => String( part ).padStart( 2, '0' ) ).join( ':' );

}
