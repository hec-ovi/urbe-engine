import { el } from '../components/dom.js';

/**
 * Bottom left: where the player is in world metres, and the about line naming
 * every file the running world was loaded from.
 */
export class LocationReadout {

	constructor() {

		this.line = el( 'div', {} );
		this.about = el( 'div', { className: 'hud-readout-about' } );
		this.element = el( 'div', { className: 'hud-readout' }, this.line, this.about );

	}

	setAbout( paths ) {

		this.about.textContent = `world: ${paths.join( '  ·  ')}`;

	}

	update( position, district, parcel ) {

		const where = parcel ? `${district} · ${parcel}` : district;
		const text = `x ${position.x.toFixed( 1 )}   z ${position.z.toFixed( 1 )}   y ${position.y.toFixed( 2 )}   ${where}`;

		if ( this.line.textContent !== text ) this.line.textContent = text;

	}

}
