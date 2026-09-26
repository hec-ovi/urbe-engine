import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DEFAULT_TYPE_SET } from '../../../simulation/dist/index.js';
import { TalkService } from './TalkService.js';

const blueprint = {
	meta: { seed: 7 },
	districts: [ { id: 'd1', name: 'Old Port', kind: 'residential', tier: 'poor' } ],
	parcels: [ { id: 'p1', districtId: 'd1', type: 'bar', name: 'The Rusty Anchor' } ]
};

const questline = {
	id: 'q1', title: 'Static', premise: 'A word at the bar.',
	roles: [ { roleId: 'barista', npcType: 'barista', persona: 'Tired, watchful.' } ],
	items: [], facts: [], acts: [ { actId: 'a1', title: 'The Word', summary: 'Listen.' } ],
	steps: [ {
		stepId: 's_talk', actId: 'a1',
		narrative: { description: 'The barista wants the player to carry a message.', playerHint: 'Talk to her.', stake: 'Without it the debt lands on her.' },
		wantedByRoleId: 'barista', target: { kind: 'talk', roleId: 'barista' },
		gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel', endingId: 'e_done'
	} ],
	endings: [ { endingId: 'e_done', title: 'Carried', epilogue: 'The message went.' } ],
	flags: [], entryStepIds: [ 's_talk' ]
};
const quests = [ { id: 'q1', cast: { barista: 'n1' }, state: { activeStepIds: [ 's_talk' ], completedStepIds: [], flags: [] } } ];

const npc = {
	npcId: 'n1', type: DEFAULT_TYPE_SET.types[ 0 ].type, gender: 'female', age: 42, traits: [ 'dependable' ],
	name: { given: 'Mara', family: 'Voss' }, home: { parcelId: 'p1', unit: 2 },
	family: [], routine: [], flags: { dead: false, custom: [] }
};
const behavior = { mode: 'interior', activity: 'working', place: { kind: 'parcel', id: 'p1' }, interrupted: true };

/** A world directory under a served root: no naming meta and no npc-types.json, so the fallbacks carry it. */
async function servedWorld( files = {} ) {

	const root = await mkdtemp( join( tmpdir(), 'talk-' ) );
	const dir = join( root, 'out', 'w' );
	await write( dir, { 'blueprint.json': blueprint, 'quests/questlines.json': [ questline ], ...files } );
	return { root: root + sep, dir };

}

async function write( dir, files ) {

	for ( const [ name, value ] of Object.entries( files ) ) {

		await mkdir( join( dir, name, '..' ), { recursive: true } );
		await writeFile( join( dir, name ), JSON.stringify( value ) );

	}

}

/**
 * A model at the port: each request takes the next script, a list of choice
 * deltas, or an Error thrown after the deltas before it.
 */
function fakeModel( ...scripts ) {

	const seen = [];
	return {
		seen,
		/** The system prompt of request `i`. */
		system: ( i ) => seen[ i ].messages[ 0 ].content,
		async complete() { return 'A note.'; },
		async *stream( chat ) {

			seen.push( chat );
			for ( const step of scripts.shift() ?? [ { content: 'Hm.' } ] ) {

				if ( step instanceof Error ) throw step;
				yield step;

			}

		}
	};

}

const say = ( service, line, extra = {} ) => service.reply( { out: '/out/w', npc, behavior, line, timeMin: 600, ...extra } );

async function events( iterable ) {

	const all = [];
	for await ( const event of iterable ) all.push( event );
	return all;

}

describe( 'TalkService', () => {

	it( 'answers from the NPC layers, remembers each completed exchange, and refuses the dead and paths outside the served worlds', async () => {

		const model = fakeModel( [ { content: ' Ask at the bar. ' } ] );
		const service = new TalkService( model, ( await servedWorld() ).root );

		expect( await say( service, 'Where is the lift?' ) ).toBe( 'Ask at the bar.' );
		expect( model.system( 0 ) ).toContain( 'You are Mara Voss' );
		expect( model.system( 0 ) ).toContain( 'The Rusty Anchor in Old Port' );
		expect( model.seen[ 0 ].messages[ 1 ].content ).toContain( '"Where is the lift?"' );

		await say( service, 'Thanks.' );
		expect( model.system( 1 ) ).toContain( 'Where is the lift?' );
		expect( model.system( 1 ) ).toContain( 'Ask at the bar.' );

		await say( service, 'What do you need?', { quests } );
		expect( model.system( 2 ) ).toContain( 'Without it the debt lands on her.' );
		expect( model.system( 2 ) ).toContain( 'Tired, watchful.' );

		await expect( say( service, 'Hey', { npc: { ...npc, flags: { dead: true, custom: [] } } } ) ).rejects.toThrow( /is dead/ );
		await expect( say( service, 'Hey', { out: '/../etc' } ) ).rejects.toThrow( /outside/ );
		await expect( say( service, 'Hey', { out: '/out/../src' } ) ).rejects.toThrow( /outside/ );

	} );

	it( 'streams text, whole sentences and offers without model markup, then the reply', async () => {

		const model = fakeModel( [
			{ content: '<think>She should stall.</think>Ask at' }, { content: ' the bar. Then' },
			{ content: ' go.', tool_calls: [ { index: 0, id: 'c1', function: { name: 'follow_player', arguments: '{}' } } ] }
		] );
		const service = new TalkService( model, ( await servedWorld() ).root );
		const all = await events( service.stream( { out: '/out/w', npc, behavior, line: 'Help me.', timeMin: 600, offers: { follow: true } } ) );

		expect( all.filter( ( e ) => e.type === 'delta' ).map( ( e ) => e.text ).join( '' ) ).toBe( 'Ask at the bar. Then go.' );
		expect( all.filter( ( e ) => e.type !== 'delta' ) ).toEqual( [
			{ type: 'sentence', index: 0, text: 'Ask at the bar.' },
			{ type: 'sentence', index: 1, text: 'Then go.' },
			{ type: 'offer', kind: 'follow' },
			{ type: 'done', reply: 'Ask at the bar. Then go.' }
		] );
		expect( model.seen[ 0 ].tools.map( ( tool ) => tool.function.name ) ).toEqual( [ 'follow_player' ] );

	} );

	it( 'remembers nothing of a reply that failed', async () => {

		const model = fakeModel( [ { content: 'Ask' }, new Error( 'model stream ended before [DONE]' ) ], [ { content: 'Yes?' } ] );
		const service = new TalkService( model, ( await servedWorld() ).root );

		await expect( say( service, 'Where is the lift?' ) ).rejects.toThrow( 'model stream ended before [DONE]' );
		await say( service, 'Hello?' );
		await say( service, 'Still there?' );
		expect( model.system( 2 ) ).toContain( 'Hello?' );
		expect( model.system( 2 ) ).not.toContain( 'Where is the lift?' );

	} );

	it( 'builds a world again when its files change or its directory is made again', async () => {

		const model = fakeModel();
		const { root, dir } = await servedWorld();
		const service = new TalkService( model, root );

		await say( service, 'First visit.' );
		await say( service, 'Again.' );
		expect( model.system( 1 ) ).toContain( 'First visit.' );

		await write( dir, { 'blueprint.json': { ...blueprint, districts: [ { ...blueprint.districts[ 0 ], name: 'New Harbor' } ] } } );
		await say( service, 'Rebuilt?' );
		expect( model.system( 2 ) ).toContain( 'New Harbor' );
		expect( model.system( 2 ) ).not.toContain( 'Old Port' );
		expect( model.system( 2 ) ).not.toContain( 'First visit.' );

		await say( service, 'Once more.' );
		expect( model.system( 3 ) ).toContain( 'Rebuilt?' );
		await rm( dir, { recursive: true } );
		await write( dir, { 'blueprint.json': blueprint, 'quests/questlines.json': [ questline ] } );
		await say( service, 'New game.' );
		expect( model.system( 4 ) ).not.toContain( 'Rebuilt?' );
		expect( model.system( 4 ) ).toContain( 'Old Port' );

	} );

	it( 'holds exactly the questlines the request carries and keeps memory when one leaves', async () => {

		const model = fakeModel();
		const service = new TalkService( model, ( await servedWorld() ).root );

		await say( service, 'What do you need?', { quests } );
		expect( model.system( 0 ) ).toContain( 'Tired, watchful.' );
		await say( service, 'Just passing.' );
		expect( model.system( 1 ) ).not.toContain( 'Tired, watchful.' );
		expect( model.system( 1 ) ).toContain( 'What do you need?' );

	} );

	it( 'gives a save what people remember, bounded, and takes a save\'s memory back as all they remember', async () => {

		const model = fakeModel();
		const service = new TalkService( model, ( await servedWorld() ).root );

		await say( service, 'Where is the lift?' );
		expect( await service.memory( '/out/w' ) ).toEqual( [ { npcId: 'n1', memory: { digest: [], turns: [
			{ speaker: 'player', text: 'Where is the lift?', atMin: 600 }, { speaker: 'npc', text: 'Hm.', atMin: 600 }
		] } } ] );

		const notes = Array.from( { length: 30 }, ( _, at ) => `note ${at}` );
		const person = ( npcId, atMin ) => ( { npcId, memory: { digest: notes, turns: [ { speaker: 'npc', text: 'Hi.', atMin } ] } } );
		const crowd = Array.from( { length: 201 }, ( _, at ) => person( `p${String( at ).padStart( 3, '0' )}`, at ) );
		await service.restoreMemory( '/out/w', [ ...crowd, { npcId: 'n1', memory: { digest: [ 'Told of a debt.' ], turns: [] } }, { npcId: 'silent', memory: { digest: [], turns: [] } } ] );
		const kept = await service.memory( '/out/w' );
		expect( kept ).toHaveLength( 200 );
		expect( kept.map( ( record ) => record.npcId ) ).toEqual( crowd.slice( 1 ).map( ( record ) => record.npcId ) );
		expect( kept[ 0 ].memory.digest ).toEqual( notes.slice( 6 ) );

		await service.restoreMemory( '/out/w', [ { npcId: 'n1', memory: { digest: [ 'Told of a debt.' ], turns: [] } } ] );
		await say( service, 'Remember me?' );
		expect( model.system( 1 ) ).toContain( 'Told of a debt.' );
		expect( model.system( 1 ) ).not.toContain( 'Where is the lift?' );

	} );

	it( 'grounds an unnamed world in its game theme and describes places without ids', async () => {

		const model = fakeModel();
		const unnamed = {
			meta: { seed: 7 },
			districts: [ { id: 'd0', kind: 'industrial', tier: 'poor' } ],
			parcels: [ { id: 'p1', districtId: 'd0', type: 'bar' } ]
		};
		const service = new TalkService( model, ( await servedWorld( { 'blueprint.json': unnamed, 'game.json': { theme: 'cyberpunk' } } ) ).root );

		await say( service, 'Where am I?' );
		expect( model.system( 0 ) ).toContain( 'cyberpunk' );
		expect( model.system( 0 ) ).toContain( 'a poor industrial district' );
		expect( model.system( 0 ) ).not.toMatch( /\b(d0|p1)\b/ );

	} );

} );
