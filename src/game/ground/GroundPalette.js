import catalog from '../../../../materials/bindings/street-styles.json' with { type: 'json' };

const ROLES = { roadway: 'road', sidewalk: 'paving', block: 'paving', open: 'paving', curb: 'curb' };

/** One compatible catalog family per seeded world. Surface regions own their mapping. */
export class GroundPalette {

	constructor( seed = '' ) {

		let hash = 0;
		for ( const character of String( seed ) ) hash = ( Math.imul( hash, 31 ) + character.codePointAt( 0 ) ) >>> 0;
		this.style = catalog.styles[ hash % catalog.styles.length ];

	}

	surface( surface ) {

		const binding = this.style.surfaces[ ROLES[ surface ] ];
		return { key: `cyberpunk/${binding.kind}/mid`, variantId: binding.variant };

	}

}
