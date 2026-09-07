import { Select } from '../ui/Select.js';

export class ReviewView {
	constructor( layout, onChange ) {
		this.element = document.createElement( 'aside' );
		const title = document.createElement( 'h1' ); title.textContent = layout.title;
		const hint = document.createElement( 'p' ); hint.textContent = layout.hint;
		this.fields = layout.fields.map( field => new Select( field, onChange ) );
		this.status = document.createElement( 'output' ); this.status.setAttribute( 'aria-live', 'polite' );
		this.element.append( title, ...this.fields.map( field => field.element ), hint, this.status );
	}
	setBusy( busy ) { this.element.setAttribute( 'aria-busy', String( busy ) ); this.fields.forEach( field => { field.input.disabled = busy; } ); }
	setStatus( text ) { this.status.textContent = text; }
}
