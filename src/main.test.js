// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted( () => ( { starts: [], configs: [] } ) );

vi.mock( './launcher/LauncherApp.js', () => ( {
	LauncherApp: class {
		constructor( config ) { calls.configs.push( [ 'launcher', config ] ); }
		start() { calls.starts.push( 'launcher' ); }
	}
} ) );
vi.mock( './launcher/HttpLauncherApi.js', () => ( { HttpLauncherApi: class {} } ) );
vi.mock( './game/GameApp.js', () => ( {
	GameApp: class {
		static configFromUrl() { return { route: 'game' }; }
		constructor( config ) { calls.configs.push( [ 'game', config ] ); }
		start() { calls.starts.push( 'game' ); }
	}
} ) );
vi.mock( './city/CityApp.js', () => ( {
	CityApp: class {
		static configFromUrl() { return { route: 'city' }; }
		constructor( config ) { calls.configs.push( [ 'city', config ] ); }
		start() { calls.starts.push( 'city' ); }
	}
} ) );
vi.mock( './building/BuildingViewerApp.js', () => ( {
	BuildingViewerApp: class {
		static configFromUrl() { return { route: 'building' }; }
		constructor( config ) { calls.configs.push( [ 'building', config ] ); }
		start() { calls.starts.push( 'building' ); }
	}
} ) );
vi.mock( './app/App.js', () => ( {
	App: class {
		constructor( config ) { calls.configs.push( [ 'experiment', config ] ); }
		start() { calls.starts.push( 'experiment' ); }
	}
} ) );
vi.mock( './app/RunConfig.js', () => ( { RunConfig: { fromUrl: () => ( { route: 'experiment' } ) } } ) );

describe( 'browser entry route', () => {

	beforeEach( () => {

		vi.resetModules();
		calls.starts.length = 0;
		calls.configs.length = 0;

	} );

	it( 'opens the game library at the bare root', async () => {

		window.history.replaceState( {}, '', '/' );
		await import( './main.js' );

		expect( calls.starts ).toEqual( [ 'launcher' ] );
		expect( calls.configs[ 0 ][ 1 ].mount ).toBe( document.body );
		expect( calls.configs[ 0 ][ 1 ].api.constructor.name ).toBe( 'HttpLauncherApi' );

	} );

	it.each( [ 'game', 'city', 'building', 'experiment' ] )( 'keeps the %s tool on its explicit mode', async ( mode ) => {

		window.history.replaceState( {}, '', `/?mode=${ mode }` );
		await import( './main.js' );

		expect( calls.starts ).toEqual( [ mode ] );

	} );

} );
