import { InvestigationBoundary } from './InvestigationBoundary.js';
import { InvestigationError } from './InvestigationError.js';
import { assertProductionBody } from './ProductionMedia.js';
import {
	MAX_INTERACTION_DISTANCE, placeDecals, placeEntities, publicEntity, reachableApproaches, validateStaging, worldToLocal
} from '../scenery/StagingAssembler.js';

const FAIL = {
	geometry: ( message ) => geometryError( message ),
	noFit: ( message ) => { throw new InvestigationError( 'E_INVESTIGATION_NO_FIT', message ); }
};

/**
 * Fits only authored incident elements into one measured interior or street
 * frame. No clue, blood mark or story fact is synthesized by this layer.
 */
export class SceneAssembler {

	constructor( boundary = new InvestigationBoundary() ) {

		this.boundary = boundary;

	}

	assemble( request ) {

		this.boundary.input( 'scene-request', request );
		validateScene( request );

		const internals = placeEntities( request, FAIL );
		const decals = placeDecals( request, internals, FAIL );
		const visuals = evidenceVisuals( request, internals, decals );
		const approach = reachableApproaches( request.location, internals, visuals );
		for ( const [ evidenceId, point ] of approach ) if ( ! point ) FAIL.noFit( `evidence ${evidenceId} has no reachable approach` );
		const entities = internals.map( ( internal ) => publicEntity( request.location, internal ) );
		const evidence = structuredClone( request.evidence );
		const initialState = {
			contractVersion: '1.0',
			sceneId: request.sceneId,
			revision: 0,
			evidence: evidence.map( ( item ) => ( { evidenceId: item.evidenceId, status: 'undiscovered' } ) ),
			emittedTransitionIds: []
		};
		const targets = evidence.map( ( item ) => {

			const visual = visuals.get( item.evidenceId );
			return {
				targetKey: targetKey( request.sceneId, item.evidenceId ),
				evidenceId: item.evidenceId,
				entityId: visual.entityId,
				label: item.label,
				description: item.description,
				portable: item.portable,
				approachPoint: approach.get( item.evidenceId ),
				maxDistanceMeters: MAX_INTERACTION_DISTANCE,
				actions: [ 'inspect', ...( item.portable ? [ 'take' ] : [] ) ],
				available: item.prerequisiteEvidenceIds.length === 0,
				...( item.prerequisiteEvidenceIds.length ? { unavailableReason: 'prerequisite' } : {} )
			};

		} );

		return this.boundary.output( 'scene-assembly', {
			contractVersion: request.contractVersion,
			sceneId: request.sceneId,
			questId: request.questId,
			seed: request.seed,
			incident: structuredClone( request.incident ),
			...( request.questBindings ? { questBindings: structuredClone( request.questBindings ) } : {} ),
			location: { kind: request.location.kind, placeId: request.location.placeId },
			entities,
			decals,
			evidence,
			targets,
			initialState
		} );

	}

}

function validateScene( request ) {

	validateStaging( request, FAIL );
	const evidenceIds = unique( request.evidence.map( ( item ) => item.evidenceId ), 'evidence' );
	if ( request.contractVersion === '1.1' ) {

		validateQuestBindings( request, evidenceIds );
		for ( const body of request.bodies ) {

			try {

				assertProductionBody( body );

			} catch ( error ) {

				geometryError( error.message );

			}

		}
		for ( const prop of request.props ) if ( ! prop.missionAsset ) geometryError( `${prop.entityId} is not a mission asset assembly` );

	}

	const visualReferences = new Map();
	for ( const visual of [ ...request.bodies, ...request.props, ...request.decals ] ) {

		if ( ! visual.evidenceId ) continue;
		if ( ! evidenceIds.has( visual.evidenceId ) ) geometryError( `${visual.entityId} references unknown evidence ${visual.evidenceId}` );
		if ( visualReferences.has( visual.evidenceId ) ) geometryError( `evidence ${visual.evidenceId} has more than one visual` );
		visualReferences.set( visual.evidenceId, visual );

	}

	const transitionIds = [];
	for ( const evidence of request.evidence ) {

		if ( ! visualReferences.has( evidence.evidenceId ) ) geometryError( `evidence ${evidence.evidenceId} has no visual` );
		for ( const prerequisite of evidence.prerequisiteEvidenceIds ) {

			if ( ! evidenceIds.has( prerequisite ) ) geometryError( `evidence ${evidence.evidenceId} has unknown prerequisite ${prerequisite}` );
			if ( prerequisite === evidence.evidenceId ) geometryError( `evidence ${evidence.evidenceId} depends on itself` );

		}
		for ( const consequence of evidence.consequences ) transitionIds.push( consequence.transitionId );

		const visual = visualReferences.get( evidence.evidenceId );
		if ( evidence.portable && ( ! request.props.includes( visual ) || ! visual.portable ) ) {

			geometryError( `portable evidence ${evidence.evidenceId} must reference a portable prop` );

		}
		if ( ! evidence.portable && request.props.includes( visual ) && visual.portable ) {

			geometryError( `non-portable evidence ${evidence.evidenceId} references a portable prop` );

		}

	}
	unique( transitionIds, 'transition' );
	assertAcyclicEvidence( request.evidence );

}

function validateQuestBindings( request, evidenceIds ) {

	const steps = unique( request.questBindings.map( ( binding ) => binding.stepId ), 'quest binding step' );
	const boundEvidence = unique( request.questBindings.map( ( binding ) => binding.evidenceId ), 'quest binding evidence' );
	if ( steps.size !== request.questBindings.length || boundEvidence.size !== request.questBindings.length ) {

		geometryError( 'quest bindings must be one-to-one by step and evidence' );

	}
	for ( const evidenceId of evidenceIds ) if ( ! boundEvidence.has( evidenceId ) ) geometryError( `evidence ${evidenceId} has no quest binding` );
	for ( const binding of request.questBindings ) {

		if ( ! evidenceIds.has( binding.evidenceId ) ) geometryError( `quest binding references unknown evidence ${binding.evidenceId}` );
		const placeId = binding.place.parcelId ?? binding.place.districtId;
		if ( placeId !== request.location.placeId ) geometryError( `quest binding ${binding.stepId} does not match scene place ${request.location.placeId}` );
		const evidence = request.evidence.find( ( item ) => item.evidenceId === binding.evidenceId );
		if ( binding.completionAction === 'take' && ! evidence.portable ) geometryError( `quest binding ${binding.stepId} takes non-portable evidence` );

	}

}

function assertAcyclicEvidence( evidence ) {

	const byId = new Map( evidence.map( ( item ) => [ item.evidenceId, item ] ) );
	const visiting = new Set();
	const visited = new Set();

	const visit = ( id ) => {

		if ( visiting.has( id ) ) geometryError( `evidence prerequisites contain a cycle at ${id}` );
		if ( visited.has( id ) ) return;
		visiting.add( id );
		for ( const prerequisite of byId.get( id ).prerequisiteEvidenceIds ) visit( prerequisite );
		visiting.delete( id );
		visited.add( id );

	};

	for ( const id of byId.keys() ) visit( id );

}

function evidenceVisuals( request, entities, decals ) {

	const visuals = new Map();
	for ( const entity of entities ) if ( entity.evidenceId ) {

		visuals.set( entity.evidenceId, { entityId: entity.entityId, local: entity.localFootprint.center } );

	}
	for ( const decal of decals ) if ( decal.evidenceId ) {

		const authored = request.decals.find( ( item ) => item.entityId === decal.entityId );
		visuals.set( decal.evidenceId, {
			entityId: decal.entityId,
			relatedEntityId: authored.nearEntityId,
			local: worldToLocal( request.location, decal.transform.position )
		} );

	}
	return visuals;

}

function targetKey( sceneId, evidenceId ) {

	return `investigation:${encodeURIComponent( sceneId )}:${encodeURIComponent( evidenceId )}`;

}

function unique( values, label ) {

	const result = new Set();
	for ( const value of values ) {

		if ( result.has( value ) ) geometryError( `duplicate ${label} id ${value}` );
		result.add( value );

	}
	return result;

}

function geometryError( message ) {

	throw new InvestigationError( 'E_INVESTIGATION_GEOMETRY', message );

}
