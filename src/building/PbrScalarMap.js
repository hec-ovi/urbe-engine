/** Binds an absolute scalar map and its catalog fallback to shared material copies. */
export class PbrScalarMap {

	constructor( texture, fallback, loaded ) {

		this.texture = texture;
		this.fallback = fallback;
		this.loaded = loaded;

	}

	bind( material, channel ) {

		material[ channel ] = 1;
		this.loaded.then( ( succeeded ) => {

			const map = `${channel}Map`;
			if ( succeeded || material[ map ] !== this.texture ) return;
			material[ map ] = null;
			material[ channel ] = this.fallback;
			material.needsUpdate = true;

		} );

	}

}
