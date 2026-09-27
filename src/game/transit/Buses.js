import { BusModel } from './BusModel.js';
import { TimetableVehicles } from './TimetableVehicles.js';

/**
 * Buses retain their scheduled departure identity and presentation coverage.
 * Every position comes directly from Connections' closed-form timetable.
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
