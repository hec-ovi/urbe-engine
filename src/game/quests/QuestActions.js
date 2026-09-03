import { QuestActionBoundary } from './QuestActionBoundary.js';

const INTERACTION_KINDS = new Set( [ 'pickup', 'observe', 'listen', 'steal', 'work', 'deliver' ] );
const PHYSICAL_REACH = { pickup: 2.5, steal: 2, listen: 8 };

/**
 * The player-facing side of active quest mechanics. It keeps render cues,
 * action prompts, runtime events and inventory on one stable step identity.
 */
export class QuestActions {

	constructor( session, boundary = new QuestActionBoundary() ) {

		this.session = session;
		this.boundary = boundary;

	}

	/** Active quest mechanics as renderer-neutral highlight and prompt data. */
	targets( query ) {

		this.boundary.input( 'target-query', query );
		const targets = [];

		for ( const { definition, runtime } of this.session.entries ) {

			const items = new Map( definition.items.map( ( item ) => [ item.itemId, item ] ) );

			for ( const step of runtime.activeSteps() ) {

				if ( ! INTERACTION_KINDS.has( step.target.kind ) ) continue;

				const place = runtime.stepPlace( step.stepId, query.timeMin ) ?? null;
				const runtimeAvailability = runtime.stepAvailability( step.stepId, query.timeMin );
				const availability = place
					? runtimeAvailability
					: { available: false, reason: 'target_missing' };
				const itemId = step.target.itemId;
				const item = itemId ? items.get( itemId ) : undefined;
				const actorIds = actorRoleIds( step.target ).map( ( roleId ) => runtime.cast[ roleId ] ).filter( Boolean );

				targets.push( {
					targetKey: targetKey( definition.id, step.stepId ),
					questId: definition.id,
					stepId: step.stepId,
					kind: step.target.kind,
					place,
					actorIds,
					...( item ? { item: itemView( item ) } : {} ),
					presentation: presentation( step, item ),
					availability
				} );

			}

		}

		return this.boundary.output( 'interaction-targets', targets );

	}

	/**
	 * Applies one selected target. All rejected paths return state rather than
	 * mutating it, so the host can keep the object visible and explain why.
	 */
	perform( request ) {

		this.boundary.input( 'interaction-request', request );

		const target = this.targets( { timeMin: request.timeMin } ).find( ( candidate ) => candidate.targetKey === request.targetKey );
		if ( ! target ) return this.#failure( request, 'unknown_target', 'That quest target is no longer active.' );

		const offered = target.presentation.actions.some( ( candidate ) => candidate.action === request.action );
		if ( ! offered ) return this.#failure( request, 'wrong_action', `${target.presentation.name} does not support that action.` );
		if ( ! target.availability.available ) {

			return this.#failure( request, 'unavailable', unavailableMessage( target.availability.reason ) );

		}

		if ( target.place && ! request.playerPlaces.some( ( place ) => samePlace( place, target.place ) ) ) {

			return this.#failure( request, 'wrong_place', `Go to the target's ${target.place.kind} before interacting.` );

		}

		const spatialFailure = physicalFailure( target, request );
		if ( spatialFailure ) return this.#failure( request, spatialFailure.code, spatialFailure.message );

		if ( request.action === 'read' ) {

			return this.#result( {
				ok: true,
				targetKey: request.targetKey,
				action: request.action,
				progressed: false,
				message: `Read ${target.presentation.name}.`,
				readText: target.item.description,
				completed: [],
				inventory: this.session.inventoryView(),
				worldChanges: []
			} );

		}

		const entry = this.session.entries.find( ( candidate ) => candidate.definition.id === target.questId );
		const step = entry.definition.steps.find( ( candidate ) => candidate.stepId === target.stepId );
		const moved = this.session.advanceFor( target.questId, playerEvent( step, entry.runtime ), request.timeMin );

		if ( moved.length === 0 ) return this.#failure( request, 'runtime_rejected', 'The quest state rejected that interaction.' );

		const worldChanges = worldChangesFor( request.action, request.targetKey );
		return this.#result( {
			ok: true,
			targetKey: request.targetKey,
			action: request.action,
			progressed: true,
			message: step.narrative.description,
			completed: moved.map( ( change ) => ( {
				questId: change.definition.id,
				stepIds: change.completed.map( ( completed ) => completed.stepId ),
				...( change.ending ? { endingId: change.ending.endingId } : {} )
			} ) ),
			inventory: this.session.inventoryView(),
			worldChanges
		} );

	}

	#failure( request, code, message ) {

		return this.#result( {
			ok: false,
			targetKey: request.targetKey,
			action: request.action,
			progressed: false,
			message,
			code,
			completed: [],
			inventory: this.session.inventoryView(),
			worldChanges: []
		} );

	}

	#result( result ) {

		return this.boundary.output( 'interaction-result', result );

	}

}

function itemView( item ) {

	return { id: item.itemId, name: item.name, description: item.description, kind: item.kind, quantity: 1 };

}

function actorRoleIds( target ) {

	if ( target.kind === 'listen' ) return target.roleIds;
	if ( target.kind === 'steal' ) return [ target.fromRoleId ];
	return [];

}

function targetKey( questId, stepId ) {

	return `quest:${encodeURIComponent( questId )}:${encodeURIComponent( stepId )}`;

}

function presentation( step, item ) {

	const kind = step.target.kind;
	const names = {
		observe: step.narrative.playerHint,
		listen: step.narrative.playerHint,
		work: step.target.role,
		deliver: item?.name,
		pickup: item?.name,
		steal: item?.name
	};
	const actions = {
		observe: [ action( 'inspect', 'Inspect', 'interact', true ) ],
		listen: [ action( 'listen', 'Listen', 'interact', true ) ],
		work: [ action( 'work', 'Start work', 'interact', true ) ],
		deliver: [ action( 'deliver', 'Deliver', 'interact', true ) ],
		steal: [ action( 'steal', 'Steal', 'interact', true ) ],
		pickup: [
			action( 'take', 'Take', 'interact', true ),
			...( item?.kind === 'document' ? [ action( 'read', 'Read', 'secondary-interact', false ) ] : [] )
		]
	};
	const highlights = { pickup: 'outline', steal: 'person-outline' };

	return {
		name: names[ kind ] ?? step.narrative.playerHint,
		description: item?.description ?? step.narrative.description,
		icon: kind === 'observe' ? 'inspect' : kind,
		highlight: highlights[ kind ] ?? 'area-marker',
		actions: actions[ kind ]
	};

}

function action( id, label, bindingAction, progressesQuest ) {

	return { action: id, label, bindingAction, progressesQuest };

}

function physicalFailure( target, request ) {

	const reach = PHYSICAL_REACH[ target.kind ];
	if ( ! reach ) return null;
	if ( ! request.focus ) return { code: 'not_visible', message: 'Aim at the quest target before interacting.' };
	if ( target.kind !== 'listen' && ! request.focus.visible ) {

		return { code: 'not_visible', message: 'The quest target is not visible.' };

	}
	if ( ! request.focus.unobstructed ) return { code: 'occluded', message: 'Something blocks the quest target.' };
	if ( request.focus.distanceMeters > reach ) {

		return { code: 'out_of_reach', message: `Move within ${reach} metres of the quest target.` };

	}
	return null;

}

function samePlace( left, right ) {

	return left.kind === right.kind && left.id === right.id;

}

function playerEvent( step, runtime ) {

	const target = step.target;
	if ( target.kind === 'pickup' ) return { kind: 'pickedUp', itemId: target.itemId };
	if ( target.kind === 'observe' ) return { kind: 'observed', districtId: target.districtId };
	if ( target.kind === 'listen' ) return { kind: 'overheard', npcIds: target.roleIds.map( ( roleId ) => runtime.cast[ roleId ] ) };
	if ( target.kind === 'steal' ) return { kind: 'stole', itemId: target.itemId };
	if ( target.kind === 'work' ) return { kind: 'workedShift', parcelId: target.atParcelId };
	if ( target.kind === 'deliver' ) {

		return {
			kind: 'delivered',
			itemId: target.itemId,
			...( 'parcelId' in target.place ? { parcelId: target.place.parcelId } : { districtId: target.place.districtId } )
		};

	}
	throw new Error( `unsupported quest interaction ${target.kind}` );

}

function worldChangesFor( actionId, key ) {

	if ( actionId === 'take' ) return [ { targetKey: key, state: 'collected' } ];
	if ( actionId === 'steal' ) return [ { targetKey: key, state: 'stolen' } ];
	if ( actionId === 'deliver' ) return [ { targetKey: key, state: 'delivered' } ];
	return [];

}

function unavailableMessage( reason ) {

	const messages = {
		role_dead: 'The person required by this objective is dead.',
		not_present: 'The person required by this objective is not available.',
		off_duty: 'The person required by this objective is not at the target location now.',
		missing_item: 'The required item is not in your inventory.',
		condition: 'The quest conditions for this action are not met.',
		target_missing: 'The quest target has no valid world location.'
	};
	return messages[ reason ] ?? 'The quest target is unavailable.';

}
