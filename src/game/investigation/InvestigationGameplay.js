import * as THREE from 'three/webgpu';
import { InvestigationBoundary } from './InvestigationBoundary.js';
import { InvestigationError } from './InvestigationError.js';
import { InvestigationRuntime } from './InvestigationRuntime.js';
import { InvestigationSceneRenderer } from './InvestigationSceneRenderer.js';
import { SceneAssembler } from './SceneAssembler.js';

const MIN_AIM = 0.76;

/** Player-reachable bridge from exact authored scene evidence to one quest step. */
export class InvestigationGameplay {

	static async create( options ) {

		const boundary = options.boundary ?? new InvestigationBoundary();
		boundary.input( 'scene-requests', options.requests );
		if ( options.saved !== undefined ) boundary.input( 'saved-scenes', options.saved );
		const assembler = options.assembler ?? new SceneAssembler( boundary );
		const assemblies = options.requests.map( ( request ) => {

			if ( request.contractVersion !== '1.1' ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `live scene ${request.sceneId} must use contract 1.1` );
			return assembler.assemble( request );

		} );
		validateBindings( assemblies, options.session );
		const renderer = options.renderer ?? await InvestigationSceneRenderer.create( {
			assemblies,
			materialFactory: options.materialFactory,
			physics: options.physics,
			playerCollider: options.playerCollider,
			animation: options.animation,
			loadGltf: options.loadGltf
		} );
		return new InvestigationGameplay( { ...options, boundary, assemblies, renderer } );

	}

	constructor( { session, boundary, assemblies, renderer, saved = [] } ) {

		this.session = session;
		this.boundary = boundary;
		this.renderer = renderer;
		this.group = renderer.group;
		this.scenes = new Map();
		this.live = new Map();
		const savedByScene = new Map();
		for ( const state of saved ) {

			if ( savedByScene.has( state.sceneId ) ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `duplicate saved scene ${state.sceneId}` );
			savedByScene.set( state.sceneId, state );

		}
		for ( const assembly of assemblies ) {

			const runtime = new InvestigationRuntime( assembly, boundary );
			const state = structuredClone( savedByScene.get( assembly.sceneId ) ?? assembly.initialState );
			runtime.targets( { state } );
			this.scenes.set( assembly.sceneId, {
				assembly, runtime, state,
				bindings: new Map( assembly.questBindings.map( ( binding ) => [ binding.evidenceId, binding ] ) )
			} );
			for ( const item of state.evidence ) if ( item.status === 'collected' ) {

				const target = assembly.targets.find( ( candidate ) => candidate.evidenceId === item.evidenceId );
				renderer.collect( target.entityId );

			}

		}
		for ( const sceneId of savedByScene.keys() ) if ( ! this.scenes.has( sceneId ) ) {

			throw new InvestigationError( 'E_INVESTIGATION_STATE', `saved scene ${sceneId} has no authored scene request` );

		}

	}

	candidates( frame ) {

		this.boundary.input( 'gameplay-frame', frame );
		this.live.clear();
		const candidates = [];
		const eye = vector( frame.eye );
		const look = vector( frame.look );
		const feet = vector( frame.feet );
		for ( const scene of [ ...this.scenes.values() ].sort( ( left, right ) => left.assembly.sceneId.localeCompare( right.assembly.sceneId ) ) ) {

			for ( const target of scene.runtime.targets( { state: scene.state } ) ) {

				if ( ! target.available ) continue;
				const binding = scene.bindings.get( target.evidenceId );
				if ( ! activeStep( this.session, scene.assembly.questId, binding.stepId ) || ! atPlace( frame.playerPlaces, binding.place ) ) continue;
				const rendered = this.renderer.focus( target.entityId );
				if ( ! rendered?.visible ) continue;
				const distance = feet.distanceTo( rendered.position );
				const aim = rendered.position.clone().sub( eye ).normalize().dot( look );
				if ( distance > target.maxDistanceMeters || aim < MIN_AIM || ! this.renderer.unobstructed( eye, rendered.position, target.entityId ) ) continue;
				const interaction = { scene, target, binding, focus: { visible: true, unobstructed: true, distanceMeters: distance } };
				this.live.set( target.targetKey, interaction );
				candidates.push( {
					kind: 'investigation', aim,
					interaction: { targetKey: target.targetKey, prompt: promptFor( target ) }
				} );

			}

		}
		return this.boundary.output( 'gameplay-candidates', candidates );

	}

	perform( request ) {

		this.boundary.input( 'gameplay-perform', request );
		const live = this.live.get( request.targetKey );
		if ( ! live ) return null;
		const action = request.bindingAction === 'secondary-interact' ? 'take' : 'inspect';
		if ( ! live.target.actions.includes( action ) ) return null;
		const result = live.scene.runtime.perform( {
			targetKey: request.targetKey,
			action,
			focus: live.focus,
			state: live.scene.state
		} );
		let moved = [];
		if ( result.ok && action === live.binding.completionAction ) {

			const event = {
				kind: 'investigated', sceneId: live.scene.assembly.sceneId,
				evidenceId: live.target.evidenceId, place: structuredClone( live.binding.place )
			};
			moved = this.session.advanceFor( live.scene.assembly.questId, event, request.timeMin );
			const completed = moved.flatMap( ( change ) => change.completed.map( ( step ) => step.stepId ) );
			if ( ! completed.includes( live.binding.stepId ) ) {

				throw new InvestigationError( 'E_INVESTIGATION_BINDING', `quest rejected authored investigation binding ${live.binding.stepId}` );

			}

		}
		if ( result.ok ) {

			live.scene.state = result.state;
			for ( const change of result.worldChanges ) this.renderer.collect( change.entityId );

		}
		return this.boundary.output( 'gameplay-result', {
			ok: result.ok,
			targetKey: result.targetKey,
			action: result.action,
			progressed: moved.length > 0,
			message: result.message,
			...( result.code ? { code: result.code } : {} ),
			sceneId: live.scene.assembly.sceneId,
			evidenceId: live.target.evidenceId,
			completed: moved.map( completion ),
			sceneEvents: result.events,
			worldChanges: result.worldChanges
		} );

	}

	serialize() {

		return this.boundary.output( 'saved-scenes', [ ...this.scenes.values() ]
			.sort( ( left, right ) => left.assembly.sceneId.localeCompare( right.assembly.sceneId ) )
			.map( ( scene ) => structuredClone( scene.state ) ) );

	}

}

function validateBindings( assemblies, session ) {

	const sceneIds = new Set();
	for ( const assembly of assemblies ) {

		if ( sceneIds.has( assembly.sceneId ) ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `duplicate live scene ${assembly.sceneId}` );
		sceneIds.add( assembly.sceneId );
		const entry = session.entries.find( ( candidate ) => candidate.definition.id === assembly.questId );
		if ( ! entry ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${assembly.sceneId} names unavailable quest ${assembly.questId}` );
		for ( const binding of assembly.questBindings ) {

			const step = entry.definition.steps.find( ( candidate ) => candidate.stepId === binding.stepId );
			const target = step?.target;
			if ( target?.kind !== 'investigation' || target.sceneId !== assembly.sceneId || target.evidenceId !== binding.evidenceId || ! samePlace( target.place, binding.place ) ) {

				throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${assembly.sceneId} does not exactly match quest step ${binding.stepId}` );

			}

		}

	}

}

function activeStep( session, questId, stepId ) {

	const entry = session.entries.find( ( candidate ) => candidate.definition.id === questId );
	return Boolean( entry?.runtime.activeSteps().some( ( step ) => step.stepId === stepId ) );

}

function atPlace( places, place ) {

	const expected = place.parcelId ? { kind: 'parcel', id: place.parcelId } : { kind: 'district', id: place.districtId };
	return places.some( ( present ) => present.kind === expected.kind && present.id === expected.id );

}

function samePlace( left, right ) {

	return ( left.parcelId !== undefined && left.parcelId === right.parcelId ) ||
		( left.districtId !== undefined && left.districtId === right.districtId );

}

function promptFor( target ) {

	return target.actions.map( ( action ) => `${action === 'take' ? 'R' : 'E'}  ${action} ${target.label.toLowerCase()}` ).join( '   ' );

}

function completion( change ) {

	return {
		questId: change.definition.id,
		stepIds: change.completed.map( ( step ) => step.stepId ),
		...( change.ending ? { endingId: change.ending.endingId } : {} ),
		presentation: {
			title: change.definition.title,
			steps: change.completed.map( ( step ) => step.narrative.description ),
			...( change.ending ? { ending: { title: change.ending.title, text: change.ending.epilogue, outcome: 'done' } } : {} )
		}
	};

}

function vector( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}
