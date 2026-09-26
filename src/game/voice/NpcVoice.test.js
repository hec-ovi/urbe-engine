import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpcVoice, pieces } from './NpcVoice.js';
import { VoicePlayer } from './VoicePlayer.js';
import { FakeAudioContext, wav } from './voice.test-fixtures.js';

const MARA = {
	npcId: 'npc.mara', name: { given: 'Mara', family: 'Voss' }, gender: 'female', age: 42,
	traits: [ 'ambitious', 'gruff' ], type: 'barista', appearanceSeed: 7, routine: []
};
const SPEAKER = {
	id: 'npc.mara', gender: 'female', age: 42, traits: [ 'ambitious', 'gruff' ],
	category: 'vendor', label: 'Barista', persona: 'Runs the docks with a hard hand.'
};
const conversation = ( instance = MARA ) => ( { npcId: instance?.npcId, instance } );
const upstreamFailure = () => Object.assign( new Error( 'voice 502 E_UPSTREAM: maya1 is down' ), { status: 502, code: 'E_UPSTREAM' } );
/** Half a second of Voice audio. */
const HALF_SECOND = new Array( 12000 ).fill( 1000 );

const flush = async () => {

	for ( let i = 0; i < 8; i ++ ) await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

};

/** A Voice route that answers each line when the test says, as a whole WAV or one that breaks off after its first bytes. */
function fakeClient( status = 'ok' ) {

	const client = {
		status, lines: [], prefetched: [],
		capability: vi.fn( async () => ( { enabled: client.status === 'ok', status: client.status } ) ),
		speak: vi.fn( ( line, { signal } ) => new Promise( ( resolve, reject ) => {

			const request = { line, signal, resolve, reject };
			signal.addEventListener( 'abort', () => reject( new DOMException( 'aborted', 'AbortError' ) ) );
			client.lines.push( request );

		} ) ),
		prefetch: vi.fn( async ( group, items ) => { client.prefetched.push( { group, items } ); } ),
		cancel: vi.fn( async () => {} )
	};
	return client;

}

/** Answers a line with its first bytes, then, once `rest` resolves, the rest of a whole WAV or a break. */
function answer( request, { breaks = false, rest } = {} ) {

	const bytes = wav( HALF_SECOND );
	let sent = 0;
	request.resolve( new Response( new ReadableStream( { async pull( controller ) {

		if ( sent ++ === 0 ) return controller.enqueue( bytes.subarray( 0, 10044 ) );
		await rest;
		if ( breaks ) controller.error( new TypeError( 'terminated' ) );
		else {

			controller.enqueue( bytes.subarray( 10044 ) );
			controller.close();

		}

	} } ) ) );

}

/** A player on fake audio contexts; `contexts` lists each one it made. */
function fakePlayer( clock = { ms: 0 } ) {

	const contexts = [];
	const player = new VoicePlayer( {
		AudioContextClass: class { constructor() { contexts.push( new FakeAudioContext() ); return contexts.at( - 1 ); } },
		now: () => clock.ms
	} );
	return { player, contexts };

}

function rig( { client = fakeClient(), enabled = true } = {} ) {

	const clock = { ms: 0 };
	const { player, contexts } = fakePlayer( clock );
	const dialog = { setSpeaking: vi.fn() };
	const hold = vi.fn();
	const voice = new NpcVoice( {
		dialog, hold, enabled, client, player, now: () => clock.ms,
		types: [ { type: 'barista', category: 'vendor', label: 'Barista' } ],
		persona: ( npcId ) => npcId === 'npc.mara' ? SPEAKER.persona : null
	} );
	const marks = () => dialog.setSpeaking.mock.calls.map( ( [ line, state ] ) => `${line.id} ${state}` );
	return { voice, client, dialog, hold, clock, marks, context: () => contexts[ 0 ] };

}

describe( 'NpcVoice', () => {

	beforeEach( () => vi.spyOn( console, 'warn' ).mockImplementation( () => {} ) );
	afterEach( () => vi.restoreAllMocks() );

	it( 'speaks each line in the person\'s voice in order, one download and one voice at a time, marking each line as it goes', async () => {

		const { voice, client, hold, marks, context } = rig();
		voice.said( { conversation: conversation(), line: { id: 'a' }, text: '[sigh] Hello there.' } );
		voice.said( { conversation: conversation(), line: { id: 'b' }, text: 'Second.' } );
		await flush();
		expect( client.lines.map( ( request ) => request.line ) ).toEqual( [ { text: '[sigh] Hello there.', speaker: SPEAKER } ] );
		expect( marks() ).toEqual( [ 'a pending', 'b pending' ] );

		answer( client.lines[ 0 ] );
		await flush();
		expect( marks() ).toEqual( [ 'a pending', 'b pending', 'a playing' ] );
		expect( hold ).toHaveBeenCalledWith( conversation(), expect.closeTo( 0.55 ) );
		expect( client.lines ).toHaveLength( 2 );
		answer( client.lines[ 1 ] );
		await flush();
		expect( context().sources ).toHaveLength( 1 );

		context().advance( 0.6 );
		await flush();
		expect( marks().slice( 3 ) ).toEqual( [ 'a idle', 'b playing' ] );
		context().advance( 0.6 );
		await flush();
		expect( marks().at( -1 ) ).toBe( 'b idle' );
		expect( voice.report() ).toMatchObject( { status: 'ok', requested: 2, started: 2, played: 2, bytes: 2 * ( 44 + 24000 ), failed: 0, queued: 0 } );

	} );

	it( 'leaves a passer-by, a person without age, a line of cues alone and everyone while voice is off unvoiced', async () => {

		const { voice, client, dialog } = rig();
		voice.said( { conversation: conversation( null ), line: { id: 'a' }, text: 'Sorry, I can\'t stop.' } );
		voice.said( { conversation: conversation( { ...MARA, age: undefined } ), line: { id: 'b' }, text: 'Hello.' } );
		voice.said( { conversation: conversation(), line: { id: 'd' }, text: '[sigh] ... [laugh]' } );
		voice.setEnabled( false );
		voice.said( { conversation: conversation(), line: { id: 'c' }, text: 'Hello.' } );
		await flush();
		expect( client.capability ).not.toHaveBeenCalled();
		expect( dialog.setSpeaking ).not.toHaveBeenCalled();

	} );

	it( 'stops the voice and the download and drops the queue when silenced', async () => {

		const { voice, client, marks, context } = rig();
		voice.said( { conversation: conversation(), line: { id: 'a' }, text: 'First.' } );
		voice.said( { conversation: conversation(), line: { id: 'b' }, text: 'Second.' } );
		await flush();
		voice.silenced();
		await flush();
		expect( client.lines[ 0 ].signal.aborted ).toBe( true );
		expect( client.lines ).toHaveLength( 1 );
		expect( marks() ).toEqual( [ 'a pending', 'b pending', 'a idle', 'b idle' ] );
		expect( voice.report() ).toMatchObject( { failed: 0, played: 0, queued: 0 } );

		voice.said( { conversation: conversation(), line: { id: 'c' }, text: 'Third.' } );
		await flush();
		answer( client.lines[ 1 ] );
		await flush();
		expect( marks().at( -1 ) ).toBe( 'c playing' );
		voice.silenced();
		expect( context().sources[ 0 ].stop ).toHaveBeenCalledOnce();
		await flush();
		expect( voice.report() ).toMatchObject( { started: 1, played: 0 } );

	} );

	it( 'stays silent while Voice is unavailable and asks again only after a while', async () => {

		const client = fakeClient( 'off' );
		const { voice, clock } = rig( { client } );
		voice.said( { conversation: conversation(), line: { id: 'a' }, text: 'Hello.' } );
		await flush();
		voice.said( { conversation: conversation(), line: { id: 'b' }, text: 'Hello again.' } );
		await flush();
		expect( client.capability ).toHaveBeenCalledOnce();
		expect( client.speak ).not.toHaveBeenCalled();

		client.status = 'ok';
		clock.ms = 30000;
		voice.said( { conversation: conversation(), line: { id: 'c' }, text: 'Hello.' } );
		await flush();
		expect( client.lines ).toHaveLength( 1 );
		client.lines[ 0 ].reject( Object.assign( new Error( 'voice service unreachable' ), { status: 503, code: 'E_UNAVAILABLE' } ) );
		await flush();
		expect( voice.report() ).toMatchObject( { status: 'unreachable', failed: 1, error: 'voice service unreachable' } );
		expect( console.warn ).toHaveBeenCalledWith( 'voice:', 'voice service unreachable' );
		voice.said( { conversation: conversation(), line: { id: 'd' }, text: 'Hello.' } );
		await flush();
		expect( client.speak ).toHaveBeenCalledOnce();

	} );

	it( 'rests Voice like a 503 once two lines in a row fail with 502', async () => {

		const { voice, client, clock } = rig();
		const say = async ( id ) => {

			voice.said( { conversation: conversation(), line: { id }, text: `Line ${id}.` } );
			await flush();

		};
		await say( 'a' );
		client.lines[ 0 ].reject( upstreamFailure() );
		await say( 'b' );
		answer( client.lines[ 1 ] );
		await say( 'c' );
		client.lines[ 2 ].reject( upstreamFailure() );
		await say( 'd' );
		expect( client.lines ).toHaveLength( 4 );
		client.lines[ 3 ].reject( upstreamFailure() );
		await say( 'e' );
		expect( client.speak ).toHaveBeenCalledTimes( 4 );
		expect( voice.report() ).toMatchObject( { status: 'degraded', failed: 3 } );

		clock.ms = 30000;
		await say( 'f' );
		expect( client.capability ).toHaveBeenCalledTimes( 2 );
		expect( client.speak ).toHaveBeenCalledTimes( 5 );

	} );

	it( 'replays a line heard whole from the session cache and asks again for one that broke off, playing what came', async () => {

		const { voice, client, marks, context } = rig();
		const say = async ( id, text ) => {

			voice.said( { conversation: conversation(), line: { id }, text } );
			await flush();

		};
		await say( 'a', 'Whole.' );
		answer( client.lines[ 0 ] );
		await flush();
		context().advance( 1 );
		await say( 'b', 'Whole.' );
		expect( client.lines ).toHaveLength( 1 );
		expect( marks() ).toContain( 'b playing' );
		context().advance( 1 );

		await say( 'c', 'Broken.' );
		answer( client.lines[ 1 ], { breaks: true } );
		await flush();
		expect( marks() ).toContain( 'c playing' );
		context().advance( 1 );
		await say( 'd', 'Broken.' );
		expect( client.lines ).toHaveLength( 3 );
		expect( voice.report() ).toMatchObject( { started: 3, played: 2, cached: 1, failed: 1, error: 'terminated' } );

	} );

	it( 'renders the lines the player may hear next ahead, except those already heard, in one replacing group', async () => {

		const { voice, client } = rig();
		voice.said( { conversation: conversation(), line: { id: 'a' }, text: 'Heard.' } );
		await flush();
		answer( client.lines[ 0 ] );
		await flush();
		const texts = [ 'Heard.', ...Array.from( { length: 9 }, ( _, i ) => `Reply ${i}.` ) ];
		await voice.upcoming( { conversation: conversation(), texts } );
		await voice.upcoming( { conversation: conversation( null ), texts } );
		expect( client.prefetched ).toHaveLength( 1 );
		const [ { group, items } ] = client.prefetched;
		expect( group ).toBe( voice.group );
		expect( items ).toHaveLength( 8 );
		expect( items[ 0 ] ).toEqual( { text: 'Reply 0.', speaker: SPEAKER } );

	} );

	it( 'sends the lines the player may hear next only once the lines said before them have loaded, and drops them once silenced', async () => {

		const { voice, client } = rig();
		voice.said( { conversation: conversation(), line: { id: 'a' }, text: 'Opening.' } );
		voice.upcoming( { conversation: conversation(), texts: [ 'Reply A.', 'Reply B.' ] } );
		await flush();
		expect( client.speak ).toHaveBeenCalledOnce();
		expect( client.prefetch ).not.toHaveBeenCalled();
		answer( client.lines[ 0 ] );
		await flush();
		expect( client.prefetched ).toEqual( [ { group: voice.group, items: [ { text: 'Reply A.', speaker: SPEAKER }, { text: 'Reply B.', speaker: SPEAKER } ] } ] );

		voice.said( { conversation: conversation(), line: { id: 'b' }, text: 'Another topic.' } );
		voice.upcoming( { conversation: conversation(), texts: [ 'Reply C.' ] } );
		await flush();
		voice.silenced();
		await flush();
		expect( client.prefetch ).toHaveBeenCalledOnce();

	} );

	it( 'cancels the group at Voice once silenced after a batch went out, after Voice has it, once', async () => {

		const { voice, client } = rig();
		let queued;
		client.prefetch.mockImplementationOnce( () => new Promise( ( resolve ) => queued = resolve ) );
		voice.silenced();
		await voice.upcoming( { conversation: conversation(), texts: [ 'Reply A.' ] } );
		voice.silenced();
		voice.silenced();
		await flush();
		expect( client.prefetch ).toHaveBeenCalledOnce();
		expect( client.cancel ).not.toHaveBeenCalled();
		queued();
		await flush();
		expect( client.cancel ).toHaveBeenCalledExactlyOnceWith( voice.group );

		await voice.upcoming( { conversation: conversation(), texts: [ 'Reply B.' ] } );
		voice.setEnabled( false );
		await flush();
		expect( client.cancel ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'cancels the group only once the lines said along with the silence reach Voice, so a chosen reply rendered ahead goes on', async () => {

		const { voice, client } = rig();
		const say = ( id, text ) => voice.said( { conversation: conversation(), line: { id }, text } );
		say( 'a', 'Opening.' );
		voice.upcoming( { conversation: conversation(), texts: [ 'Reply A.', 'Reply B.' ] } );
		await flush();
		answer( client.lines[ 0 ] );
		await flush();
		expect( client.prefetch ).toHaveBeenCalledOnce();

		voice.silenced();
		say( 'b', 'Reply A.' );
		await flush();
		expect( client.lines.map( ( request ) => request.line.text ) ).toEqual( [ 'Opening.', 'Reply A.' ] );
		expect( client.cancel ).not.toHaveBeenCalled();
		let arrive;
		answer( client.lines[ 1 ], { rest: new Promise( ( resolve ) => arrive = resolve ) } );
		await flush();
		expect( client.cancel ).toHaveBeenCalledExactlyOnceWith( voice.group );
		arrive();

		await voice.upcoming( { conversation: conversation(), texts: [ 'Reply C.' ] } );
		voice.silenced();
		say( 'c', 'Reply C.' );
		await flush();
		expect( client.cancel ).toHaveBeenCalledOnce();
		voice.silenced();
		await flush();
		expect( client.cancel ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'as the game\'s voice, types speakers by the world\'s set or Simulation\'s default, casts personas from the quests and unlocks audio only while on', async () => {

		const client = fakeClient();
		const { player, contexts } = fakePlayer();
		const quests = { persona: ( npcId ) => npcId === 'npc.mara' ? SPEAKER.persona : null };
		const animations = { holdDialogueTurn: vi.fn() };
		const target = new EventTarget();
		const dialog = { setSpeaking: vi.fn() };
		const voice = NpcVoice.forGame( { npcTypes: null, quests, animations, target, dialog, client, player, enabled: false } );
		target.dispatchEvent( new Event( 'keydown' ) );
		expect( contexts ).toHaveLength( 0 );
		voice.setEnabled( true );
		target.dispatchEvent( new Event( 'pointerdown' ) );
		expect( contexts ).toHaveLength( 1 );

		voice.said( { conversation: conversation(), line: { id: 'a' }, text: 'Hello.' } );
		await flush();
		expect( client.lines[ 0 ].line.speaker ).toEqual( SPEAKER );
		answer( client.lines[ 0 ] );
		await flush();
		expect( animations.holdDialogueTurn ).toHaveBeenCalledWith( conversation(), expect.any( Number ) );
		voice.setEnabled( false );
		await flush();
		expect( contexts[ 0 ].state ).toBe( 'suspended' );
		voice.setEnabled( true );
		await flush();
		expect( contexts[ 0 ].state ).toBe( 'running' );

		const themed = NpcVoice.forGame( {
			npcTypes: { types: [ { type: 'barista', category: 'street', label: 'Night brewer' } ] },
			quests: { persona: () => null }, animations, target, dialog, client, player
		} );
		themed.said( { conversation: conversation(), line: { id: 'b' }, text: 'Hello.' } );
		await flush();
		const { persona: _, ...uncast } = SPEAKER;
		expect( client.lines[ 1 ].line.speaker ).toStrictEqual( { ...uncast, category: 'street', label: 'Night brewer' } );

	} );

	it( 'cuts a line longer than Voice takes after a sentence, else between words', () => {

		const sentence = `${'word '.repeat( 150 ).trim()}.`;
		expect( pieces( `${sentence} ${sentence} ${sentence}` ) ).toEqual( [ sentence, sentence, sentence ] );
		const words = 'word '.repeat( 300 ).trim();
		expect( pieces( words ).map( ( piece ) => piece.length ) ).toEqual( [ 1199, 299 ] );
		expect( pieces( '  short  ' ) ).toEqual( [ 'short' ] );

	} );

} );
