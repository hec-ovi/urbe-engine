import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { FIXTURE_BLUEPRINT, FIXTURE_HOMES, FIXTURE_INTERIORS } from '../../../simulation/dist/index.js';
import * as dialog from '../../../quests/dist/runtime.js';
import { DialogContextService } from '../../../quests/dist/index.js';
import { SimBridge } from '../game/sim/SimBridge.js';
import { recipeFor } from '../game/agents/Appearance.js';
import { describeLook } from '../game/agents/avatar/Describe.js';
import { TalkService } from './TalkService.js';

const MON_10 = 600;

/**
 * Everything a person knows of themselves, end to end: a real simulation
 * person housed in a numbered apartment, the look the renderer draws them in,
 * where they stand and who they know, through the talk service into the
 * dialog layers, as the system prompt the model is asked with.
 */
describe( 'what a person knows of themselves in a talk', () => {

	it( 'tells them their name, age, traits, look, apartment and street, work and shift, day, hour, task and the people they know', async () => {

		const sim = housedCity();
		const npc = sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_10 } );
		const coworker = sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: 20 * 60 } );
		const look = describeLook( recipeFor( { gender: npc.gender, appearanceSeed: npc.appearanceSeed, npcId: npc.npcId } ).recipe );
		const people = dialog.peopleKnown( {
			npc, timeMin: MON_10, line: `Is ${coworker.name.given} in?`, people: [ npc, coworker ],
			behaviorAt: ( id, timeMin ) => sim.behaviorAt( id, timeMin )
		} );
		const model = fakeModel();
		const service = new TalkService( model, await servedWorld() );
		for await ( const event of service.stream( {
			out: '/out/w', npc, behavior: sim.behaviorAt( npc.npcId, MON_10 ), line: 'Who are you?', timeMin: MON_10, look, people,
			here: { x: 305, z: 254, parcelId: 'p_cafe', floor: 0, light: 'night; you are indoors' },
			task: { kind: 'leading', place: 'the clinic' }
		} ) ) if ( event.type === 'done' ) break;
		const system = model.seen[ 0 ].messages[ 0 ].content;

		const noun = npc.gender === 'female' ? 'woman' : 'man';
		expect( system ).toContain( `You are ${npc.name.given} ${npc.name.family}, a ${npc.age}-year-old ${noun}.` );
		expect( system ).toContain( `People would call you ${npc.traits.length === 2 ? npc.traits.join( ' and ' ) : npc.traits.slice( 0, - 1 ).join( ', ' ) + ' and ' + npc.traits.at( - 1 )}` );
		expect( system ).toContain( `you are ${look.height}, with ${look.build}` );
		expect( system ).toContain( `Your hair: ${look.hair}. Your skin is ${look.skin} and your eyes are ${look.eyes}.` );
		for ( const garment of look.wearing ) expect( system ).toContain( garment );
		expect( system ).toContain( `your clothes are ${look.fabric}` );
		expect( npc.home.apartment ).toBeDefined();
		const floor = [ 'ground', 'first', 'second' ][ npc.home.apartment.floor ];
		expect( system ).toContain( `You live in apartment ${npc.home.apartment.number} on the ${floor} floor of an apartment block on ` );
		expect( system ).toMatch( /You work at a coffee shop on \w+ (Street|Avenue)[^.]*, in a [a-z ]+ district as barista,/ );
		expect( system ).toContain( 'Your day today, Monday: ' );
		expect( system ).toContain( 'It is Monday 10:00; right now you are at work.' );
		expect( system ).toContain( 'You are taking them to the clinic, because they asked and you agreed.' );
		expect( system ).toMatch( /You are standing on \w+ (Street|Avenue)/ );
		expect( system ).toContain( 'You are inside a coffee shop, on the ground floor.' );
		expect( system ).toContain( 'Outside it is night; you are indoors.' );
		expect( system ).toContain( `${coworker.name.given} ${coworker.name.family} works with you.` );
		expect( system ).toMatch( /(You do not like strangers|You are wary of strangers|You take strangers as they come|You are friendly with strangers)/ );

	} );

} );

describe( 'what a person carries in a talk', () => {

	it( 'hands what they carry to the dialog layers, told in what changes every turn where the Quests build tells it', async () => {

		const sim = housedCity();
		const npc = sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_10 } );
		const carry = { credits: 23, means: 'getting-by', items: [ { name: 'a phone' }, { name: 'Beer', from: 'stranger', atMin: 590 } ] };
		const contexts = vi.spyOn( DialogContextService.prototype, 'contextFor' );
		const service = new TalkService( fakeModel(), await servedWorld() );
		for await ( const event of service.stream( {
			out: '/out/w', npc, behavior: sim.behaviorAt( npc.npcId, MON_10 ), line: 'Have you got a light?', timeMin: MON_10, carry
		} ) ) if ( event.type === 'done' ) break;
		expect( contexts.mock.calls.at( - 1 )[ 2 ] ).toMatchObject( { carry } );
		// A Quests build that tells it, tells it with the turn: never in what stays the same between turns.
		if ( dialog.DIALOG_ABILITIES?.includes( 'economy' ) ) {

			const { segments } = contexts.mock.results.at( - 1 ).value;
			expect( segments.find( ( segment ) => segment.id === 'turns' ).text ).toContain( '23 credits' );
			expect( segments.filter( ( segment ) => segment.id !== 'turns' ).some( ( segment ) => segment.text.includes( '23 credits' ) ) ).toBe( false );

		}
		contexts.mockRestore();

	} );

} );

/** The fixture city with its cafe furnished and its first apartment building opened, as Interior publishes them. */
function housedCity() {

	const { homes, ...support } = FIXTURE_HOMES.p_r0;
	const npc = { ...support, anchors: support.anchors.map( ( anchor ) => ( { ...anchor, room: `floor:${anchor.floor}/${anchor.room}` } ) ) };
	const units = ( floor ) => homes.filter( ( home ) => home.floor === floor ).map( ( home ) => home.id.split( '/' )[ 1 ] );
	const interior = {
		building: { floors: [ 0, 1, 2 ].map( ( index ) => ( {
			index, layout: `l${index}`, elevation: index * 4.5,
			apartmentEntrances: units( index ).map( ( unit ) => ( { unit, number: homes.find( ( home ) => home.id === `floor:${index}/${unit}` ).number, position: [ 0, 0 ] } ) )
		} ) ) },
		layouts: Object.fromEntries( [ 0, 1, 2 ].map( ( index ) => [ `l${index}`, { floor: { rooms: units( index ).flatMap( ( unit ) =>
			[ 'living', 'bedroom', 'bath' ].map( ( room ) => ( { id: `${unit}-${room}`, unit } ) ) ) } } ] ) )
	};
	const buildings = new Map( [ ...Object.entries( FIXTURE_INTERIORS ).map( ( [ id, support ] ) => [ id, { npc: support } ] ), [ 'p_r0', { npc, interior } ] ] );
	return SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );

}

/** The fixture blueprint served as a world, its parcels' footprints as their lots. */
async function servedWorld() {

	const root = await mkdtemp( join( tmpdir(), 'talk-context-' ) );
	const dir = join( root, 'out', 'w' );
	await mkdir( dir, { recursive: true } );
	const blueprint = { ...FIXTURE_BLUEPRINT, parcels: FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( { ...parcel, lot: parcel.footprint } ) ) };
	await writeFile( join( dir, 'blueprint.json' ), JSON.stringify( blueprint ) );
	return root + sep;

}

function fakeModel() {

	const seen = [];
	return {
		seen,
		async complete() { return 'A note.'; },
		async *stream( chat ) {

			seen.push( chat );
			yield { content: 'Hm.' };

		}
	};

}
