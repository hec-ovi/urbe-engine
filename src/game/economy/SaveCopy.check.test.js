import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import AjvModule from 'ajv/dist/2020.js';
import { Economy } from './Economy.js';
import { paydaysBy } from './Wallet.js';
import { QuestSession } from '../quests/QuestSession.js';
import { GamePersistence, mergeInventory, saveItemId } from '../persistence/GamePersistence.js';
import { SchemaBoundary } from '../persistence/SchemaBoundary.js';
import { PlayerItems } from '../access/PlayerItems.js';
import { LauncherService } from '../../server/LauncherService.js';
import { DESCRIPTOR_SCHEMAS } from '../../library/src/DescriptorSchemas.js';
import persistenceValues from '../persistence/schema/values.schema.json' with { type: 'json' };
import saveCurrentPayload from '../persistence/schema/save-current-payload.schema.json' with { type: 'json' };

const Ajv2020 = AjvModule.default ?? AjvModule;
/**
 * A copy of a played game's save and story (out/ is not kept in the
 * repository; the game's own folder is never touched): `mkdir -p
 * out/test-copies && cp out/games/klamm/game.json
 * out/test-copies/klamm-game.json && cp out/games/klamm/quests/questlines.json
 * out/test-copies/klamm-questlines.json`. Without it the check is skipped.
 */
const COPY = new URL( '../../../out/test-copies/klamm-game.json', import.meta.url );
const STORY = new URL( '../../../out/test-copies/klamm-questlines.json', import.meta.url );
const present = existsSync( COPY ) && existsSync( STORY );

describe.skipIf( ! present )( 'a played save made before credits, on a copy', () => {

	const game = present ? JSON.parse( readFileSync( COPY, 'utf8' ) ) : null;
	const questlines = present ? JSON.parse( readFileSync( STORY, 'utf8' ) ) : [];

	/** The stories as the save has them, with what each step owes read from the real definitions. */
	function session() {

		const progress = new Map( [ ...game.quests, ...game.sideJobs ].map( ( entry ) => [ entry.id, entry ] ) );
		return new QuestSession( questlines.map( ( definition, index ) => {

			const saved = progress.get( definition.id );
			return {
				definition, side: index > 0,
				runtime: { serialize: () => saved.runtime.state, status: () => saved.state === 'completed' ? 'completed' : 'active', cast: saved.runtime.cast }
			};

		} ), null );

	}

	it( 'loads through the real persistence boundary as it is', () => {

		expect( () => new SchemaBoundary().assert( 'game-state', structuredClone( game ), 'E_GAME_STATE', 'game' ) ).not.toThrow();
		expect( game ).not.toHaveProperty( 'economy' );
		expect( new GamePersistence( { game: structuredClone( game ), gameId: game.id, fetcher: () => null } ).game.id ).toBe( game.id );

	} );

	it( 'starts with 40 cr, owes no pay for the weeks gone by and counts the shift already worked as paid', () => {

		const timeMin = game.npcState.timeMin;
		const completedSettled = session().settlements().map( ( due ) => due.key );
		expect( completedSettled ).toContain( 'shift:main/s_sort' );
		const economy = Economy.restore( game.economy, { timeMin, completedSettled, base: () => null, items: new PlayerItems(), now: () => timeMin } );
		expect( economy.wallet.credits ).toBe( 40 );
		expect( economy.wallet.paidWeek ).toBe( paydaysBy( timeMin ) );
		expect( economy.wallet.payday( timeMin ) ).toBeNull();
		expect( economy.owe( { kind: 'shift', key: 'shift:main/s_sort' } ) ).toBeNull();
		expect( economy.wallet.credits ).toBe( 40 );

	} );

	it( 'saves with the clerk\'s card picked up and the economy through the browser and the launcher, which an older launcher would refuse', async () => {

		const timeMin = game.npcState.timeMin;
		const economy = Economy.restore( undefined, {
			timeMin, completedSettled: session().settlements().map( ( due ) => due.key ), base: () => null, items: new PlayerItems(), now: () => timeMin
		} );
		const card = questlines[ 0 ].items.find( ( item ) => item.itemId === 'ACCESS_CARD_CLERK' );
		const held = [ { id: card.itemId, name: card.name, quantity: 1, state: { kind: card.kind, description: card.description, questlineIds: [ 'main' ] } } ];
		const inventory = mergeInventory( game.player.inventory, held, questlines.flatMap( ( questline ) => questline.items.map( ( item ) => item.itemId ) ) );
		expect( inventory.map( ( item ) => item.id ) ).toEqual( [ 'access_card_clerk' ] );
		expect( saveItemId( 'DRINK_WHISKY_KESSEL' ) ).toBe( 'drink_whisky_kessel' );
		const live = {
			position: game.player.position, heading: game.player.heading, inventory, quests: game.quests, sideJobs: game.sideJobs,
			currentLocation: game.currentLocation, discoveredLocations: game.discoveredLocations, npcState: game.npcState,
			contacts: game.contacts, access: game.access, economy: economy.serialize(), elapsedSeconds: 12
		};
		let payload = null;
		const fetcher = async ( url, options ) => {

			payload = JSON.parse( options.body ).input;
			return { ok: true, status: 200, json: async () => ( {
				...game, player: payload.player, quests: payload.quests, sideJobs: payload.sideJobs, currentLocation: payload.currentLocation,
				discoveredLocations: payload.discoveredLocations, economy: payload.economy,
				save: { ...game.save, revision: payload.expectedRevision + 1, updatedAt: payload.updatedAt, playTimeSeconds: payload.playTimeSeconds }
			} ) };

		};
		const persistence = new GamePersistence( { game: structuredClone( game ), gameId: game.id, fetcher } );
		const saved = await persistence.save( live );
		expect( payload.player.inventory[ 0 ] ).toMatchObject( { id: 'access_card_clerk', state: { itemId: 'ACCESS_CARD_CLERK' } } );
		expect( payload.economy ).toEqual( { credits: 40, paidWeek: paydaysBy( timeMin ), settled: [ 'shift:main/s_sort' ], people: [], log: [] } );
		// The saved game is a game the library loads again.
		expect( () => new SchemaBoundary().assert( 'game-state', saved, 'E_GAME_STATE', 'game' ) ).not.toThrow();

		// The launcher this build serves takes it; one from before credits would refuse the field, so a page sends it only once asked.
		const launcher = new LauncherService( { outDir: tmpdir() } );
		expect( launcher.validateSaveCurrent( payload ), JSON.stringify( launcher.validateSaveCurrent.errors ) ).toBe( true );
		expect( launcher.abilities().saveFields ).toContain( 'economy' );
		const older = structuredClone( saveCurrentPayload );
		delete older.properties.economy;
		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of [ ...DESCRIPTOR_SCHEMAS, persistenceValues ] ) ajv.addSchema( schema );
		const validate = ajv.compile( older );
		expect( validate( payload ) ).toBe( false );
		expect( validate.errors.some( ( error ) => error.params?.additionalProperty === 'economy' ) ).toBe( true );

	} );

} );
