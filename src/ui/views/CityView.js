import '../components/styles.css';
import { el } from '../components/dom.js';

const HINT = 'drag to orbit · wheel to zoom · click a building to open it';

/**
 * The city preview's chrome: which world is up and what the pointer is over.
 * Presentation only; the app tells it what to show.
 */
export class CityView {

	constructor() {

		this.world = el( 'div', { className: 'status', textContent: 'loading…' } );
		this.hover = el( 'div', { className: 'status', textContent: HINT } );
		this.element = el( 'div', { className: 'overlay' },
			el( 'div', { className: 'panel panel-controls' },
				el( 'h2', { className: 'panel-title', textContent: 'city' } ),
				this.world,
				this.hover
			)
		);

	}

	mount( parent ) {

		parent.append( this.element );

	}

	setWorld( text ) {

		this.world.textContent = text;

	}

	/** @param building the model entry under the pointer, or null */
	setHover( building ) {

		this.hover.textContent = building
			? `${building.parcelId} · ${building.name ?? building.type} · ${building.tier} · ${building.floors.length} floors${building.built ? '' : ' · not built'}`
			: HINT;

	}

}
