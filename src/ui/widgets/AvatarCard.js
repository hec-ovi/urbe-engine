import { el } from '../components/dom.js';
import '../components/call-avatar.css';

const SEGMENTS = 12;

/**
 * Top left: the player's portrait in a framed card, the name and a bar.
 * Hidden until the first setAvatar.
 */
export class AvatarCard {

	constructor() {

		this.frame = el( 'div', { className: 'avatar-frame' } );
		this.name = el( 'div', { className: 'avatar-name' } );
		this.role = el( 'div', { className: 'avatar-role' } );
		this.segments = Array.from( { length: SEGMENTS }, () => el( 'span', { className: 'avatar-bar-segment' } ) );
		this.element = el( 'div', { className: 'avatar-card' },
			this.frame,
			el( 'div', { className: 'avatar-identity' }, this.name, this.role,
				el( 'div', { className: 'avatar-bar', ariaHidden: 'true' }, ...this.segments ) )
		);
		this.element.hidden = true;

	}

	/**
	 * @param avatar { name, portraitUrl, canvas, bar } with bar in 0..1;
	 *   canvas (any element that draws itself) wins over portraitUrl.
	 */
	setAvatar( { name, role = '', portraitUrl, canvas, bar = 1 } ) {

		this.name.textContent = name;
		this.role.textContent = role;
		this.role.hidden = ! role;
		const portrait = canvas ?? ( portraitUrl ? el( 'img', { src: portraitUrl, alt: name } ) : null );
		this.frame.replaceChildren( ...( portrait ? [ portrait ] : [] ) );
		this.frame.hidden = ! portrait;

		const lit = Math.round( Math.min( 1, Math.max( 0, Number.isFinite( bar ) ? bar : 0 ) ) * SEGMENTS );
		this.segments.forEach( ( segment, i ) => segment.classList.toggle( 'is-lit', i < lit ) );
		this.element.hidden = false;

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
