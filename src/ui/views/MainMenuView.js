import '../components/launcher.css';
import { el } from '../components/dom.js';
import { menuButton } from '../components/MenuButton.js';
import { GameLibraryView } from './GameLibraryView.js';
import { NewGameView } from './NewGameView.js';

/** Full-screen front door. It owns display state only and reports every persistence/generation intent. */
export class MainMenuView {

	constructor( callbacks = {} ) {

		this.callbacks = callbacks;
		this.library = new GameLibraryView( {
			onContinue: callbacks.onContinue,
			onSave: callbacks.onSave,
			onExportCity: callbacks.onExportCity,
			onSetUpCity: ( city ) => this.createFromCity( city )
		} );
		this.creator = new NewGameView( {
			onGenerateCity: callbacks.onGenerateCity,
			onGenerateInstances: callbacks.onGenerateInstances,
			onGenerateQuests: callbacks.onGenerateQuests,
			onCreateGame: callbacks.onCreateGame,
			onCancel: () => this.openLibrary( 'games' )
		} );

		this.continue = menuButton( { label: 'Continue game', detail: 'Resume the latest playthrough', disabled: true, primary: true, onClick: () => this.continueLatest() } );
		this.games = menuButton( { label: 'Games', detail: 'Cities with interiors and quests', onClick: () => this.openLibrary( 'games' ) } );
		this.cities = menuButton( { label: 'Cities', detail: 'Generated world directories', onClick: () => this.openLibrary( 'cities' ) } );
		this.newGame = menuButton( { label: 'New game', detail: 'City, interiors, story, play', onClick: () => this.createNew() } );
		this.load = menuButton( { label: 'Load game', detail: 'Open a local game file', disabled: ! callbacks.onLoad, onClick: () => this.file.click() } );
		this.file = el( 'input', { type: 'file', accept: '.json,.urbegame.json,application/json', className: 'menu-file-input', ariaLabel: 'Choose game file' } );
		this.file.addEventListener( 'change', () => {

			const file = this.file.files?.[ 0 ];
			this.file.value = '';
			if ( file ) callbacks.onLoad?.( file );

		} );
		this.integration = el( 'p', { className: 'menu-integration' } );
		this.content = el( 'main', { className: 'main-menu-content' }, this.library.element );
		this.title = el( 'h1', { id: 'urbe-main-menu-title', textContent: 'URBE' } );
		this.element = el( 'div', {
			className: 'main-menu', role: 'dialog', ariaModal: 'true'
		},
			el( 'div', { className: 'main-menu-frame', ariaHidden: 'true' } ),
			el( 'header', { className: 'main-menu-header' },
				el( 'div', {},
					el( 'p', { className: 'menu-eyebrow', textContent: 'World directory' } ),
					this.title,
					el( 'p', { className: 'main-menu-subtitle', textContent: 'Continue a game, load one, or build a playable world in isolated stages.' } )
				),
				el( 'div', { className: 'main-menu-status' },
					el( 'span', { className: 'status-pulse', ariaHidden: 'true' } ),
					el( 'span', { textContent: 'local world system' } )
				)
			),
			el( 'div', { className: 'main-menu-layout' },
				el( 'aside', { className: 'main-menu-rail' },
					this.continue, this.games, this.cities, this.newGame, this.load, this.file, this.integration
				),
				this.content
			),
			el( 'footer', { className: 'main-menu-footer' },
				el( 'span', { textContent: 'City archive' } ),
				el( 'span', { textContent: 'Game archive = city + interiors + quests + playthrough' } )
			)
		);
		this.element.setAttribute( 'aria-labelledby', this.title.id );
		this.element.hidden = true;
		this.setLibrary();
		this.openLibrary( 'games' );

	}

	show() {

		this.element.hidden = false;
		const entry = [ this.continue, this.games, this.cities, this.newGame, this.load ].find( ( button ) => ! button.disabled );
		entry?.focus();

	}

	hide() {

		this.element.hidden = true;

	}

	setLibrary( library = {} ) {

		this.library.setLibrary( library );
		const latest = this.library.mostRecentGame;
		this.continue.disabled = ! latest || ! this.callbacks.onContinue;
		this.integration.textContent = ! this.callbacks.onLoad
			? 'Local file loading is unavailable in this runtime.'
			: latest ? `Continue opens ${ latest.name || latest.id } at its saved position.` : 'No saved playthrough is available yet.';

	}

	setCreationState( state ) {

		this.creator.setCreationState( state );

	}

	continueLatest() {

		const latest = this.library.mostRecentGame;
		if ( latest ) this.callbacks.onContinue?.( latest.id );

	}

	openLibrary( directory = 'games' ) {

		this.library.showDirectory( directory );
		this.content.replaceChildren( this.library.element );
		this.games.classList.toggle( 'is-current', directory === 'games' );
		this.cities.classList.toggle( 'is-current', directory === 'cities' );
		this.newGame.classList.remove( 'is-current' );
		this.games.setAttribute( 'aria-current', directory === 'games' ? 'page' : 'false' );
		this.cities.setAttribute( 'aria-current', directory === 'cities' ? 'page' : 'false' );
		this.newGame.setAttribute( 'aria-current', 'false' );

	}

	createNew() {

		this.creator.reset();
		this.content.replaceChildren( this.creator.element );
		this.games.classList.remove( 'is-current' );
		this.cities.classList.remove( 'is-current' );
		this.newGame.classList.add( 'is-current' );
		this.games.setAttribute( 'aria-current', 'false' );
		this.cities.setAttribute( 'aria-current', 'false' );
		this.newGame.setAttribute( 'aria-current', 'page' );

	}

	createFromCity( city ) {

		this.creator.beginWithCity( city );
		this.content.replaceChildren( this.creator.element );
		this.games.classList.remove( 'is-current' );
		this.cities.classList.remove( 'is-current' );
		this.newGame.classList.add( 'is-current' );
		this.games.setAttribute( 'aria-current', 'false' );
		this.cities.setAttribute( 'aria-current', 'false' );
		this.newGame.setAttribute( 'aria-current', 'page' );

	}

}
