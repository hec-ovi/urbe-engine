import * as THREE from 'three/webgpu';

/**
 * Turns a MaterialEntry into a three.js PBR material.
 * Tiled entries: geometry UVs are world meters (exterior/interior convention),
 * so texture.repeat = 1 / worldSize makes one tile cover worldSize meters.
 * Exact entries keep their 0..1 UVs untouched. Glass uses transmission per the
 * materials contract (KHR_materials_transmission semantics).
 * Unresolvable keys get an unmistakable magenta fallback.
 */
export class PbrMaterialFactory {

	constructor( resolver ) {

		this.resolver = resolver;
		this.loader = new THREE.TextureLoader();
		this.cache = new Map();

	}

	/** Fallback for keys the database cannot resolve. */
	static fallback( key ) {

		const material = new THREE.MeshStandardMaterial( { color: 0xff00ff, roughness: 0.4 } );
		material.name = `unresolved:${key}`;

		return material;

	}

	/** @returns a PBR material for the key, or the magenta fallback. Cached per key. */
	build( key ) {

		if ( this.cache.has( key ) ) return this.cache.get( key );

		const entry = this.resolver.resolve( key );
		const material = entry ? this.#fromEntry( key, entry ) : PbrMaterialFactory.fallback( key );
		this.cache.set( key, material );

		return material;

	}

	#fromEntry( key, entry ) {

		const theme = key.split( '/' )[ 0 ];
		const physical = entry.physical ?? {};
		const variant = entry.variants[ 0 ];
		const tiled = entry.alignment === 'tile';
		const repeat = tiled
			? [ 1 / entry.tiling.worldSize[ 0 ], 1 / entry.tiling.worldSize[ 1 ] ]
			: [ 1, 1 ];

		const map = ( name, srgb = false ) => {

			const path = variant.maps[ name ];

			if ( ! path ) return null;

			const texture = this.loader.load( this.resolver.mapUrl( theme, path ) );
			texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
			texture.wrapS = texture.wrapT = tiled ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
			texture.repeat.set( repeat[ 0 ], repeat[ 1 ] );
			texture.anisotropy = 8;
			texture.channel = 0;

			return texture;

		};

		const material = new THREE.MeshPhysicalMaterial( {
			name: key,
			map: map( 'basecolor', true ),
			normalMap: map( 'normal' ),
			roughnessMap: map( 'roughness' ),
			metalnessMap: map( 'metallic' ),
			aoMap: map( 'ao' ),
			roughness: physical.roughnessFactor ?? 1,
			metalness: physical.metallicFactor ?? 1
		} );

		const emission = map( 'emission', true );

		if ( emission ) {

			material.emissiveMap = emission;
			material.emissive = new THREE.Color( 0xffffff );
			material.emissiveIntensity = physical.emissiveStrength ?? 1;

		}

		if ( ( physical.transmission ?? 0 ) > 0 ) {

			material.transmission = physical.transmission;
			material.ior = physical.ior ?? 1.5;
			if ( physical.tint ) material.color = new THREE.Color( physical.tint );

		}

		if ( physical.alphaMode === 'BLEND' ) material.transparent = true;
		if ( physical.alphaMode === 'MASK' ) material.alphaTest = 0.5;

		return material;

	}

}
