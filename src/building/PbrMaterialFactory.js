import * as THREE from 'three/webgpu';

// Kinds the geometry layers place a few millimetres behind another surface
// (a curtain hangs just inside its window glass). At city distances that gap
// is below depth-buffer resolution, so the pair flickers; a positive polygon
// offset settles which one is behind.
const BEHIND_GLASS = /\/curtain\//;

/**
 * Turns a MaterialEntry into a three.js PBR material.
 * Tiled entries: geometry UVs are world meters (exterior/interior convention),
 * so texture.repeat = 1 / worldSize makes one tile cover worldSize meters.
 * Exact entries keep their 0..1 UVs untouched. Glass uses transmission per the
 * materials contract (KHR_materials_transmission semantics).
 * Every map loads with flipY off: the geometry that wears these materials comes
 * from glTF, whose UVs put v = 0 at the top of the image, and a flipped V both
 * turns exact art (screens, signs) upside down and mislights every normal map.
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

	/**
	 * A tuned copy of a key's material, cached under the same tuning. Callers
	 * that want a hotter emission or a two-sided panel take one of these; the
	 * material `build` returns is shared by every mesh of that key and must
	 * never be edited in place.
	 * @param tweaks { emissiveScale, side }
	 */
	variant( key, tweaks = {} ) {

		const id = `${key}|${tweaks.emissiveScale ?? 1}|${tweaks.side ?? ''}`;

		if ( this.cache.has( id ) ) return this.cache.get( id );

		const material = this.build( key ).clone();
		material.emissiveIntensity = ( material.emissiveIntensity ?? 1 ) * ( tweaks.emissiveScale ?? 1 );
		if ( tweaks.side !== undefined ) material.side = tweaks.side;
		this.cache.set( id, material );

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
			texture.flipY = false;
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

		if ( BEHIND_GLASS.test( key ) ) {

			material.polygonOffset = true;
			material.polygonOffsetFactor = 1;
			material.polygonOffsetUnits = 1;

		}

		return material;

	}

}
