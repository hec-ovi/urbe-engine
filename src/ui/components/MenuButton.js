import { el } from './dom.js';
import { keyCap } from './KeyCap.js';

/** Menu action with one visual treatment and a real disabled explanation; `key` shows the key that also does it. */
export function menuButton( { label, detail = '', key = '', primary = false, disabled = false, onClick = () => {} } ) {

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
		key ? keyCap( key ) : el( 'span', { className: 'menu-action-chevron', textContent: '›', ariaHidden: 'true' } )
	);
	button.addEventListener( 'click', onClick );
	return button;

}
