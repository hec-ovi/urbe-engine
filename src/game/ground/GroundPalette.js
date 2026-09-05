import catalog from '../../../../materials/bindings/street-styles.json' with { type: 'json' };
import { fail } from './GroundRegions.js';

const ROLES = { roadway: 'road', sidewalk: 'paving', block: 'paving', open: 'paving', curb: 'curb' };

/** One compatible catalog family per seeded world. Surface regions own their mapping. */
export class GroundPalette {

	static construction( familyId, finish ) {

		const style = catalog.styles.find( style => style.id === familyId );
		if ( style && finish === 'road' && ! Object.hasOwn( style.constructionSurfaces ?? {}, finish ) ) return null;
		const binding = style?.constructionSurfaces?.[ finish ];
		if ( ! binding?.kind || ! binding.variant ) fail( `Unknown construction finish: ${familyId}/${finish}` );
		return { key: `cyberpunk/${binding.kind}/mid`, variantId: binding.variant };

	}

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
