import { BusModel } from './BusModel.js';
import { TimetableVehicles } from './TimetableVehicles.js';

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
export class Buses extends TimetableVehicles {

	/**
	 * @param routes `networks.transit.routes` per ../../../../connections/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 * @param capacity how many buses may be on screen at once
	 */
	constructor( { routes, factory, capacity } ) {

		super( { routes, kind: 'bus', factory, capacity, Model: BusModel, groupName: 'buses' } );

	}

}
