import { Group } from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';
import { NativeTextureSource } from './materials/NativeTextureSource.js';
import { NativeStreetMaterials } from './materials/NativeStreetMaterials.js';
import { StreetVariants } from './materials/StreetVariants.js';
import { StreetVariantTextures } from './materials/StreetVariantTextures.js';
import { NativeStreetStream } from './native-stream/NativeStreetStream.js';
import { GroundOpenings } from './GroundOpenings.js';

/** Coordinates native ordinary streets with the retained authored infrastructure. */
export class GroundScene {
	/** @param textureOptions the native texture source's options, and `variants`: the street-variants binding the streets dress their panels from, or null */
	constructor( atlas, factory, nativeSource = null, textureOptions = {}, buildingSources = {} ) {
		this.group = new Group(); this.group.name = 'ground';
		this.retained = new GroundBuilder( nativeSource?.retainedAtlas() ?? atlas, factory, { openings: new GroundOpenings( buildingSources ) } ).stream();
		this.streams = [ this.retained ];
		if ( nativeSource ) {
			const { variants: variantBinding = null, ...sourceOptions } = textureOptions;
			this.textures = new NativeTextureSource( sourceOptions );
			const variants = this.#variants( variantBinding, nativeSource.manifest.materials.binding, atlas?.meta?.seed, sourceOptions );
			this.materials = new NativeStreetMaterials( nativeSource.manifest.materials.binding,
				( id, path, definition ) => this.textures.load( id, path, definition ), { detail: factory?.weathering?.detail ?? null, variants } );
			this.native = new NativeStreetStream( nativeSource, this.materials );
			this.streams.push( this.native );
		}
		this.group.add( ...this.streams.map( stream => stream.group ) );
		this.bounds = {
			min: [ 0, 1 ].map( i => Math.min( ...this.streams.map( stream => stream.bounds.min[ i ] ) ) ),
			max: [ 0, 1 ].map( i => Math.max( ...this.streams.map( stream => stream.bounds.max[ i ] ) ) )
		};
	}
	async update( position, settings ) {
		for ( const stream of this.streams ) await stream.update( position, settings );
	}
	get stats() {
		return this.streams.map( stream => stream.stats ).reduce( ( total, item ) => ( {
			indexed: total.indexed + item.indexed, resident: total.resident + item.resident,
			wanted: total.wanted + item.wanted, collision: total.collision + item.collision, pending: total.pending || item.pending
		} ), { indexed: 0, resident: 0, wanted: 0, collision: 0, pending: false } );
	}
	dispose() {
		for ( const stream of this.streams ) stream.dispose();
		this.materials?.dispose(); this.textures?.dispose(); this.variantTextures?.dispose(); this.group.removeFromParent();
	}

	/**
	 * The whole-bundle variants the native surfaces draw from, when Materials
	 * publishes them and they fit this world's snapshot: each surface they name
	 * must be photographed and sampled the way its set selects. A binding made
	 * against another snapshot still dresses the surfaces that fit, and says so.
	 */
	#variants( binding, base, worldSeed, { baseUrl, anisotropy } ) {
		if ( ! binding ) return null;
		let variants;
		try {
			variants = new StreetVariants( binding, { base, worldSeed } );
		} catch ( error ) {
			console.warn( `street variants: ${error.message}; the streets keep their own maps` );
			return null;
		}
		if ( variants.skipped.length ) console.info( `street variants: ${variants.skipped.map( ( { surfaceId, reason } ) => `${surfaceId} (${reason})` ).join( ', ' )} keep their own maps` );
		StreetVariants.fingerprint( base ).then( ( hash ) => {
			if ( binding.baseBinding?.sha256 && hash !== binding.baseBinding.sha256 ) console.warn( 'street variants: made against another street-native binding than this world\'s snapshot; dressing the surfaces that fit' );
		} ).catch( () => {} );
		if ( ! variants.surfaces.size ) return null;
		this.variantTextures = new StreetVariantTextures( { ...( baseUrl ? { baseUrl } : {} ), ...( anisotropy ? { anisotropy } : {} ) } );
		return { binding: variants, arrays: this.variantTextures.load };
	}
}
