import Ajv2020 from 'ajv/dist/2020.js';
import manifestSchema from './schema/manifest.schema.json' with { type: 'json' };
import { QuestBundleError } from './QuestBundleError.js';

export const QUEST_BUNDLE_CATALOGS = Object.freeze( [
	'questlines', 'objectives', 'investigations', 'mechanicTargetBindings', 'missionAssetRequests', 'missionItemBindings'
] );
export const QUEST_BUNDLE_FILES = Object.freeze( [ ...QUEST_BUNDLE_CATALOGS, 'hostCapabilities' ] );

const validateManifest = new Ajv2020( { allErrors: true, strict: true } ).compile( manifestSchema );

/** Validates the complete Quests v0.8.2 engine handoff as one atomic unit. */
export function questBundle( manifest, catalogs ) {

	questBundleManifest( manifest );
	if ( ! catalogs || typeof catalogs !== 'object' || Array.isArray( catalogs ) ) {

		throw new QuestBundleError( 'E_QUEST_BUNDLE_FILES', 'quest bundle catalogs must be one object' );

	}
	for ( const name of QUEST_BUNDLE_CATALOGS ) {

		if ( ! Array.isArray( catalogs[ name ] ) ) {

			throw new QuestBundleError( 'E_QUEST_BUNDLE_FILES', `${manifest.files[ name ]} must contain an array` );

		}
		if ( catalogs[ name ].length !== manifest.counts[ name ] ) {

			throw new QuestBundleError(
				'E_QUEST_BUNDLE_COUNT', `${manifest.files[ name ]} has ${catalogs[ name ].length} records, expected ${manifest.counts[ name ]}`
			);

		}

	}
	assertHostCapabilities( catalogs.hostCapabilities );
	assertContent( catalogs );
	return { manifest, ...catalogs };

}

/** Validates filenames before a filesystem or fetch boundary follows them. */
export function questBundleManifest( manifest ) {

	if ( ! validateManifest( manifest ) ) {

		throw new QuestBundleError(
			'E_QUEST_BUNDLE_INPUT', 'quest-bundle.json does not match the v1.1 contract',
			( validateManifest.errors ?? [] ).map( ( error ) => ( {
				path: error.instancePath || '/', keyword: error.keyword, message: error.message ?? 'invalid value'
			} ) )
		);

	}
	return manifest;

}

/** Selects complete quest-owned records without leaving cross-catalog references. */
export function selectQuestBundle( bundle, questIds, questlinesFile = 'questlines.json' ) {

	const checked = questBundle( bundle.manifest, bundle );
	if ( ! Array.isArray( questIds ) || new Set( questIds ).size !== questIds.length ) {

		throw new QuestBundleError( 'E_QUEST_BUNDLE_INPUT', 'selected quest ids must be a unique array' );

	}
	const selected = new Set( questIds );
	const questlines = checked.questlines.filter( ( definition ) => selected.has( definition.id ) );
	if ( questlines.length !== selected.size ) {

		const found = new Set( questlines.map( ( definition ) => definition.id ) );
		const missing = questIds.filter( ( id ) => ! found.has( id ) );
		throw new QuestBundleError( 'E_QUEST_BUNDLE_CONTENT', `unknown selected quest ids: ${missing.join( ', ' )}` );

	}
	const objectives = checked.objectives.filter( ( objective ) => selected.has( objective.questId ) );
	const investigations = checked.investigations.filter( ( request ) => selected.has( request.questId ) );
	const mechanicTargetBindings = checked.mechanicTargetBindings.filter( ( binding ) => selected.has( binding.questId ) );
	const missionItemBindings = checked.missionItemBindings.filter( ( binding ) => selected.has( binding.questId ) );
	const assetIds = new Set( [ ...missionItemBindings, ...mechanicTargetBindings ].map( ( binding ) => binding.assetId ) );
	const missionAssetRequests = checked.missionAssetRequests.filter( ( request ) => assetIds.has( request.assetId ) );
	const catalogs = {
		questlines, objectives, investigations, mechanicTargetBindings, missionAssetRequests,
		missionItemBindings, hostCapabilities: checked.hostCapabilities
	};
	const manifest = manifestFor( catalogs, questlinesFile );
	return questBundle( manifest, catalogs );

}

export function manifestFor( catalogs, questlinesFile = 'questlines.json' ) {

	return {
		contractVersion: '1.1',
		files: {
			questlines: questlinesFile,
			objectives: 'objectives.json',
			investigations: 'investigations.json',
			mechanicTargetBindings: 'mechanic-target-bindings.json',
			missionAssetRequests: 'mission-assets.json',
			missionItemBindings: 'mission-item-bindings.json',
			hostCapabilities: 'host-capabilities.json'
		},
		counts: Object.fromEntries( QUEST_BUNDLE_CATALOGS.map( ( name ) => [ name, catalogs[ name ]?.length ?? - 1 ] ) )
	};

}

function assertContent( catalogs ) {

	const questIds = uniqueIds( catalogs.questlines, 'id', 'questlines' );
	const expectedObjectives = catalogs.questlines.flatMap( ( definition ) => {

		if ( ! Array.isArray( definition.steps ) ) fail( `questline ${definition.id ?? '(unknown)'} has no steps` );
		return definition.steps.map( ( step ) => ( {
			questId: definition.id, stepId: step.stepId, action: step.target
		} ) );

	} );
	if ( JSON.stringify( catalogs.objectives ) !== JSON.stringify( expectedObjectives ) ) {

		fail( 'objectives.json is not the ordered exact projection of questline steps' );

	}
	for ( const request of catalogs.investigations ) {

		if ( ! questIds.has( request?.questId ) ) fail( `investigation ${request?.sceneId ?? '(unknown)'} names an unknown quest` );

	}
	const assets = uniqueIds( catalogs.missionAssetRequests, 'assetId', 'mission asset requests' );
	const assetById = new Map( catalogs.missionAssetRequests.map( ( request ) => [ request.assetId, request ] ) );
	const bindingKeys = new Set();
	for ( const binding of catalogs.missionItemBindings ) {

		if ( ! questIds.has( binding?.questId ) ) fail( `mission item binding names unknown quest ${binding?.questId}` );
		const definition = catalogs.questlines.find( ( candidate ) => candidate.id === binding.questId );
		if ( ! definition?.items?.some( ( item ) => item.itemId === binding.itemId ) ) {

			fail( `mission item binding names unknown item ${binding?.questId}/${binding?.itemId}` );

		}
		if ( ! assets.has( binding?.assetId ) ) fail( `mission item binding names unknown asset ${binding?.assetId}` );
		const key = `${binding.questId}\u0000${binding.itemId}`;
		if ( bindingKeys.has( key ) ) fail( `mission item binding repeats ${binding.questId}/${binding.itemId}` );
		bindingKeys.add( key );

	}
	assertMechanicBindings( catalogs, questIds, assets, assetById );
	for ( const definition of catalogs.questlines ) {

		for ( const step of definition.steps ) {

			if ( step.target?.kind === 'transportation'
				&& ! catalogs.hostCapabilities.transportationModes.includes( step.target.mode ) ) {

				fail( `transportation ${definition.id}/${step.stepId} uses unsupported mode ${step.target.mode}` );

			}
			if ( step.target?.kind === 'transportation' && step.target.passengerRoleIds.length > 1 ) {

				fail( `transportation ${definition.id}/${step.stepId} exceeds Engine's one controlled passenger` );

			}

		}

	}

}

function assertHostCapabilities( value ) {

	if ( ! value || typeof value !== 'object' || Array.isArray( value )
		|| Object.keys( value ).length !== 1 || ! Array.isArray( value.transportationModes ) ) {

		throw new QuestBundleError( 'E_QUEST_BUNDLE_FILES', 'host-capabilities.json must contain one host capability object' );

	}
	const modes = value.transportationModes;
	if ( new Set( modes ).size !== modes.length || modes.some( ( mode ) => mode !== 'public-transit' ) ) {

		fail( 'host transportation modes must be the measured Engine capability public-transit' );

	}

}

function assertMechanicBindings( catalogs, questIds, assets, assetById ) {

	const expected = new Map();
	for ( const definition of catalogs.questlines ) for ( const step of definition.steps ) {

		if ( [ 'rescue', 'access', 'hacking', 'sabotage' ].includes( step.target?.kind ) ) {

			expected.set( `${definition.id}\u0000${step.stepId}`, { definition, step } );

		}

	}
	const found = new Set();
	for ( const binding of catalogs.mechanicTargetBindings ) {

		if ( ! questIds.has( binding?.questId ) ) fail( `mechanic target binding names unknown quest ${binding?.questId}` );
		const key = `${binding.questId}\u0000${binding.stepId}`;
		if ( found.has( key ) ) fail( `mechanic target binding repeats ${binding.questId}/${binding.stepId}` );
		found.add( key );
		const match = expected.get( key );
		if ( ! match ) fail( `mechanic target binding names unknown fixed step ${binding.questId}/${binding.stepId}` );
		const target = match.step.target;
		const rules = {
			rescue: [ 'releaseTargetId', new Set( [ 'open', 'use' ] ) ],
			access: [ 'accessPointId', new Set( [ 'access' ] ) ],
			hacking: [ 'targetId', new Set( [ 'hack' ] ) ],
			sabotage: [ 'targetId', new Set( [ 'sabotage' ] ) ]
		};
		const [ idField, interactions ] = rules[ target.kind ];
		if ( binding[ idField ] !== target[ idField ] || ! interactions.has( binding.interactionId ) ) {

			fail( `mechanic target binding disagrees with ${binding.questId}/${binding.stepId}` );

		}
		if ( ! assets.has( binding.assetId ) ) fail( `mechanic target binding names unknown asset ${binding.assetId}` );
		if ( ! assetById.get( binding.assetId )?.requiredInteractions?.includes( binding.interactionId ) ) {

			fail( `mechanic target binding interaction ${binding.interactionId} is absent from asset ${binding.assetId}` );

		}

	}
	for ( const [ key, match ] of expected ) if ( ! found.has( key ) ) {

		fail( `fixed step ${match.definition.id}/${match.step.stepId} has no mechanic target binding` );

	}

}

function uniqueIds( values, field, label ) {

	const ids = new Set();
	for ( const value of values ) {

		const id = value?.[ field ];
		if ( typeof id !== 'string' || id.length === 0 ) fail( `${label} contains a missing ${field}` );
		if ( ids.has( id ) ) fail( `${label} repeats ${id}` );
		ids.add( id );

	}
	return ids;

}

function fail( message ) {

	throw new QuestBundleError( 'E_QUEST_BUNDLE_CONTENT', message );

}
