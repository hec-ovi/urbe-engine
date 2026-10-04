import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Converse, DialogContextService, QuestlineRuntime } from '../../../quests/dist/index.js';
import { DEFAULT_TYPE_SET } from '../../../simulation/dist/index.js';
import { replaceFile } from '../assembly/JsonFile.js';
import { Sentences } from './Sentences.js';
import { SnapshotPort } from './SnapshotPort.js';

const FALLBACK_THEME = 'a night city';
/** A save keeps what this many people remember, those talked to last, */
const MEMORY_PEOPLE = 200;
/** and at most this many of each one's folded notes and of their turns, the newest. */
const MEMORY_NOTES = 24;
const MEMORY_TURNS = 24;
/** The files a world's dialogue is built from; a change to any of them builds it again. */
const WORLD_FILES = [ 'blueprint.json', 'npc-types.json', join( 'quests', 'questlines.json' ), 'manifest.json' ];
/** Where a game keeps what people remember, beside its save, as each exchange completes. */
const MEMORY_FILE = 'dialogue-memory.json';

/**
 * One NPC reply per player line, over the quests dialog layers. Each served
 * world (its `out` directory) keeps one dialogue state, so what an NPC has
 * been told stays remembered: a game (a world with `game.json`) keeps it in
 * its own directory as each exchange completes and reads it back when the
 * world is built, while any other world keeps it for the session only, until
 * the world's files change or the directory is made again. A game's save
 * joins its memory at load and reads it again for each save.
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
	 * completes, then any `offer`, then `done` with the whole reply. The
	 * `prior` lines said since the last exchange carry the conversation on up
	 * to `line`. A completed exchange is remembered, after its prior lines,
	 * before `done`; a failed or aborted one is not.
	 * @param request a checked talk request: out, npc, behavior, line, timeMin, quests?, offers?, guide?, events?, look?, here?, people?, task?, call?, addresses?, witnesses?, prior?
	 * @param options.signal aborting it ends the model request
	 */
	async *stream( { out, npc, behavior, line, timeMin, quests = [], offers, guide, events, look, here, people, task, call, addresses, witnesses = [], prior = [] }, { signal } = {} ) {

		const world = await this.#world( out );
		const context = world.contextFor( npc, behavior, quests, timeMin, { guide, events, look, here, people, task, call, addresses, prior } );
		const name = `${npc.name.given} ${npc.name.family}`;
		const sentences = new Sentences();
		let index = 0;
		// The talk so far, up to the line: what the person offered or was asked a moment ago is read from it.
		const turns = world.turnsOf( npc.npcId, prior );
		for await ( const event of this.converse.replyStream( { context, name, line, offers, signal, turns } ) ) {

			if ( event.type === 'delta' ) {

				yield event;
				for ( const text of sentences.push( event.text ) ) yield { type: 'sentence', index: index ++, text };
				continue;

			}
			for ( const text of sentences.end() ) yield { type: 'sentence', index: index ++, text };
			if ( event.type === 'offer' ) {

				yield event;

			} else {

				world.remember( npc.npcId, { line, reply: event.reply, atMin: timeMin, prior } );
				// Whoever was there heard it too, and remembers it as overheard.
				world.overhear( witnesses.filter( ( id ) => id !== npc.npcId ), npc, [ ...prior, { speaker: 'player', text: line }, { speaker: 'npc', text: event.reply } ], timeMin );
				yield { type: 'done', reply: event.reply };

			}

		}

	}

	/** What people remember of talking with the player in the world at `out`, as a save keeps it (see TalkWorld.memory), or `npcId` alone. */
	async memory( out, npcId = null ) {

		const memory = ( await this.#world( out ) ).memory();
		return npcId ? memory.filter( ( record ) => record.npcId === npcId ) : memory;

	}

	/**
	 * Takes a save's `memory` back into the world at `out`: the world's memory
	 * holds all any save holds, so the save's only fills in the people the
	 * world does not remember (see TalkWorld.restoreMemory).
	 */
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

			// A world built again reads the memory back; the one it replaces keeps nothing more.
			entry?.world.then( ( world ) => world.retire(), () => {} );
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
	/** The game's memory file, or null for a world that keeps memory for the session only, and the text it holds. */
	#file;
	#written = null;

	static async load( dir, llm ) {

		const blueprint = JSON.parse( await readFile( join( dir, 'blueprint.json' ), 'utf8' ) );
		const types = await readJson( join( dir, 'npc-types.json' ), DEFAULT_TYPE_SET );
		const questlines = await readJson( join( dir, 'quests', 'questlines.json' ), [] );
		const naming = blueprint.meta.naming ?? { theme: ( await readJson( join( dir, 'game.json' ), {} ) ).theme ?? FALLBACK_THEME };
		// Districts and places without names stay unnamed: the dialog layers describe them by kind. The
		// street edges name the streets people stand on and the buildings on them.
		const streets = blueprint.streets?.edges && {
			edges: blueprint.streets.edges.map( ( { id, class: kind, path, level } ) => ( { id, class: kind, path, level } ) )
		};
		// A world assembled with interiors opens those buildings alone: the rest are no place to go.
		const opened = ( await readJson( join( dir, 'manifest.json' ), {} ) ).interiors;
		const closed = Array.isArray( opened ) ? blueprint.parcels.map( ( parcel ) => parcel.id ).filter( ( id ) => ! opened.includes( id ) ) : null;
		const world = {
			meta: { naming, gridAngle: blueprint.meta.gridAngle ?? 0 }, districts: blueprint.districts, parcels: blueprint.parcels,
			transit: blueprint.transit, ...( streets ? { streets } : {} ), ...( closed ? { closed } : {} )
		};
		const game = await stat( join( dir, 'game.json' ) ).then( () => true, () => false );
		const talk = new TalkWorld( { world, types, questlines, file: game ? join( dir, MEMORY_FILE ) : null }, llm );
		if ( game ) talk.#recall( await readJson( join( dir, MEMORY_FILE ), [] ) );
		return talk;

	}

	constructor( { world, types, questlines, file = null }, llm ) {

		this.input = { world, types, sim: this.port, llm };
		this.definitions = new Map( questlines.map( ( d ) => [ d.id, d ] ) );
		this.context = new DialogContextService( this.input );
		this.#file = file;

	}

	/**
	 * The NPC's context with exactly the questlines the browser holds now, the
	 * place it led the player to and the lines said since the last exchange. A
	 * questline the request no longer carries leaves with a fresh context service
	 * that keeps every NPC's memory.
	 */
	contextFor( npc, behavior, quests, timeMin, { guide, events, look, here, people, task, call, addresses, prior } ) {

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
		return this.context.contextFor( npc.npcId, timeMin, {
			...( guide ? { guide } : {} ), ...( events ? { events } : {} ), ...( look ? { look } : {} ), ...( here ? { here } : {} ),
			...( people ? { people } : {} ), ...( task ? { task } : {} ), ...( call ? { call } : {} ), ...( addresses ? { addresses } : {} ), prior
		} );

	}

	/**
	 * Every person's memory as `[{ npcId, memory: { digest, turns } }]` by
	 * npcId, bounded: the MEMORY_PEOPLE people spoken with last, each with
	 * their MEMORY_NOTES newest notes and MEMORY_TURNS newest turns.
	 */
	memory() {

		return bounded( Object.entries( this.context.serializeMemory() ).map( ( [ npcId, memory ] ) => ( { npcId, memory } ) ) );

	}

	/**
	 * Joins a save's `memory` to what the world remembers, bounded the same
	 * way. Every save reads the world's memory and a game's is kept on disk as
	 * it changes, so the world's is never older than a save's: each person it
	 * remembers keeps it, and the save's fills in the people it lacks, as after
	 * a server restart for a world kept for the session only, or for a game
	 * saved before its memory file or whose file could not be read. Game
	 * minutes cannot order the two: a game reopened from its save resumes its
	 * clock there, before talk the world already remembers.
	 */
	restoreMemory( memory ) {

		this.#join( memory );
		this.#keep();

	}

	/** What this person and the player said, oldest first, as the memory holds it verbatim, then the `prior` lines shown since. */
	turnsOf( npcId, prior = [] ) {

		const kept = this.context.serializeMemory()[ npcId ]?.turns ?? [];
		return [ ...kept, ...prior ].map( ( { speaker, text } ) => ( { speaker, text } ) );

	}

	/**
	 * Each of the `witnesses` overheard the player talking to `npc` and keeps
	 * it as one short note of that talk (Quests `recordOverheard`), naming the
	 * person by their name and their post or kind; kept in the game's file now.
	 */
	overhear( witnesses, npc, lines, atMin ) {

		if ( ! witnesses.length ) return;
		const role = npc.job?.role ?? npc.transitJob?.role ?? this.input.types.types?.find( ( type ) => type.type === npc.type )?.label?.toLowerCase() ?? null;
		const heard = { name: `${npc.name.given} ${npc.name.family}`, ...( role ? { role } : {} ), lines: lines.map( ( { speaker, text } ) => ( { speaker, text } ) ), atMin };
		for ( const npcId of new Set( witnesses ) ) this.context.recordOverheard( npcId, heard );
		this.#keep();

	}

	/** Stores the exchange and keeps it now; a memory fold it starts runs off the reply path and is kept once written. */
	remember( npcId, exchange ) {

		this.context.recordExchange( npcId, exchange )
			.then( () => this.#keep(), ( error ) => console.warn( 'dialog memory:', error.message ) );
		this.#keep();

	}

	/** A world built again in this one's place: it writes the memory file no more. */
	retire() {

		this.#file = null;

	}

	#join( memory ) {

		const people = new Map( this.memory().map( ( record ) => [ record.npcId, record ] ) );
		for ( const record of memory ) if ( ! people.has( record.npcId ) ) people.set( record.npcId, record );
		this.context.restoreMemory( Object.fromEntries( bounded( [ ...people.values() ] ).map( ( { npcId, memory: kept } ) => [ npcId, kept ] ) ) );

	}

	/** Takes back what the game's file kept; a file it cannot read leaves the save's memory to join an empty one. */
	#recall( memory ) {

		try {

			this.#join( memory );
			this.#written = fileText( this.memory() );

		} catch ( error ) {

			console.warn( 'dialog memory file not read:', error.message );

		}

	}

	/** Writes a game's memory whole over its file when it changed; a world kept for the session writes nothing. */
	#keep() {

		if ( ! this.#file ) return;
		const text = fileText( this.memory() );
		if ( text === this.#written ) return;
		try {

			replaceFile( this.#file, text );
			this.#written = text;

		} catch ( error ) {

			console.warn( 'dialog memory not kept:', error.message );

		}

	}

}

/**
 * The people spoken with last and each one's newest notes and turns, sorted
 * by npcId; nobody who remembers nothing. Turns a failed fold left stay
 * verbatim, so the turns are bounded too.
 */
function bounded( records ) {

	return records.filter( ( { memory } ) => memory.digest.length || memory.turns.length )
		.sort( ( a, b ) => lastAt( b ) - lastAt( a ) || a.npcId.localeCompare( b.npcId ) )
		.slice( 0, MEMORY_PEOPLE )
		.map( ( { npcId, memory } ) => ( { npcId, memory: {
			digest: memory.digest.slice( - MEMORY_NOTES ), turns: memory.turns.slice( - MEMORY_TURNS ),
			...( Number.isFinite( memory.heardAtMin ) ? { heardAtMin: memory.heardAtMin } : {} )
		} } ) )
		.sort( ( a, b ) => a.npcId.localeCompare( b.npcId ) );

}

const fileText = ( memory ) => `${JSON.stringify( memory )}\n`;

/** The minute of a person's latest remembered turn, or of the last talk they overheard. */
function lastAt( { memory } ) {

	return Math.max( memory.turns.at( - 1 )?.atMin ?? - Infinity, memory.heardAtMin ?? - Infinity );

}

function readJson( path, fallback ) {

	return readFile( path, 'utf8' ).then( JSON.parse, () => fallback );

}
