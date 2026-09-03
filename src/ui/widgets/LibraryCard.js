import { el } from '../components/dom.js';

function count( value ) {

	return Number.isFinite( value ) ? value : 0;

}

function metric( value, label ) {

	return el( 'span', { className: 'library-metric' },
		el( 'strong', { textContent: String( count( value ) ) } ),
		el( 'span', { textContent: label } )
	);

}

function action( label, onClick, { primary = false, disabled = false } = {} ) {

	const button = el( 'button', {
		type: 'button',
		className: `library-card-action${ primary ? ' is-primary' : '' }`,
		textContent: label,
		disabled
	} );
	button.addEventListener( 'click', onClick );
	return button;

}

function positionText( position ) {

	if ( ! Array.isArray( position ) || position.length < 3 ) return 'Position unavailable';
	return `X ${ Number( position[ 0 ] ).toFixed( 1 ) }  Y ${ Number( position[ 1 ] ).toFixed( 1 ) }  Z ${ Number( position[ 2 ] ).toFixed( 1 ) }`;

}

function recentNames( values, empty ) {

	if ( ! Array.isArray( values ) || values.length === 0 ) return empty;
	return values.slice( 0, 3 ).map( ( value ) => typeof value === 'string' ? value : value.name ).filter( Boolean ).join( '  /  ' ) || empty;

}

/** One playable game. Its callbacks are supplied by the launcher, never storage. */
export function gameCard( game, { onContinue, onSave } ) {

	const playable = game.playable !== false;
	const quest = game.activeQuest;
	const card = el( 'article', { className: 'library-card game-library-card' },
		el( 'div', { className: 'library-card-art', ariaHidden: 'true' },
			el( 'span', { textContent: game.theme || 'future noir' } )
		),
		el( 'div', { className: 'library-card-body' },
			el( 'div', { className: 'library-card-heading' },
				el( 'div', {},
					el( 'p', { className: 'library-card-kicker', textContent: game.cityName || 'assembled city' } ),
					el( 'h3', { textContent: game.name || game.id } )
				),
				el( 'span', { className: `library-state ${ playable ? 'is-ready' : 'is-building' }`, textContent: playable ? 'playable' : 'building' } )
			),
			el( 'div', { className: 'library-metrics' },
				metric( game.mainSteps, 'main steps' ),
				metric( game.sideJobs, 'side jobs' ),
				metric( game.interiors, 'interiors' ),
				metric( Array.isArray( game.inventory ) ? game.inventory.length : game.inventoryCount, 'inventory' ),
				metric( Array.isArray( game.locations ) ? game.locations.length : game.locationCount, 'locations' )
			),
			el( 'div', { className: 'library-session-grid' },
				el( 'div', {}, el( 'span', { textContent: 'Current location' } ), el( 'strong', { textContent: game.location || 'Not entered yet' } ) ),
				el( 'div', {}, el( 'span', { textContent: 'Player position' } ), el( 'strong', { textContent: positionText( game.position ) } ) ),
				el( 'div', {}, el( 'span', { textContent: 'Active quest' } ), el( 'strong', { textContent: quest?.title || 'No active quest' } ) ),
				el( 'div', {}, el( 'span', { textContent: 'Objective' } ), el( 'strong', { textContent: quest?.objective || 'Choose a quest in game' } ) )
			),
			el( 'p', { className: 'library-card-line', textContent: `Places: ${ recentNames( game.locations, 'none discovered' ) }` } ),
			el( 'p', { className: 'library-card-line', textContent: `Inventory: ${ recentNames( game.inventory, 'empty' ) }` } )
		),
		el( 'div', { className: 'library-card-actions' },
			action( 'Continue', () => onContinue?.( game.id ), { primary: true, disabled: ! playable || ! onContinue } ),
			action( 'Save copy', () => onSave?.( game.id ), { disabled: ! onSave } )
		)
	);
	return card;

}

/** One generated city which has not necessarily become a playable game. */
export function cityCard( city, { onSetUp, onExport } ) {

	const ready = city.status !== 'building' && city.status !== 'failed';
	return el( 'article', { className: 'library-card city-library-card' },
		el( 'div', { className: 'library-card-art city-art', ariaHidden: 'true' },
			el( 'span', { textContent: city.size || 'city' } )
		),
		el( 'div', { className: 'library-card-body' },
			el( 'div', { className: 'library-card-heading' },
				el( 'div', {}, el( 'p', { className: 'library-card-kicker', textContent: `seed ${ city.seed || 'unknown' }` } ), el( 'h3', { textContent: city.name || city.id } ) ),
				el( 'span', { className: `library-state ${ ready ? 'is-ready' : 'is-building' }`, textContent: ready ? 'city ready' : city.status }
				)
			),
			el( 'div', { className: 'library-metrics' },
				metric( city.buildings, 'buildings' ),
				metric( city.interiorCount, 'interiors' ),
				metric( city.districts, 'districts' )
			),
			el( 'p', { className: 'library-card-line', textContent: city.summary || 'Generated city geometry. Add selected interiors and quest content to make a playable game.' } )
		),
		el( 'div', { className: 'library-card-actions' },
			action( city.interiorCount > 0 ? 'Continue setup' : 'Add interiors', () => onSetUp?.( city ), { primary: true, disabled: ! ready || ! onSetUp } ),
			action( 'Export city', () => onExport?.( city.id ), { disabled: ! onExport } )
		)
	);

}
