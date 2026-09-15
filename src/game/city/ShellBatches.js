/** Material bindings and baked receiver shading each define a separate merge. */
export class ShellBatches {
	constructor() { this.materials = new Map(); }

	add( key, geometries ) {
		if ( ! this.materials.has( key ) ) this.materials.set( key, new Map() );
		const shading = this.materials.get( key );
		for ( const geometry of geometries ) {
			const scenic = geometry.hasAttribute( 'scenicRadiance' );
			if ( ! shading.has( scenic ) ) shading.set( scenic, { key, scenic, geometries: [] } );
			shading.get( scenic ).geometries.push( geometry );
		}
	}

	*values() {
		for ( const shading of this.materials.values() ) yield* shading.values();
	}
}
