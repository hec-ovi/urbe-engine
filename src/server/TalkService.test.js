import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DEFAULT_TYPE_SET } from '../../../simulation/dist/index.js';
import { TalkService } from './TalkService.js';

/** An unnamed tiny world: no naming meta, no npc-types.json, so the fallbacks carry it. */
async function worldDir() {

	const root = await mkdtemp( join( tmpdir(), 'talk-' ) );
	await mkdir( join( root, 'out', 'w' ), { recursive: true } );
	await writeFile( join( root, 'out', 'w', 'blueprint.json' ), JSON.stringify( {
		meta: { seed: 7 },
		districts: [ { id: 'd1', name: 'Old Port' } ],
		parcels: [ { id: 'p1', districtId: 'd1', type: 'bar', name: 'The Rusty Anchor' } ]
	} ) );
	await mkdir( join( root, 'out', 'w', 'quests' ), { recursive: true } );
	await writeFile( join( root, 'out', 'w', 'quests', 'questlines.json' ), JSON.stringify( [ questline ] ) );
	return root + sep;

}

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

const npc = {
	npcId: 'n1', type: DEFAULT_TYPE_SET.types[ 0 ].type,
	name: { given: 'Mara', family: 'Voss' }, home: { parcelId: 'p1', unit: 2 },
	family: [], routine: [], flags: { dead: false }
};
const behavior = { mode: 'interior', activity: 'working', place: { kind: 'parcel', id: 'p1' }, interrupted: true };

describe( 'TalkService', () => {

	it( 'answers from the NPC layers and remembers the exchange for the next line', async () => {

		const seen = [];
		const llm = { async complete( request ) { seen.push( request ); return ' Ask at the bar. '; } };
		const service = new TalkService( llm, await worldDir() );

		const reply = await service.reply( { out: '/out/w', npc, behavior, line: 'Where is the lift?', timeMin: 600 } );
		expect( reply ).toBe( 'Ask at the bar.' );
		expect( seen[ 0 ].system ).toContain( 'You are Mara Voss.' );
		expect( seen[ 0 ].system ).toContain( 'The Rusty Anchor in Old Port' );
		expect( seen[ 0 ].prompt ).toContain( '"Where is the lift?"' );

		await service.reply( { out: '/out/w', npc, behavior, line: 'Thanks.', timeMin: 601 } );
		expect( seen[ 1 ].system ).toContain( 'Ask at the bar.' );

		const quests = [ { id: 'q1', cast: { barista: 'n1' }, state: { activeStepIds: [ 's_talk' ], completedStepIds: [], flags: [] } } ];
		await service.reply( { out: '/out/w', npc, behavior, line: 'What do you need?', timeMin: 602, quests } );
		expect( seen[ 2 ].system ).toContain( 'Without it the debt lands on her.' );
		expect( seen[ 2 ].system ).toContain( 'Tired, watchful.' );

	} );

	it( 'refuses the dead and paths outside the served worlds', async () => {

		const service = new TalkService( { async complete() { return ''; } }, await worldDir() );
		await expect( service.reply( { out: '/out/w', npc: { ...npc, flags: { dead: true } }, behavior, line: 'Hey', timeMin: 0 } ) ).rejects.toThrow( /is dead/ );
		await expect( service.reply( { out: '/../etc', npc, behavior, line: 'Hey', timeMin: 0 } ) ).rejects.toThrow( /outside/ );

	} );

} );
