import { QuestActionBoundary } from './QuestActionBoundary.js';
import { questCompletion } from './QuestCompletion.js';

const TARGET_KIND = Object.freeze( {
	killed: 'assassinate',
	released: 'rescue',
	escorted: 'escort',
	accessed: 'access',
	hacked: 'hacking',
	sabotaged: 'sabotage',
	transported: 'transportation'
} );

/** Selected completion port for mechanics measured by their owning live systems. */
export class QuestMechanics {

	constructor( session, boundary = new QuestActionBoundary() ) {

		this.session = session;
		this.boundary = boundary;

	}

	complete( request ) {

		this.boundary.input( 'mechanic-request', request );
		const entry = this.session.entries.find( ( candidate ) => candidate.definition.id === request.questId );
		const step = entry?.runtime.activeSteps().find( ( candidate ) => candidate.stepId === request.stepId );
		if ( ! step ) return this.#failure( request, 'unknown_target', 'That mechanic target is no longer active.' );
		if ( step.target.kind !== TARGET_KIND[ request.event.kind ] ) {

			return this.#failure( request, 'wrong_event', `The active ${step.target.kind} step does not accept ${request.event.kind}.` );

		}
		const moved = this.session.advanceFor( request.questId, request.event, request.timeMin );
		if ( moved.length === 0 ) {

			return this.#failure( request, 'runtime_rejected', 'The quest state rejected that measured mechanic event.' );

		}
		return this.#result( request, {
			ok: true,
			progressed: true,
			message: step.narrative.description,
			completed: moved.map( ( change ) => questCompletion( change, this.session.view() ) )
		} );

	}

	#failure( request, code, message ) {

		return this.#result( request, { ok: false, progressed: false, code, message, completed: [] } );

	}

	#result( request, result ) {

		return this.boundary.output( 'mechanic-result', {
			...result,
			questId: request.questId,
			stepId: request.stepId,
			eventKind: request.event.kind,
			inventory: this.session.inventoryView()
		} );

	}

}
