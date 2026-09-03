import { GameView } from '../ui/views/GameView.js';
import { downloadBrowser, navigateBrowser } from './adapters.js';
import {
	catalog as validCatalog,
	cityInput,
	cityResult,
	continueResult,
	gameInput,
	gameResult,
	instancesInput,
	instancesResult,
	jsonDocument,
	questsInput,
	questsResult
} from './validate.js';

const API_METHODS = [
	'catalog', 'continueGame', 'exportGame', 'importGame', 'exportCity',
	'generateCity', 'generateInstances', 'generateQuests', 'createGame'
];

function requireApi( api ) {

	if ( ! api || typeof api !== 'object' ) throw new TypeError( 'LauncherApp requires an api object.' );
	for ( const method of API_METHODS ) {

		if ( typeof api[ method ] !== 'function' ) throw new TypeError( `Launcher api.${ method } must be a function.` );

	}
	return api;

}

function message( cause ) {

	return cause instanceof Error ? cause.message : String( cause );

}

function safeName( id, suffix ) {

	const stem = String( id ).trim().toLowerCase().replace( /[^a-z0-9._-]+/g, '-' ).replace( /^-+|-+$/g, '' ) || 'urbe';
	return `${ stem }.${ suffix }.json`;

}

/**
 * Browser launcher composition root. The view owns presentation; the injected
 * API owns files and generation. All asynchronous callbacks settle here so a
 * rejected API promise never escapes a UI event listener.
 */
export class LauncherApp {

	constructor( { mount, api, navigate = navigateBrowser, download = downloadBrowser } ) {

		if ( ! mount || typeof mount.append !== 'function' ) throw new TypeError( 'LauncherApp requires a DOM mount.' );
		if ( typeof navigate !== 'function' ) throw new TypeError( 'LauncherApp navigate adapter must be a function.' );
		if ( typeof download !== 'function' ) throw new TypeError( 'LauncherApp download adapter must be a function.' );
		this.mount = mount;
		this.api = requireApi( api );
		this.navigate = navigate;
		this.download = download;
		this.started = false;
		this.view = new GameView( {
			menu: {
				onContinue: ( id ) => void this.continueGame( id ),
				onSave: ( id ) => void this.exportGame( id ),
				onLoad: ( file ) => void this.importGame( file ),
				onExportCity: ( id ) => void this.exportCity( id ),
				onGenerateCity: ( input ) => void this.generateCity( input ),
				onGenerateInstances: ( input ) => void this.generateInstances( input ),
				onGenerateQuests: ( input ) => void this.generateQuests( input ),
				onCreateGame: ( input ) => void this.createGame( input )
			}
		} );

	}

	/** Mount immediately, then fill the already-visible catalog asynchronously. */
	async start() {

		if ( this.started ) return;
		this.started = true;
		this.view.mount( this.mount );
		this.view.ready();
		this.view.showMainMenu();
		await this.refreshCatalog();

	}

	async refreshCatalog() {

		try {

			const catalog = validCatalog( await this.api.catalog() );
			this.view.setLibrary( catalog );
			this.clearAnnouncement();
			return catalog;

		} catch ( cause ) {

			this.announce( `Could not load the world directory: ${ message( cause ) }`, true );
			return null;

		}

	}

	async continueGame( id ) {

		try {

			this.announce( 'Opening saved playthrough.' );
			const result = continueResult( await this.api.continueGame( id ) );
			this.navigate( result.playUrl );

		} catch ( cause ) {

			this.announce( `Could not continue the game: ${ message( cause ) }`, true );

		}

	}

	async exportGame( id ) {

		try {

			const payload = jsonDocument( await this.api.exportGame( id ), 'exported game' );
			const filename = safeName( id, 'urbegame' );
			this.download( filename, payload );
			this.announce( `${ filename } saved.` );

		} catch ( cause ) {

			this.announce( `Could not save the game: ${ message( cause ) }`, true );

		}

	}

	async importGame( file ) {

		try {

			if ( ! file || typeof file.text !== 'function' ) throw new TypeError( 'Choose a readable JSON game file.' );
			const payload = jsonDocument( JSON.parse( await file.text() ), 'imported game' );
			const catalog = validCatalog( await this.api.importGame( payload ) );
			this.view.setLibrary( catalog );
			this.clearAnnouncement();
			this.view.mainMenu.openLibrary( 'games' );

		} catch ( cause ) {

			this.announce( `Could not load the game file: ${ message( cause ) }`, true );

		}

	}

	async exportCity( id ) {

		try {

			const payload = jsonDocument( await this.api.exportCity( id ), 'exported city' );
			const filename = safeName( id, 'urbecity' );
			this.download( filename, payload );
			this.announce( `${ filename } saved.` );

		} catch ( cause ) {

			this.announce( `Could not export the city: ${ message( cause ) }`, true );

		}

	}

	async generateCity( input ) {

		await this.stage( 'city', () => this.api.generateCity( cityInput( input ) ), ( value ) => {

			const result = cityResult( value );
			if ( result.catalog ) this.view.setLibrary( result.catalog );
			return { city: result.city };

		} );

	}

	async generateInstances( input ) {

		await this.stage( 'instances', () => this.api.generateInstances( instancesInput( input ) ), ( value ) => {

			const result = instancesResult( value );
			return { instances: result.instances };

		} );

	}

	async generateQuests( input ) {

		await this.stage( 'quests', () => this.api.generateQuests( questsInput( input ) ), ( value ) => {

			const result = questsResult( value );
			return { quests: result.quests };

		} );

	}

	async createGame( input ) {

		const update = await this.stage( 'game', () => this.api.createGame( gameInput( input ) ), async ( value ) => {

			const result = gameResult( value );
			const catalog = result.catalog || validCatalog( await this.api.catalog() );
			this.view.setLibrary( catalog );
			this.clearAnnouncement();
			return { game: result.game };

		} );
		if ( update ) this.view.mainMenu.openLibrary( 'games' );

	}

	async stage( stage, run, apply ) {

		this.view.setCreationState( { busy: stage, error: '' } );
		try {

			const update = await apply( await run() );
			this.view.setCreationState( { ...update, busy: null, error: '' } );
			return update;

		} catch ( cause ) {

			this.view.setCreationState( { busy: null, error: `${ stage } generation failed: ${ message( cause ) }` } );
			return null;

		}

	}

	announce( text, error = false ) {

		const line = this.view.mainMenu.integration;
		line.textContent = text;
		line.dataset.error = String( error );
		line.setAttribute( 'role', error ? 'alert' : 'status' );

	}

	clearAnnouncement() {

		const line = this.view.mainMenu.integration;
		line.removeAttribute( 'role' );
		delete line.dataset.error;

	}

}
