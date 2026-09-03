import { ObjectiveRouteBoundary } from './ObjectiveRouteBoundary.js';

const CADENCE_SECONDS = 0.75;
const MOVE_METERS = 3;

/** Holds the presented route while bounding recalculation from moving feet. */
export class ObjectiveGuide {

	constructor( router, boundary = new ObjectiveRouteBoundary() ) {

		this.router = router;
		this.boundary = boundary;
		this.destinationKey = null;
		this.routedFrom = null;
		this.route = null;
		this.elapsed = 0;

	}

	update( request ) {

		this.boundary.input( 'guide-update', request );
		this.elapsed += request.deltaSeconds;
		const key = request.destination ? `${request.destination.kind}:${request.destination.id}` : null;

		if ( ! request.destination ) {

			const changed = this.destinationKey !== null || this.route !== null;
			this.destinationKey = null;
			this.routedFrom = null;
			this.route = null;
			this.elapsed = 0;
			return this.boundary.output( 'guide-result', { changed, route: null } );

		}

		const objectiveChanged = key !== this.destinationKey;
		const due = this.elapsed >= CADENCE_SECONDS;
		const moved = ! this.routedFrom || distance( this.routedFrom, request.from ) >= MOVE_METERS;
		if ( ! request.force && ! objectiveChanged && ( ! due || ! moved ) ) {

			return this.boundary.output( 'guide-result', { changed: false, route: this.route } );

		}

		this.destinationKey = key;
		this.routedFrom = [ ...request.from ];
		if ( objectiveChanged ) this.route = null;
		this.elapsed = 0;
		const route = this.router.route( { from: request.from, destination: request.destination } );
		this.route = route;
		return this.boundary.output( 'guide-result', { changed: true, route } );

	}

}

function distance( left, right ) {

	return Math.hypot( left[ 0 ] - right[ 0 ], left[ 1 ] - right[ 1 ], left[ 2 ] - right[ 2 ] );

}
