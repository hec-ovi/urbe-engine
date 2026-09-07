export class Select {
	constructor( spec, onChange ) {
		this.element = document.createElement( 'label' );
		this.element.textContent = spec.label;
		this.input = document.createElement( 'select' );
		for ( const option of spec.options ) this.input.add( new Option( option.label, option.value ) );
		this.input.addEventListener( 'change', () => onChange( spec.id, this.input.value ) );
		this.element.append( this.input );
	}
}
