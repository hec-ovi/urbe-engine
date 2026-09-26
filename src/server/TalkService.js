import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Converse, DialogContextService, QuestlineRuntime } from '../../../quests/dist/index.js';
import { DEFAULT_TYPE_SET } from '../../../simulation/dist/index.js';
import { Sentences } from './Sentences.js';
import { SnapshotPort } from './SnapshotPort.js';

const FALLBACK_THEME = 'a night city';
/** A save keeps what this many people remember, those talked to last, */
const MEMORY_PEOPLE = 200;
/** and at most this many of each one's folded notes and of their turns, the newest. */
const MEMORY_NOTES = 24;
const MEMORY_TURNS = 24;
/** The files a world's dialogue is built from; a change to any of them builds it again. */
const WORLD_FILES = [ 'blueprint.json', 'npc-types.json', join( 'quests', 'questlines.json' ) ];

/**
 * One NPC reply per player line, over the quests dialog layers. Each served
 * world (its `out` directory) keeps one dialogue state for the session, so what
 * an NPC has been told stays remembered, until the world's files change or the
 * directory is made again. A game hands its save's memory back at load and
 * reads it again for each save.
 */
export class TalkService {

	/** Served directory -> { stamp, world: Promise<TalkWorld> }. */
	#worlds = new Map();

	/** @param llm the quests StreamingLLMPort; @param outRoot the directory the browser's out paths are served from */
	constructor( llm, outRoot ) {

		this.llm = llm;
		this.converse = new Converse( llm );
		this.outRoot = resolve( outRoot );

	}

	/**
	 * The NPC's reply as it is spoken: `delta` text pieces, each `sentence` as it
	 * completes, then any `offer`, then `done` with the whole reply. A completed
	 * exchange is remembered before `done`; a failed or aborted one is not.
	 * @param request a checked talk request: out, npc, behavior, line, timeMin, quests?, offers?, guide?
	 * @param options.signal aborting it ends the model request
	 */
	async *stream( { out, npc, behavior, line, timeMin, quests = [], offers, guide }, { signal } = {} ) {

		const world = await this.#world( out );
		const context = world.contextFor( npc, behavior, quests, timeMin, guide );
		const name = `${npc.name.given} ${npc.name.family}`;
		const sentences = new Sentences();
		let index = 0;
		for await ( const event of this.converse.replyStream( { context, name, line, offers, signal } ) ) {

			if ( event.type === 'delta' ) {

				yield event;
				for ( const text of sentences.push( event.text ) ) yield { type: 'sentence', index: index ++, text };
				continue;

			}
			for ( const text of sentences.end() ) yield { type: 'sentence', index: index ++, text };
			if ( event.type === 'offer' ) {

				yield event;

			} else {

				world.remember( npc.npcId, { line, reply: event.reply, atMin: timeMin } );
				yield { type: 'done', reply: event.reply };

			}

		}

	}

	/** What people remember of talking with the player in the world at `out`, as a save keeps it: see TalkWorld.memory. */
	async memory( out ) {

		return ( await this.#world( out ) ).memory();

	}

	/** Makes `memory`, a save's, all that people remember in the world at `out`. */
	async restoreMemory( out, memory ) {

		( await this.#world( out ) ).restoreMemory( memory );

	}

	async #world( out ) {

		const served = join( this.outRoot, 'out' );
		const dir = resolve( this.outRoot, `.${out}` );
		if ( ! dir.startsWith( served + sep ) ) throw new Error( `out path outside the served worlds: ${out}` );

		const stamp = ( await Promise.all( WORLD_FILES.map( ( file ) => stat( join( dir, file ) ).then(
			( s ) => `${s.ino}:${s.size}:${s.mtimeMs}`, () => '-' ) ) ) ).join( '|' );
		let entry = this.#worlds.get( dir );
		if ( entry?.stamp !== stamp ) {

			entry = { stamp, world: TalkWorld.load( dir, this.llm ) };
			this.#worlds.set( dir, entry );
			entry.world.catch( () => this.#worlds.get( dir ) === entry && this.#worlds.delete( dir ) );

		}
		return entry.world;

	}

}

/** One world's dialogue state: the NPC the browser shows, its questlines and every NPC's memory. */
class TalkWorld {

	port = new SnapshotPort();
	#attached = new Set();

	static async load( dir, llm ) {

		const blueprint = JSON.parse( await readFile( join( dir, 'blueprint.json' ), 'utf8' ) );
		const types = await readJson( join( dir, 'npc-types.json' ), DEFAULT_TYPE_SET );
		const questlines = await readJson( join( dir, 'quests', 'questlines.json' ), [] );
		const naming = blueprint.meta.naming ?? { theme: ( await readJson( join( dir, 'game.json' ), {} ) ).theme ?? FALLBACK_THEME };
		// Districts and places without names stay unnamed: the dialog layers describe them by kind.
		const world = { meta: { naming }, districts: blueprint.districts, parcels: blueprint.parcels, transit: blueprint.transit };
		return new TalkWorld( { world, types, questlines }, llm );

	}

	constructor( { world, types, questlines }, llm ) {

		this.input = { world, types, sim: this.port, llm };
		this.definitions = new Map( questlines.map( ( d ) => [ d.id, d ] ) );
		this.context = new DialogContextService( this.input );

	}

	/**
	 * The NPC's context with exactly the questlines the browser holds now. A
	 * questline the request no longer carries leaves with a fresh context service
	 * that keeps every NPC's memory.
	 */
	contextFor( npc, behavior, quests, timeMin, guide ) {

		this.port.set( npc, behavior );
		const held = quests.filter( ( quest ) => this.definitions.has( quest.id ) );
		const ids = new Set( held.map( ( quest ) => quest.id ) );
		if ( [ ...this.#attached ].some( ( id ) => ! ids.has( id ) ) ) {

			const memory = this.context.serializeMemory();
			this.context = new DialogContextService( this.input );
			this.context.restoreMemory( memory );

		}
		this.#attached = ids;
		for ( const quest of held ) {

			this.context.attachQuestline( QuestlineRuntime.restore( this.definitions.get( quest.id ), quest.cast, this.port, quest.state ) );

		}
		return this.context.contextFor( npc.npcId, timeMin, guide ? { guide } : {} );

	}

	/**
	 * Every person's memory as `[{ npcId, memory: { digest, turns } }]` by
	 * npcId, bounded: the MEMORY_PEOPLE people spoken with last, each with
	 * their MEMORY_NOTES newest notes and MEMORY_TURNS newest turns.
	 */
	memory() {

		return bounded( Object.entries( this.context.serializeMemory() ).map( ( [ npcId, memory ] ) => ( { npcId, memory } ) ) );

	}

	/** Replaces every person's memory with `memory`, bounded the same way. */
	restoreMemory( memory ) {

		this.context.restoreMemory( Object.fromEntries( bounded( memory ).map( ( { npcId, memory: kept } ) => [ npcId, kept ] ) ) );

	}

	/** Stores the exchange now; a memory fold it starts runs off the reply path. */
	remember( npcId, exchange ) {

		this.context.recordExchange( npcId, exchange ).catch( ( error ) => console.warn( 'dialog memory:', error.message ) );

	}

}

/**
 * The people spoken with last and each one's newest notes and turns, sorted
 * by npcId; nobody who remembers nothing. Turns a failed fold left stay
 * verbatim, so the turns are bounded too.
 */
function bounded( records ) {

	const last = ( { memory } ) => memory.turns.at( - 1 )?.atMin ?? - Infinity;
	return records.filter( ( { memory } ) => memory.digest.length || memory.turns.length )
		.sort( ( a, b ) => last( b ) - last( a ) || a.npcId.localeCompare( b.npcId ) )
		.slice( 0, MEMORY_PEOPLE )
		.map( ( { npcId, memory } ) => ( { npcId, memory: { digest: memory.digest.slice( - MEMORY_NOTES ), turns: memory.turns.slice( - MEMORY_TURNS ) } } ) )
		.sort( ( a, b ) => a.npcId.localeCompare( b.npcId ) );

}

function readJson( path, fallback ) {

	return readFile( path, 'utf8' ).then( JSON.parse, () => fallback );

}
