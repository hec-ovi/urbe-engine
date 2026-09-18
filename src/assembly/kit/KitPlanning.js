import { planAssembly } from '../../../../exterior/src/kit/index.ts';
import { AssemblyError } from '../RequestAssembler.js';
import { piecesPerFloor } from './BayCount.js';
import { schemaMessage, validateKitRequest, validatePlacementPlan } from './KitSchemas.js';

/**
 * Exterior's placement plan for one request, checked before anything is
 * written: the request against the published request schema, the result
 * against the placement schema, and the piece count against the lot it has to
 * tile. Both the parcel path and the plan library ask for their pieces here, so
 * a building drawn once for the whole city is checked exactly as a building
 * drawn on its own parcel.
 * @param id what a failure names, the parcel or the plan asking for the pieces
 * @throws AssemblyError E_KIT_FIT | E_KIT_PLACEMENTS
 */
export function planFrom( request, { id, bays, floors } ) {

	const invalid = validateKitRequest( request );

	if ( invalid.length ) throw new AssemblyError( 'E_KIT_FIT', `${id}: kit request: ${schemaMessage( invalid )}` );

	let plan = null;

	try {

		plan = planAssembly( request );

	} catch ( error ) {

		throw new AssemblyError( 'E_KIT_PLACEMENTS', `${id}: ${error.code ?? error.name}: ${error.message}` );

	}

	const errors = validatePlacementPlan( plan );

	if ( errors.length ) throw new AssemblyError( 'E_KIT_PLACEMENTS', `${id}: placement schema: ${schemaMessage( errors )}` );
	if ( plan.placements.length !== floors * piecesPerFloor( bays ) ) {

		throw new AssemblyError( 'E_KIT_PLACEMENTS',
			`${id}: ${plan.placements.length} pieces do not tile ${bays.across} by ${bays.deep} bays over ${floors} floors` );

	}

	return plan;

}
