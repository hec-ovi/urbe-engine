import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { Converse, DialogContextService, QuestlineRuntime } from '../../../quests/dist/index.js';
import { DEFAULT_TYPE_SET } from '../../../simulation/dist/index.js';
import { SnapshotPort } from './SnapshotPort.js';

const FALLBACK_NAMING = { theme: 'a night city', namedAt: '' };

/**
 * One NPC reply per player line, over the quests dialog layers. Each assembled
 * world (its `out` directory: blueprint.json, npc-types.json, quests/questlines.json) keeps one context
 * service, so what an NPC has been told stays remembered for the session.
 */
export class TalkService {

	#worlds = new Map();

	/** @param llm the quests LLMPort; @param outRoot the directory the browser's out paths are served from */
	constructor( llm, outRoot ) {

		this.llm = llm;
		this.outRoot = resolve( outRoot );

	}

	/**
	 * @param out the world's out path as the browser sees it (`/out/small`)
	 * @param npc the simulation's NPCInstance the player is talking to
	 * @param behavior its BehaviorState right now
	 * @param quests the browser's questlines as they stand: [{ id, cast, state }], so this person knows their part
	 * @returns the NPC's reply
	 */
	async reply( { out, npc, behavior, line, timeMin, quests = [] } ) {

		const world = await this.#world( out );
		world.port.set( npc, behavior );

		for ( const quest of quests ) {

			const definition = world.definitions.get( quest.id );
			if ( definition ) world.context.attachQuestline( QuestlineRuntime.restore( definition, quest.cast, world.port, quest.state ) );

		}

		const name = `${npc.name.given} ${npc.name.family}`;
		const context = world.context.contextFor( npc.npcId, timeMin );
		await world.context.recordTurn( npc.npcId, { speaker: 'player', text: line, atMin: timeMin } );
		const reply = await world.converse.reply( { context, name, line } );
		await world.context.recordTurn( npc.npcId, { speaker: 'npc', text: reply, atMin: timeMin } );
		return reply;

	}

	async #world( out ) {

		const dir = normalize( join( this.outRoot, out ) );
		if ( ! dir.startsWith( this.outRoot + sep ) ) throw new Error( `out path outside the served worlds: ${out}` );

		let world = this.#worlds.get( dir );
		if ( world ) return world;

		const blueprint = JSON.parse( await readFile( join( dir, 'blueprint.json' ), 'utf8' ) );
		const types = await readFile( join( dir, 'npc-types.json' ), 'utf8' ).then( JSON.parse ).catch( () => DEFAULT_TYPE_SET );
		const questlines = await readFile( join( dir, 'quests', 'questlines.json' ), 'utf8' ).then( JSON.parse ).catch( () => [] );
		const port = new SnapshotPort();
		const context = new DialogContextService( { world: named( blueprint ), types, sim: port, llm: this.llm } );
		world = { port, context, converse: new Converse( this.llm ), definitions: new Map( questlines.map( ( d ) => [ d.id, d ] ) ) };
		this.#worlds.set( dir, world );
		return world;

	}

}

/** A blueprint as the dialog layers read it: every district carries a name, the meta a naming theme. */
function named( blueprint ) {

	return {
		...blueprint,
		meta: { ...blueprint.meta, naming: blueprint.meta.naming ?? FALLBACK_NAMING },
		districts: blueprint.districts.map( ( d ) => ( { ...d, name: d.name ?? d.id } ) )
	};

}
