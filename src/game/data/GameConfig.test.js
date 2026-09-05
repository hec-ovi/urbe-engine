// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { GameConfig } from './GameConfig.js';
import { GameClock } from '../time/GameClock.js';
import { dayCycle } from '../time/DayCycle.js';

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

	it( 'keeps one night lighting setting while the simulation clock advances', () => {

		window.history.replaceState( {}, '', '/?mode=game&hour=12' );
		const config = GameConfig.fromUrl();
		const clock = new GameClock( { startHour: config.startHour, scale: config.timeScale } );
		expect( clock.timeMin ).toBe( 720 );
		expect( dayCycle( config.lightingHour ) ).toMatchObject( {
			state: 'night', daylight: 0, lampsOn: 1, sunLux: 0
		} );
		clock.advance( 36 * 3600 );
		expect( clock.timeMin ).toBe( 2880 );
		expect( config.lightingHour ).toBe( 21 );

	} );

	it( 'refuses a game id that could escape the game directory', () => {

		window.history.replaceState( {}, '', '/?mode=game&game=../outside' );
		expect( () => GameConfig.fromUrl() ).toThrow( 'invalid game id' );

	} );

} );
