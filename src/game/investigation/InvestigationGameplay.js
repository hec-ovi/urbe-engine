import * as THREE from 'three/webgpu';
import { InvestigationBoundary } from './InvestigationBoundary.js';
import { InvestigationError } from './InvestigationError.js';
import { InvestigationRuntime } from './InvestigationRuntime.js';
import { InvestigationSceneRenderer } from './InvestigationSceneRenderer.js';
import { SceneAssembler } from './SceneAssembler.js';

const MIN_AIM = 0.76;

/**
 * Player-reachable bridge from exact authored scene evidence to one quest
 * step. A scene stands only while the scenery director has it staged: a 1.1
 * scene is drawn by this layer, a 1.2 scene is composed over the elements of
 * the scenery scene it links and drawn by that scene.
 */
export class InvestigationGameplay {

	static async create( options ) {

		const boundary = options.boundary ?? new InvestigationBoundary();
		boundary.input( 'scene-requests', options.requests );
		if ( options.saved !== undefined ) boundary.input( 'saved-scenes', options.saved );
		const assembler = options.assembler ?? new SceneAssembler( boundary );
		const scenes = options.requests.map( ( request ) => {

			if ( request.contractVersion === '1.2' ) return { request, assembly: null };
			if ( request.contractVersion !== '1.1' ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `live scene ${request.sceneId} must use contract 1.1 or 1.2` );
			return { request, assembly: assembler.assemble( request ) };

		} );
		validateBindings( scenes.map( ( scene ) => scene.request ), options.session );
		const renderer = options.renderer ?? new InvestigationSceneRenderer( {
			materialFactory: options.materialFactory,
			physics: options.physics,
			playerCollider: options.playerCollider,
			animation: options.animation,
			loadGltf: options.loadGltf
		} );
		return new InvestigationGameplay( { ...options, boundary, assembler, scenes, renderer } );

	}

	constructor( { session, boundary, assembler, scenes, renderer, saved = [] } ) {

		this.session = session;
		this.boundary = boundary;
		this.assembler = assembler;
		this.renderer = renderer;
		this.group = renderer.group;
		this.scenes = new Map();
		this.live = new Map();
		const savedByScene = new Map();
		for ( const state of saved ) {

			if ( savedByScene.has( state.sceneId ) ) throw new InvestigationError( 'E_INVESTIGATION_STATE', `duplicate saved scene ${state.sceneId}` );
			savedByScene.set( state.sceneId, state );

		}
		for ( const { request, assembly } of scenes ) {

			const state = structuredClone( savedByScene.get( request.sceneId ) ?? initialState( request ) );
			const runtime = assembly ? new InvestigationRuntime( assembly, boundary ) : null;
			if ( runtime ) runtime.targets( { state } );
			else assertLinkedState( request, state );
			this.scenes.set( request.sceneId, {
				request, assembly, runtime, state, status: 'dormant', visuals: null,
				bindings: new Map( request.questBindings.map( ( binding ) => [ binding.evidenceId, binding ] ) )
			} );

		}
		for ( const sceneId of savedByScene.keys() ) if ( ! this.scenes.has( sceneId ) ) {

			throw new InvestigationError( 'E_INVESTIGATION_STATE', `saved scene ${sceneId} has no authored scene request` );

		}

	}

	/**
	 * What the scenery director stages: every scene's quest and bound steps,
	 * and the scenery scene a 1.2 scene links.
	 */
	lifecycles() {

		return [ ...this.scenes.values() ].map( ( { request } ) => ( {
			sceneId: request.sceneId,
			questId: request.questId,
			stepIds: request.questBindings.map( ( binding ) => binding.stepId ),
			scenerySceneId: request.scenery?.sceneId ?? null
		} ) );

	}

	/**
	 * Stands one scene. A 1.1 scene is drawn here; a 1.2 scene takes the
	 * staging request and visuals of its scenery scene through `link`.
	 */
	async stage( sceneId, link ) {

		const scene = this.scenes.get( sceneId );
		if ( ! scene || scene.status !== 'dormant' ) return false;
		if ( scene.request.scenery ) {

			if ( ! link ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${sceneId} stands only with scenery ${scene.request.scenery.sceneId}` );
			scene.assembly = this.assembler.assemble( composeRequest( scene.request, link.request ) );
			scene.runtime = new InvestigationRuntime( scene.assembly, this.boundary );
			scene.runtime.targets( { state: scene.state } );
			scene.visuals = link.visuals;

		} else {

			scene.status = 'staging';
			let shown;
			try {

				shown = await this.renderer.realize( scene.assembly );

			} catch ( error ) {

				if ( scene.status === 'staging' ) scene.status = 'dormant';
				throw error;

			}
			if ( scene.status !== 'staging' || ! shown ) return false;
			scene.visuals = this.renderer;

		}
		scene.status = 'staged';
		for ( const item of scene.state.evidence ) if ( item.status === 'collected' ) {

			scene.visuals.collect( scene.assembly.targets.find( ( target ) => target.evidenceId === item.evidenceId ).entityId );

		}
		return true;

	}

	/** Takes one scene down for good; its saved evidence state stays. */
	retire( sceneId ) {

		const scene = this.scenes.get( sceneId );
		if ( ! scene || scene.status === 'retired' ) return;
		scene.status = 'retired';
		scene.visuals = null;
		if ( ! scene.request.scenery ) this.renderer.release( sceneId );

	}

	candidates( frame ) {

		this.boundary.input( 'gameplay-frame', frame );
		this.live.clear();
		const candidates = [];
		const eye = vector( frame.eye );
		const look = vector( frame.look );
		const feet = vector( frame.feet );
		for ( const scene of [ ...this.scenes.values() ].sort( ( left, right ) => left.request.sceneId.localeCompare( right.request.sceneId ) ) ) {

			if ( scene.status !== 'staged' ) continue;
			for ( const target of scene.runtime.targets( { state: scene.state } ) ) {

				if ( ! target.available ) continue;
				const binding = scene.bindings.get( target.evidenceId );
				if ( ! activeStep( this.session, scene.request.questId, binding.stepId ) || ! atPlace( frame.playerPlaces, binding.place ) ) continue;
				const rendered = scene.visuals.focus( target.entityId );
				if ( ! rendered?.visible ) continue;
				const distance = feet.distanceTo( rendered.position );
				const aim = rendered.position.clone().sub( eye ).normalize().dot( look );
				if ( distance > target.maxDistanceMeters || aim < MIN_AIM || ! scene.visuals.unobstructed( eye, rendered.position, target.entityId ) ) continue;
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
		if ( ! live || live.scene.status !== 'staged' ) return null;
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
				kind: 'investigated', sceneId: live.scene.request.sceneId,
				evidenceId: live.target.evidenceId, place: structuredClone( live.binding.place )
			};
			moved = this.session.advanceFor( live.scene.request.questId, event, request.timeMin );
			const completed = moved.flatMap( ( change ) => change.completed.map( ( step ) => step.stepId ) );
			if ( ! completed.includes( live.binding.stepId ) ) {

				throw new InvestigationError( 'E_INVESTIGATION_BINDING', `quest rejected authored investigation binding ${live.binding.stepId}` );

			}

		}
		if ( result.ok ) {

			live.scene.state = result.state;
			for ( const change of result.worldChanges ) live.scene.visuals.collect( change.entityId );

		}
		return this.boundary.output( 'gameplay-result', {
			ok: result.ok,
			targetKey: result.targetKey,
			action: result.action,
			progressed: moved.length > 0,
			message: result.message,
			...( result.code ? { code: result.code } : {} ),
			sceneId: live.scene.request.sceneId,
			evidenceId: live.target.evidenceId,
			completed: moved.map( completion ),
			sceneEvents: result.events,
			worldChanges: result.worldChanges
		} );

	}

	serialize() {

		return this.boundary.output( 'saved-scenes', [ ...this.scenes.values() ]
			.sort( ( left, right ) => left.request.sceneId.localeCompare( right.request.sceneId ) )
			.map( ( scene ) => structuredClone( scene.state ) ) );

	}

}

/**
 * A 1.2 scene as the 1.1 request its scenery scene's elements make: the same
 * frame, seed and elements in the same order, each evidence on the element
 * it names, so the placement is exactly the scenery scene's.
 */
export function composeRequest( linked, staging ) {

	const evidenceOf = new Map( linked.evidenceVisuals.map( ( visual ) => [ visual.entityId, visual.evidenceId ] ) );
	const known = new Set( [ ...staging.bodies, ...staging.props, ...staging.decals ].map( ( element ) => element.entityId ) );
	const missing = linked.evidenceVisuals.filter( ( visual ) => ! known.has( visual.entityId ) );
	if ( missing.length ) {

		throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${linked.sceneId} names elements scenery ${linked.scenery.sceneId} lacks: ${missing.map( ( visual ) => visual.entityId ).join( ', ' )}` );

	}
	const tag = ( element ) => evidenceOf.has( element.entityId ) ? { ...element, evidenceId: evidenceOf.get( element.entityId ) } : element;
	return {
		contractVersion: '1.1',
		sceneId: linked.sceneId,
		questId: linked.questId,
		seed: staging.seed,
		incident: structuredClone( linked.incident ),
		questBindings: structuredClone( linked.questBindings ),
		location: structuredClone( staging.location ),
		bodies: staging.bodies.map( tag ),
		props: staging.props.map( tag ),
		decals: staging.decals.map( tag ),
		evidence: structuredClone( linked.evidence )
	};

}

function initialState( request ) {

	return {
		contractVersion: '1.0',
		sceneId: request.sceneId,
		revision: 0,
		evidence: request.evidence.map( ( item ) => ( { evidenceId: item.evidenceId, status: 'undiscovered' } ) ),
		emittedTransitionIds: []
	};

}

/** A 1.2 scene's saved state names exactly its authored evidence, once each. */
function assertLinkedState( request, state ) {

	const authored = request.evidence.map( ( item ) => item.evidenceId ).sort();
	const saved = state.evidence.map( ( item ) => item.evidenceId ).sort();
	if ( state.sceneId !== request.sceneId || JSON.stringify( authored ) !== JSON.stringify( saved ) ) {

		throw new InvestigationError( 'E_INVESTIGATION_STATE', `saved scene ${request.sceneId} does not match its authored evidence` );

	}

}

function validateBindings( requests, session ) {

	const sceneIds = new Set();
	for ( const request of requests ) {

		if ( sceneIds.has( request.sceneId ) ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `duplicate live scene ${request.sceneId}` );
		sceneIds.add( request.sceneId );
		const entry = session.entries.find( ( candidate ) => candidate.definition.id === request.questId );
		if ( ! entry ) throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${request.sceneId} names unavailable quest ${request.questId}` );
		if ( request.evidenceVisuals ) {

			const visualEvidence = request.evidenceVisuals.map( ( visual ) => visual.evidenceId ).sort();
			const entities = new Set( request.evidenceVisuals.map( ( visual ) => visual.entityId ) );
			if ( JSON.stringify( visualEvidence ) !== JSON.stringify( request.evidence.map( ( item ) => item.evidenceId ).sort() ) || entities.size !== visualEvidence.length ) {

				throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${request.sceneId} must name one element for each evidence` );

			}

		}
		for ( const binding of request.questBindings ) {

			const step = entry.definition.steps.find( ( candidate ) => candidate.stepId === binding.stepId );
			const target = step?.target;
			if ( target?.kind !== 'investigation' || target.sceneId !== request.sceneId || target.evidenceId !== binding.evidenceId || ! samePlace( target.place, binding.place ) ) {

				throw new InvestigationError( 'E_INVESTIGATION_BINDING', `scene ${request.sceneId} does not exactly match quest step ${binding.stepId}` );

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
