import standard from './notes.md?raw';
import missionAssetValues from '../../mission-assets/schema/values.schema.json' with { type: 'json' };
import sceneSpec from './schema/scene-spec.schema.json' with { type: 'json' };
import values from './schema/values.schema.json' with { type: 'json' };
import { POSE_IDS } from './PoseCatalog.js';
import { SceneryError } from './SceneryError.js';

/** One key for each purpose, pose, decal kind and mission asset family a scene can show. */
const KEYS = new Set( [
	...sceneSpec.properties.purpose.enum.map( ( purpose ) => `purpose-${purpose}` ),
	...POSE_IDS.map( ( poseId ) => `pose-${poseId}` ),
	...values.$defs.prop.properties.kind.enum.filter( ( kind ) => kind !== 'mission-asset' ).map( ( kind ) => `prop-${kind}` ),
	...missionAssetValues.$defs.family.enum.map( ( family ) => `asset-${family}` )
] );

/**
 * What a staged scene shows, as plain sentences read from a Markdown
 * document ([notes.md](notes.md) by default) whose `## key` sections each
 * hold one: the scene's purpose, then each element it still shows.
 */
export class SceneNotes {

	static standard() {

		return new SceneNotes( standard );

	}

	constructor( markdown ) {

		this.sentences = parse( markdown );
		const missing = [ ...KEYS ].filter( ( key ) => ! this.sentences.has( key ) );
		const unknown = [ ...this.sentences.keys() ].filter( ( key ) => ! KEYS.has( key ) );
		if ( missing.length ) throw new SceneryError( 'E_SCENERY_INPUT', `scene notes lack ${missing.join( ', ' )}` );
		if ( unknown.length ) throw new SceneryError( 'E_SCENERY_INPUT', `scene notes name unknown ${unknown.join( ', ' )}` );

	}

	/**
	 * @param spec the scene spec: its purpose, and its actors and props in order
	 * @param assembly its staging assembly, which carries each mission asset's family
	 * @param gone the ids of the elements taken out of the scene
	 */
	of( spec, assembly, gone = new Set() ) {

		const families = new Map( assembly.entities.filter( ( entity ) => entity.missionAsset ).map( ( entity ) => [ entity.entityId, entity.missionAsset.family ] ) );
		const shown = [
			...spec.actors.map( ( actor ) => [ actor.actorId, `pose-${actor.pose}` ] ),
			...spec.props.map( ( prop ) => [ prop.propId, prop.kind === 'mission-asset' ? `asset-${families.get( prop.propId )}` : `prop-${prop.kind}` ] )
		].filter( ( [ elementId ] ) => ! gone.has( elementId ) );
		return [ `purpose-${spec.purpose}`, ...shown.map( ( [ , key ] ) => key ) ].map( ( key ) => this.sentences.get( key ) );

	}

}

/** `## key` sections, each the text under it joined into one line. */
function parse( markdown ) {

	const sentences = new Map();
	let key = null;
	for ( const line of markdown.split( /\r?\n/ ) ) {

		const heading = /^##\s+(\S+)\s*$/.exec( line );
		if ( heading ) key = heading[ 1 ];
		else if ( key && line.trim() ) sentences.set( key, [ sentences.get( key ), line.trim() ].filter( Boolean ).join( ' ' ) );

	}
	return sentences;

}
