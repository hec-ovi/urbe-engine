import { el } from './dom.js';

/** Launcher action with one visual treatment and a real disabled explanation. */
export function menuButton( { label, detail = '', primary = false, disabled = false, onClick = () => {} } ) {

	const button = el( 'button', {
		type: 'button',
		className: `menu-action${ primary ? ' is-primary' : '' }`,
		disabled,
		ariaLabel: label
	},
		el( 'span', { className: 'menu-action-mark', ariaHidden: 'true' } ),
		el( 'span', { className: 'menu-action-copy' },
			el( 'span', { className: 'menu-action-label', textContent: label } ),
			detail ? el( 'span', { className: 'menu-action-detail', textContent: detail } ) : ''
		),
		el( 'span', { className: 'menu-action-chevron', textContent: '\u203a', ariaHidden: 'true' } )
	);
	button.addEventListener( 'click', onClick );
	return button;

}
