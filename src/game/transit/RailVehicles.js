import { TimetableVehicles } from './TimetableVehicles.js';
import { RailModel } from './RailModel.js';

export class RailVehicles extends TimetableVehicles {

	constructor( { routes, kind, factory, capacity } ) {

		super( {
			routes,
			kind,
			factory,
			capacity,
			Model: RailModel,
			groupName: `${kind}s`
		} );

	}

}
