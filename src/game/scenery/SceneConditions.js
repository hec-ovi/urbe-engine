/**
 * When a scene stands, over one questline as the session runs it. The
 * vocabulary mirrors the flow predicates: steps active or done, flags set or
 * not, a cast role dead in the simulation, the questline started (a step done
 * or an ending reached) or ended (an ending reached), and `never`.
 *
 * @param context `{ state, cast, sim }`: the questline's serialized state
 * (`activeStepIds`, `completedStepIds`, `flags`, `endingId`), its cast (roleId
 * to npcId) and the simulation port
 */
export function evaluate( condition, context ) {

	if ( condition.all ) return condition.all.every( ( item ) => evaluate( item, context ) );
	if ( condition.any ) return condition.any.some( ( item ) => evaluate( item, context ) );
	if ( condition.not ) return ! evaluate( condition.not, context );

	const { state, cast, sim } = context;
	switch ( condition.kind ) {

		case 'stepActive': return state.activeStepIds.includes( condition.stepId );
		case 'stepDone': return state.completedStepIds.includes( condition.stepId );
		case 'flagSet': return state.flags.includes( condition.flag );
		case 'flagNotSet': return ! state.flags.includes( condition.flag );
		case 'roleDead': return sim.getNPC( cast[ condition.roleId ] )?.flags?.dead === true;
		case 'questStarted': return state.completedStepIds.length > 0 || state.endingId !== undefined;
		case 'questEnded': return state.endingId !== undefined;
		default: return false;

	}

}

/** Every step, flag or role a condition names that the questline definition lacks. */
export function unknownReferences( condition, definition ) {

	const known = {
		stepId: new Set( definition.steps.map( ( step ) => step.stepId ) ),
		flag: new Set( definition.flags ),
		roleId: new Set( definition.roles.map( ( role ) => role.roleId ) )
	};
	const unknown = [];
	const visit = ( item ) => {

		for ( const child of item.all ?? item.any ?? ( item.not ? [ item.not ] : [] ) ) visit( child );
		for ( const field of [ 'stepId', 'flag', 'roleId' ] ) {

			if ( item[ field ] !== undefined && ! known[ field ].has( item[ field ] ) ) unknown.push( `${field} ${item[ field ]}` );

		}

	};
	visit( condition );
	return unknown;

}
