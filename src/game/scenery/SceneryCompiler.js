import { INVESTIGATION_ANIMATION_ASSET, sourceBody } from '../investigation/ProductionMedia.js';
import { poseOf } from './PoseCatalog.js';
import { SceneryBoundary } from './SceneryBoundary.js';
import { SceneryError } from './SceneryError.js';
import { placeDecals, placeEntities, publicEntity, reachableApproaches, validateStaging, worldToLocal } from './StagingAssembler.js';

/** Incident decals by prop kind: the theme's material, its variant and its published world size. */
const DECALS = {
	'blood-pool': { material: 'incident-blood/mid', variantId: 'directional-pool', width: 2.4, height: 1.2 },
	'tyre-marks': { material: 'incident-tyre/poor', variantId: 'directional-transfer', width: 3.6, height: 0.9 }
};
/** How far a decal floats over its floor, inside the 0.002 to 0.02 m the staging contract allows. */
const DECAL_OFFSET = 0.006;
const FAIL = {
	geometry: ( message ) => { throw new SceneryError( 'E_SCENERY_BINDING', message ); },
	noFit: ( message ) => { throw new SceneryError( 'E_SCENERY_NO_FIT', message ); }
};

/**
 * One scene spec in its resolved frame: the people as audited Source bodies
 * wearing their crowd look in a catalog pose, the mission assets the bundle
 * built, and the incident decals of the loaded theme, placed by the staging
 * geometry the investigation scenes use. Every element comes from the spec;
 * the seed only picks positions and quarter turns.
 */
export class SceneryCompiler {

	/**
	 * @param missionAssets `{ get(assetId) }`, the validated mission asset assemblies of the bundle
	 * @param theme the Materials theme whose incident decals the scene wears
	 */
	constructor( { boundary = new SceneryBoundary(), missionAssets = null, theme = 'cyberpunk' } = {} ) {

		this.boundary = boundary;
		this.missionAssets = missionAssets;
		this.theme = theme;

	}

	/**
	 * @param resolved `{ location, place, anchor }` from ScenePlaceResolver
	 * @param actors `[{ actorId, npcId?, gender, appearanceSeed }]`, one per spec actor
	 * @returns `{ request, assembly }`: the staging elements in the
	 * investigation request shape, and the validated staging assembly
	 */
	compile( spec, resolved, actors ) {

		const people = new Map( actors.map( ( actor ) => [ actor.actorId, actor ] ) );
		const entityIds = new Set( [ ...spec.actors.map( ( actor ) => actor.actorId ), ...spec.props.filter( isAsset ).map( ( prop ) => prop.propId ) ] );
		const near = ( prop ) => {

			const id = prop.nearActorId ?? prop.nearPropId;
			if ( id !== undefined && ! entityIds.has( id ) ) FAIL.geometry( `${prop.propId} is near ${id}, which is no actor or mission asset of ${spec.sceneId}` );
			if ( prop.nearActorId !== undefined && ! people.has( prop.nearActorId ) ) FAIL.geometry( `${prop.propId} is near ${prop.nearActorId}, which is no actor of ${spec.sceneId}` );
			return id;

		};
		const bodies = spec.actors.map( ( actor ) => {

			const person = people.get( actor.actorId );
			if ( ! person ) throw new SceneryError( 'E_SCENERY_IDENTITY', `${spec.sceneId} has no identity for ${actor.actorId}` );
			return {
				entityId: actor.actorId,
				asset: sourceBody( person.gender ),
				dimensions: { ...poseOf( actor.pose ).dimensions },
				poseId: actor.pose,
				animationAsset: { ...INVESTIGATION_ANIMATION_ASSET },
				sourceMaterialPolicy: 'dressed-appearance',
				appearance: { gender: person.gender, appearanceSeed: person.appearanceSeed },
				placement: placement( actor.placement, resolved.anchor )
			};

		} );
		const props = spec.props.filter( isAsset ).map( ( prop ) => {

			const assembly = this.missionAssets?.get( prop.assetId ) ?? null;
			if ( ! assembly ) FAIL.geometry( `${spec.sceneId} prop ${prop.propId} names mission asset ${prop.assetId}, which the bundle does not build` );
			const nearEntityId = near( prop );
			return {
				entityId: prop.propId,
				missionAsset: assembly,
				dimensions: { ...assembly.dimensions },
				placement: placement( {
					zone: prop.zone ?? ( nearEntityId ? 'incident' : 'center' ),
					...( nearEntityId ? { nearEntityId } : {} )
				}, resolved.anchor ),
				materials: structuredClone( assembly.materials ),
				portable: assembly.portable
			};

		} );
		const floor = resolved.location.receivingSurfaces.find( ( surface ) => surface.kind === 'floor' );
		const decals = spec.props.filter( ( prop ) => ! isAsset( prop ) ).map( ( prop ) => {

			const decal = DECALS[ prop.kind ];
			const nearEntityId = near( prop );
			if ( ! floor ) FAIL.noFit( `${spec.sceneId} has no floor for ${prop.propId}` );
			return {
				entityId: prop.propId,
				surfaceId: floor.surfaceId,
				width: prop.size?.width ?? decal.width,
				height: prop.size?.height ?? decal.height,
				offsetMeters: DECAL_OFFSET,
				material: { slot: 'surface', key: `${this.theme}/${decal.material}`, variantId: decal.variantId },
				...( nearEntityId ? { nearEntityId } : {} )
			};

		} );
		const request = { sceneId: spec.sceneId, questId: spec.questId, seed: spec.seed, location: resolved.location, bodies, props, decals };

		validateStaging( request, FAIL );
		const placed = placeEntities( request, FAIL );
		const fitted = placeDecals( request, placed, FAIL );
		const visuals = new Map( [
			...placed.map( ( entity ) => [ entity.entityId, { entityId: entity.entityId, local: entity.localFootprint.center } ] ),
			...fitted.map( ( decal ) => [ decal.entityId, {
				entityId: decal.entityId,
				relatedEntityId: request.decals.find( ( item ) => item.entityId === decal.entityId ).nearEntityId,
				local: worldToLocal( request.location, decal.transform.position )
			} ] )
		] );
		const approaches = [ ...reachableApproaches( request.location, placed, visuals ) ]
			.filter( ( [ , point ] ) => point )
			.map( ( [ entityId, point ] ) => ( { entityId, point } ) );
		const location = request.location;
		const assembly = this.boundary.output( 'staging-assembly', {
			contractVersion: '1.0',
			sceneId: spec.sceneId,
			questId: spec.questId,
			place: structuredClone( resolved.place ),
			frame: { kind: location.kind, origin: { ...location.origin }, yawRadians: location.yawRadians, width: location.width, depth: location.depth },
			entities: placed.map( ( entity ) => publicEntity( location, entity ) ),
			decals: fitted,
			actors: spec.actors.map( ( actor ) => {

				const person = people.get( actor.actorId );
				const pose = poseOf( actor.pose );
				return {
					actorId: actor.actorId,
					...( person.npcId ? { npcId: person.npcId } : {} ),
					gender: person.gender,
					appearanceSeed: person.appearanceSeed,
					poseId: actor.pose,
					clip: pose.clip,
					at: pose.at
				};

			} ),
			approaches
		} );
		return { request, assembly };

	}

}

function isAsset( prop ) {

	return prop.kind === 'mission-asset';

}

/** The authored hint; a story slot is where a centred element is placed nearest. */
function placement( authored, anchor ) {

	const hint = structuredClone( authored );
	if ( anchor && hint.zone === 'center' && ! hint.nearEntityId ) hint.point = { ...anchor };
	return hint;

}
