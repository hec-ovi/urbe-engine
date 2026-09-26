import { QuestActionBoundary } from './QuestActionBoundary.js';
import { questCompletion } from './QuestCompletion.js';
import { castIds } from './QuestCast.js';
import { completionEvent } from './QuestEvent.js';
import { unavailableMessage } from './QuestAvailability.js';
import { stepView } from './QuestStepView.js';

const INTERACTION_KINDS = new Set( [ 'pickup', 'observe', 'listen', 'steal', 'work', 'deliver' ] );
const MECHANIC_KINDS = new Set( [
	'assassinate', 'rescue', 'escort', 'access', 'hacking', 'sabotage', 'transportation'
] );
/** Steps that send the player somewhere: they read as nothing there without a mark. */
const PLACE_KINDS = new Set( [ 'goto', 'talk' ] );
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

	/** Active measured mechanics with exact authored facts and resolved cast ids. */
	mechanics( query ) {

		this.boundary.input( 'target-query', query );
		const targets = [];
		for ( const { definition, runtime } of this.session.entries ) for ( const step of runtime.activeSteps() ) {

			if ( ! MECHANIC_KINDS.has( step.target.kind ) ) continue;
			const place = runtime.stepPlace( step.stepId, query.timeMin ) ?? null;
			const runtimeAvailability = runtime.stepAvailability( step.stepId, query.timeMin );
			targets.push( {
				targetKey: targetKey( definition.id, step.stepId ),
				questId: definition.id,
				stepId: step.stepId,
				kind: step.target.kind,
				place,
				actorIds: castIds( step.target, runtime ),
				target: structuredClone( step.target ),
				availability: place ? runtimeAvailability : { available: false, reason: 'target_missing' },
				presentation: {
					name: step.narrative.playerHint,
					description: step.narrative.description
				}
			} );

		}
		return this.boundary.output( 'mechanic-targets', targets );

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
				const actorIds = castIds( step.target, runtime );

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
	 * The story objective the player is following: the questline `questId` names
	 * while it still has an open step, else the first open one, main quest first.
	 * Talk and goto steps are included, because the map guides to them too.
	 */
	objective( query ) {

		this.boundary.input( 'target-query', query );

		for ( const entry of this.#ordered( query.questId ) ) {

			const step = this.#openStep( entry, entry.definition.id === query.questId ? query.stepId : null );
			if ( ! step ) continue;

			return this.boundary.output( 'active-objective', {
				...this.#placeTarget( entry, step, query.timeMin ),
				guidance: entry.runtime.stepGuidance( step.stepId, query.timeMin )
			} );

		}

		return this.boundary.output( 'active-objective', null );

	}

	/**
	 * Every active goto and talk step of every questline. A side job's venue
	 * gets its mark and its person whether or not it is the followed objective.
	 */
	places( query ) {

		this.boundary.input( 'target-query', query );
		const places = [];

		for ( const entry of this.session.entries ) {

			const active = new Set( entry.runtime.activeSteps().map( ( step ) => step.stepId ) );
			for ( const step of entry.definition.steps ) {

				if ( ! active.has( step.stepId ) || ! PLACE_KINDS.has( step.target.kind ) ) continue;
				places.push( this.#placeTarget( entry, step, query.timeMin ) );

			}

		}

		return this.boundary.output( 'place-targets', places );

	}

	/** Why a target is closed right now, in the words the player reads. */
	static unavailableMessage( reason, window = null ) {

		return unavailableMessage( reason, window );

	}

	/** The chosen questline first, then the rest in definition order. */
	#ordered( questId ) {

		const chosen = questId ? this.session.entries.find( ( entry ) => entry.definition.id === questId ) : null;
		return chosen ? [ chosen, ...this.session.entries.filter( ( entry ) => entry !== chosen ) ] : this.session.entries;

	}

	#openStep( { definition, runtime }, stepId = null ) {

		const active = new Set( runtime.activeSteps().map( ( step ) => step.stepId ) );
		return definition.steps.find( candidate => candidate.stepId === stepId && active.has( candidate.stepId ) )
			?? definition.steps.find( ( candidate ) => active.has( candidate.stepId ) ) ?? null;

	}

	/** One step as a placed objective, on the same projection the quest log reads. */
	#placeTarget( { definition, runtime }, step, timeMin ) {

		const view = stepView( { step, runtime, sim: this.session.sim, timeMin } );
		return {
			targetKey: targetKey( definition.id, step.stepId ),
			questId: definition.id,
			stepId: step.stepId,
			kind: step.target.kind,
			title: definition.title,
			text: view.text,
			place: view.place ? { kind: view.place.kind, id: view.place.id } : null,
			actorIds: castIds( step.target, runtime ),
			venue: step.target.place?.name ?? null,
			window: view.window,
			availability: { available: view.availability.available, ...( view.availability.reason ? { reason: view.availability.reason } : {} ) }
		};

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
		const event = completionEvent( step.target, castIds( step.target, entry.runtime ) );
		const moved = this.session.advanceFor( target.questId, event, request.timeMin );

		if ( moved.length === 0 ) return this.#failure( request, 'runtime_rejected', 'The quest state rejected that interaction.' );

		const worldChanges = worldChangesFor( request.action, request.targetKey );
		return this.#result( {
			ok: true,
			targetKey: request.targetKey,
			action: request.action,
			progressed: true,
			message: step.narrative.description,
			completed: moved.map( ( change ) => questCompletion( change, this.session.view( request.timeMin ) ) ),
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

/** The stable key of one step's target: every projection of that step carries it. */
export function targetKey( questId, stepId ) {

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
		work: [ action( 'work', 'Complete maintenance shift', 'interact', true ) ],
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

function worldChangesFor( actionId, key ) {

	if ( actionId === 'take' ) return [ { targetKey: key, state: 'collected' } ];
	if ( actionId === 'steal' ) return [ { targetKey: key, state: 'stolen' } ];
	if ( actionId === 'deliver' ) return [ { targetKey: key, state: 'delivered' } ];
	return [];

}
