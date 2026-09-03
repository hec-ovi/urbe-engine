import { InvestigationBoundary } from './InvestigationBoundary.js';
import { InvestigationError } from './InvestigationError.js';

/** Applies evidence interactions without owning or interpreting quest state. */
export class InvestigationRuntime {

	constructor( assembly, boundary = new InvestigationBoundary() ) {

		this.boundary = boundary;
		this.assembly = this.boundary.input( 'scene-assembly', assembly );
		this.evidence = new Map( assembly.evidence.map( ( item ) => [ item.evidenceId, item ] ) );
		this.targetsByKey = new Map( assembly.targets.map( ( target ) => [ target.targetKey, target ] ) );

	}

	targets( query ) {

		this.boundary.input( 'target-query', query );
		const statuses = validateState( this.assembly, query.state );
		const targets = this.assembly.targets.map( ( target ) => {

			const evidence = this.evidence.get( target.evidenceId );
			const status = statuses.get( target.evidenceId );
			const prerequisite = evidence.prerequisiteEvidenceIds.some( ( id ) => statuses.get( id ) === 'undiscovered' );
			if ( status === 'collected' ) return { ...target, available: false, unavailableReason: 'already-collected' };
			if ( prerequisite ) return { ...target, available: false, unavailableReason: 'prerequisite' };
			const { unavailableReason: ignored, ...available } = target;
			return { ...available, available: true };

		} );
		return this.boundary.output( 'interaction-targets', targets );

	}

	perform( request ) {

		this.boundary.input( 'interaction-request', request );
		if ( request.state.sceneId !== this.assembly.sceneId ) return this.#failure( request, 'wrong-scene', 'This saved investigation belongs to another scene.' );
		const statuses = validateState( this.assembly, request.state );
		const target = this.targets( { state: request.state } ).find( ( item ) => item.targetKey === request.targetKey );
		if ( ! target ) return this.#failure( request, 'unknown-target', 'That evidence target is not part of this scene.' );
		if ( ! target.actions.includes( request.action ) ) return this.#failure( request, 'wrong-action', `${target.label} cannot be ${request.action === 'take' ? 'taken' : 'inspected'}.` );
		if ( ! target.available ) {

			const code = target.unavailableReason === 'already-collected' ? 'already-resolved' : 'prerequisite';
			return this.#failure( request, code, code === 'prerequisite' ? 'Another scene fact must be discovered first.' : 'That evidence has already been collected.' );

		}
		if ( ! request.focus.visible ) return this.#failure( request, 'not-visible', 'Aim at the evidence before interacting.' );
		if ( ! request.focus.unobstructed ) return this.#failure( request, 'occluded', 'Something blocks the evidence.' );
		if ( request.focus.distanceMeters > target.maxDistanceMeters ) return this.#failure( request, 'out-of-reach', `Move within ${target.maxDistanceMeters} metres of the evidence.` );

		const evidence = this.evidence.get( target.evidenceId );
		const previous = statuses.get( target.evidenceId );
		if ( request.action === 'inspect' && previous !== 'undiscovered' ) return this.#failure( request, 'already-resolved', 'That evidence has already been inspected.' );
		if ( request.action === 'take' && evidence.requiresInspection && previous === 'undiscovered' ) return this.#failure( request, 'inspect-first', 'Inspect the evidence before collecting it.' );

		const status = request.action === 'take' ? 'collected' : 'discovered';
		const state = structuredClone( request.state );
		state.revision ++;
		state.evidence.find( ( item ) => item.evidenceId === target.evidenceId ).status = status;
		const emitted = new Set( state.emittedTransitionIds );
		const events = evidence.consequences
			.filter( ( consequence ) => consequence.when === status && ! emitted.has( consequence.transitionId ) )
			.map( ( consequence ) => ( { transitionId: consequence.transitionId, ...structuredClone( consequence.event ) } ) );
		for ( const event of events ) {

			emitted.add( event.transitionId );
			state.emittedTransitionIds.push( event.transitionId );

		}
		this.boundary.output( 'scene-state', state );

		return this.boundary.output( 'interaction-result', {
			ok: true,
			targetKey: request.targetKey,
			action: request.action,
			message: request.action === 'take' ? `Collected ${target.label}.` : evidence.description,
			state,
			events,
			worldChanges: request.action === 'take' ? [ { entityId: target.entityId, state: 'collected' } ] : []
		} );

	}

	#failure( request, code, message ) {

		return this.boundary.output( 'interaction-result', {
			ok: false,
			targetKey: request.targetKey,
			action: request.action,
			message,
			code,
			state: structuredClone( request.state ),
			events: [],
			worldChanges: []
		} );

	}

}

function validateState( assembly, state ) {

	if ( state.sceneId !== assembly.sceneId ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `state ${state.sceneId} does not belong to ${assembly.sceneId}` );
	const expected = new Set( assembly.evidence.map( ( item ) => item.evidenceId ) );
	const statuses = new Map();
	for ( const item of state.evidence ) {

		if ( statuses.has( item.evidenceId ) ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `duplicate state evidence ${item.evidenceId}` );
		if ( ! expected.has( item.evidenceId ) ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `unknown state evidence ${item.evidenceId}` );
		statuses.set( item.evidenceId, item.status );

	}
	if ( statuses.size !== expected.size ) throw new InvestigationError( 'E_INVESTIGATION_STATE', 'saved investigation omits evidence' );
	const transitions = new Set( assembly.evidence.flatMap( ( item ) => item.consequences.map( ( consequence ) => consequence.transitionId ) ) );
	for ( const id of state.emittedTransitionIds ) if ( ! transitions.has( id ) ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `unknown emitted transition ${id}` );
	return statuses;

}
