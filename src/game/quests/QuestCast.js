/** Which roles a step's target names, and who the questline cast in them. */

export function actorRoleIds( target ) {

	if ( target.kind === 'listen' ) return target.roleIds;
	if ( target.kind === 'steal' ) return [ target.fromRoleId ];
	if ( [ 'talk', 'assassinate', 'rescue', 'escort' ].includes( target.kind ) ) return [ target.roleId ];
	if ( target.kind === 'transportation' ) return target.passengerRoleIds;
	return [];

}

/** The actual npcIds a step is about, in role order. */
export function castIds( target, runtime ) {

	return actorRoleIds( target ).map( ( roleId ) => runtime.cast[ roleId ] ).filter( Boolean );

}

/** An authored character label belongs only to the exact identity playing it. */
export function characterName( runtime, npcId ) {

	const role = runtime.def.roles.find( ( candidate ) => runtime.cast[ candidate.roleId ] === npcId );
	return role?.characterName ?? role?.reservedName ?? null;

}
