import { el } from '../components/dom.js';

const LABELS = [ 'City', 'Interiors', 'Story and jobs', 'Playable game' ];

/** Four-stage rail. Locked stages are real disabled buttons. */
export class CreationSteps {

	constructor( { onSelect } ) {

		this.buttons = LABELS.map( ( label, index ) => {

			const step = index + 1;
			const button = el( 'button', { type: 'button', className: 'creation-step', ariaLabel: `Step ${ step }: ${ label }` },
				el( 'span', { className: 'creation-step-number', textContent: String( step ) } ),
				el( 'span', { className: 'creation-step-label', textContent: label } )
			);
			button.addEventListener( 'click', () => onSelect( step ) );
			return button;

		} );
		this.element = el( 'nav', { className: 'creation-steps', ariaLabel: 'Game creation progress' }, ...this.buttons );
		this.set( 1, 1 );

	}

	set( current, unlocked ) {

		this.buttons.forEach( ( button, index ) => {

			const step = index + 1;
			button.disabled = step > unlocked;
			button.setAttribute( 'aria-current', step === current ? 'step' : 'false' );
			button.dataset.done = String( step < unlocked );

		} );

	}

}
