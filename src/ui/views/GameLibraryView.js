import { el } from '../components/dom.js';
import { gameCard, cityCard } from '../widgets/LibraryCard.js';

/** Player-facing directories. Games carry playthroughs; cities are generation artifacts. */
export class GameLibraryView {

	constructor( { onContinue, onSave, onSetUpCity, onExportCity } = {} ) {

		this.handlers = { onContinue, onSave, onSetUpCity, onExportCity };
		this.games = [];
		this.cities = [];
		this.directory = 'games';
		this.title = el( 'h2', { className: 'menu-section-title', textContent: 'Your games' } );
		this.count = el( 'span', { className: 'menu-directory-count', textContent: '0 saved' } );
		this.empty = el( 'div', { className: 'menu-empty' } );
		this.list = el( 'div', { className: 'menu-library-list' } );
		this.element = el( 'section', { className: 'game-library-view', ariaLabel: 'Saved games and cities' },
			el( 'div', { className: 'menu-section-heading' }, this.title, this.count ),
			this.empty,
			this.list
		);
		this.render();

	}

	setLibrary( { games = [], cities = [] } = {} ) {

		this.games = [ ...games ];
		this.cities = [ ...cities ];
		this.render();

	}

	showDirectory( directory ) {

		if ( directory !== 'games' && directory !== 'cities' ) return;
		this.directory = directory;
		this.render();

	}

	get mostRecentGame() {

		return this.games.find( ( game ) => game.playable !== false ) || null;

	}

	render() {

		const games = this.directory === 'games';
		const entries = games ? this.games : this.cities;
		this.title.textContent = games ? 'Your games' : 'Your cities';
		this.count.textContent = `${ entries.length } ${ games ? 'saved' : 'generated' }`;
		this.empty.hidden = entries.length > 0;
		this.empty.textContent = games
			? 'No playable games yet. Create a city, add its interiors, then generate the story and jobs.'
			: 'No generated cities yet. Start with a city seed and size.';
		this.list.replaceChildren( ...entries.map( ( entry ) => games
			? gameCard( entry, { onContinue: this.handlers.onContinue, onSave: this.handlers.onSave } )
			: cityCard( entry, { onSetUp: this.handlers.onSetUpCity, onExport: this.handlers.onExportCity } )
		) );

	}

}
