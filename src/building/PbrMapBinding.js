/** Keeps decoded maps and scalar fallbacks consistent across shared material copies. */
export class PbrMapBinding {

	constructor( texture, fallback, loaded ) {

		this.texture = texture;
		this.fallback = fallback;
		this.loaded = loaded;

	}

	bind( material, map, scalar ) {

		if ( scalar ) material[ scalar ] = 1;
		this.loaded.then( ( succeeded ) => {

			if ( succeeded || material[ map ] !== this.texture ) return;
			material[ map ] = null;
			if ( scalar ) material[ scalar ] = this.fallback;
			material.needsUpdate = true;

		} );

	}

}
