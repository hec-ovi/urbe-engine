/** Authored questline and simulation shapes the quest layer reads, built here so no generated city decides what a contract test proves. */

export function npc( npcId, type, parcelId = 'p4' ) {

	return {
		npcId, type, name: { given: type, family: 'Vale' }, home: { parcelId, unit: 1 }, family: [],
		job: { parcelId, role: type }, flags: { dead: false },
		routine: [ {
			days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 0, endMin: 1440,
			activity: 'working', place: { kind: 'parcel', id: parcelId }
		} ]
	};

}

/** `people` is a Map of npcId to npc. `behaviorPlace` overrides where everyone is. */
export function simulation( people, { behaviorPlace = null } = {} ) {

	const byType = ( query ) => [ ...people.values() ].find( ( person ) => person.type === ( query.npcType ?? query.type ) ) ?? null;
	return {
		people,
		getNPC: ( npcId ) => {

			const person = people.get( npcId );
			if ( ! person ) throw new Error( `unknown ${npcId}` );
			return person;

		},
		findNPCs: ( query ) => [ ...people.values() ].filter( ( person ) => person.type === query.type ),
		getNPCVendor: byType,
		reserveNPC: byType,
		behaviorAt: ( npcId ) => ( {
			mode: 'interior', activity: 'working', interrupted: false,
			place: behaviorPlace ?? { kind: 'parcel', id: people.get( npcId ).job.parcelId }
		} ),
		applyFlag: ( npcId, operation ) => { if ( operation.kind === 'die' ) people.get( npcId ).flags.dead = true; },
		interrupt() {}, resume() {}
	};

}

export function role( roleId, npcType ) {

	return { roleId, npcType, persona: `${roleId} is watchful.` };

}

export function step( stepId, target, options = {} ) {

	return {
		stepId, actId: 'act',
		narrative: {
			description: `${options.hint ?? stepId} completed.`,
			playerHint: options.hint ?? `Complete ${stepId}.`,
			stake: 'The objective remains unresolved otherwise.'
		},
		...( options.wantedByRoleId === null ? {} : { wantedByRoleId: options.wantedByRoleId ?? target.roleId ?? 'giver' } ),
		target, gives: options.gives ?? [], needs: options.needs ?? [], conditions: [],
		effects: options.effects ?? ( target.completionFlag ? [ { kind: 'setFlag', flag: target.completionFlag } ] : [] ),
		next: options.next ?? [], branching: 'parallel', ...( options.endingId ? { endingId: options.endingId } : {} )
	};

}

export function quest( id, { roles = [], items = [], steps, flags = [], entryStepIds, endingId = 'done' } ) {

	return {
		id, title: id, premise: `${id} premise.`, roles, items, facts: [],
		acts: [ { actId: 'act', title: 'Act', summary: 'Complete the objective.' } ], steps,
		endings: [ { endingId, title: 'Done', epilogue: `${id} complete.` } ],
		flags, entryStepIds: entryStepIds ?? [ steps[ 0 ].stepId ]
	};

}

/** One questline with a single step, cast from the `giver` role unless the caller names its own. */
export function oneStepQuest( id, target, options = {} ) {

	const roles = options.roles ?? [ role( 'giver', 'giver' ) ];
	const items = options.items ?? options.gives ?? [];
	const gives = Array.isArray( options.gives ) && typeof options.gives[ 0 ] === 'string'
		? options.gives
		: ( options.gives ?? [] ).map( ( item ) => item.itemId );
	return quest( id, {
		roles, items, flags: target.completionFlag ? [ target.completionFlag ] : [],
		steps: [ step( 'step', target, {
			gives, needs: options.needs ?? [], hint: options.hint,
			endingId: options.endingId ?? 'done', wantedByRoleId: roles[ 0 ].roleId
		} ) ]
	} );

}
