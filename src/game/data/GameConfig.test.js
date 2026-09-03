// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { GameConfig } from './GameConfig.js';

describe( 'game URL configuration', () => {

	afterEach( () => window.history.replaceState( {}, '', '/' ) );

	it( 'binds a catalog game to its own generated directory', () => {

		window.history.replaceState( {}, '', '/?mode=game&game=night-shift&out=/out/wrong' );
		expect( GameConfig.fromUrl() ).toMatchObject( {
			gameId: 'night-shift',
			outBase: '/out/games/night-shift'
		} );

	} );

	it( 'preserves explicit city preview directories when there is no saved game', () => {

		window.history.replaceState( {}, '', '/?mode=game&out=/out/cities/small' );
		expect( GameConfig.fromUrl() ).toMatchObject( { gameId: null, outBase: '/out/cities/small' } );

	} );

	it( 'refuses a game id that could escape the game directory', () => {

		window.history.replaceState( {}, '', '/?mode=game&game=../outside' );
		expect( () => GameConfig.fromUrl() ).toThrow( 'invalid game id' );

	} );

} );
