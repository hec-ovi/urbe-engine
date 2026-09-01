import { el } from '../components/dom.js';

const SEGMENTS = 12;

/**
 * Top left: the player's portrait in a framed card, the name and a bar.
 * Hidden until the first setAvatar.
 */
export class AvatarCard {

	constructor() {

		this.frame = el( 'div', { className: 'avatar-frame' } );
		this.name = el( 'div', { className: 'avatar-name' } );
		this.segments = Array.from( { length: SEGMENTS }, () => el( 'span', { className: 'avatar-bar-segment' } ) );
		this.element = el( 'div', { className: 'avatar-card' },
			this.frame,
			this.name,
			el( 'div', { className: 'avatar-bar' }, ...this.segments )
		);
		this.element.hidden = true;

	}

	/**
	 * @param avatar { name, portraitUrl, canvas, bar } with bar in 0..1;
	 *   canvas (any element that draws itself) wins over portraitUrl.
	 */
	setAvatar( { name, portraitUrl, canvas, bar = 1 } ) {

		this.name.textContent = name;
		this.frame.replaceChildren( canvas ?? ( portraitUrl ? el( 'img', { src: portraitUrl, alt: name } ) : '' ) );

		const lit = Math.round( Math.min( 1, Math.max( 0, bar ) ) * SEGMENTS );
		this.segments.forEach( ( segment, i ) => segment.classList.toggle( 'is-lit', i < lit ) );
		this.element.hidden = false;

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
