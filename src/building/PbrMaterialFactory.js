import * as THREE from 'three/webgpu';

const ALL_MAPS = [ 'basecolor', 'normal', 'roughness', 'metallic', 'ao', 'emission' ];

// Kinds the geometry layers place a few millimetres behind another surface
// (a curtain hangs just inside its window glass). At city distances that gap
// is below depth-buffer resolution, so the pair flickers; a positive polygon
// offset settles which one is behind.
const BEHIND_GLASS = /\/curtain\//;

/**
 * Mean colour of one map, by letting the browser do the averaging: a draw into
 * a 1x1 canvas is the whole mip chain collapsed. sRGB in, linear out. A map
 * that will not decode reads neutral rather than failing the run.
 */
async function decodeTint( url ) {

	const neutral = new THREE.Color( 1, 1, 1 );

	try {

		const bitmap = await createImageBitmap( await ( await fetch( url ) ).blob(), {
			resizeWidth: 1, resizeHeight: 1, resizeQuality: 'high'
		} );
		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = 1;
		const context = canvas.getContext( '2d', { willReadFrequently: true } );
		context.drawImage( bitmap, 0, 0 );
		const [ r, g, b ] = context.getImageData( 0, 0, 1, 1 ).data;
		bitmap.close();

		return r + g + b === 0 ? neutral : new THREE.Color().setRGB( r / 255, g / 255, b / 255, THREE.SRGBColorSpace );

	} catch {

		return neutral;

	}

}

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

	constructor( resolver, profile = {} ) {

		this.resolver = resolver;
		this.loader = new THREE.TextureLoader();
		this.cache = new Map();
		this.tints = new Map();
		this.materialMaps = new Set( profile.materialMaps ?? ALL_MAPS );
		this.patternVariants = profile.materialVariants ?? Infinity;
		this.textureAnisotropy = profile.textureAnisotropy ?? 8;

	}

	/** Fallback for keys the database cannot resolve. */
	static fallback( key ) {

		const material = new THREE.MeshStandardMaterial( { color: 0xff00ff, roughness: 0.4 } );
		material.name = `unresolved:${key}`;

		return material;

	}

	/**
	 * @param variantId one of the entry's own variants (`puddle` road, `bag`
	 * plastic); the first variant when it is not named.
	 * @returns a PBR material for the key, or the magenta fallback. Cached.
	 */
	build( key, variantId ) {

		const id = variantId ? `${key}#${variantId}` : key;

		if ( this.cache.has( id ) ) return this.cache.get( id );

		const entry = this.resolver.resolve( key );
		const material = entry ? this.#fromEntry( key, entry, variantId ) : PbrMaterialFactory.fallback( key );
		this.cache.set( id, material );

		return material;

	}

	/**
	 * A tuned copy of a key's material, cached under the same tuning. Callers
	 * that want a hotter emission or a two-sided panel take one of these; the
	 * material `build` returns is shared by every mesh of that key and must
	 * never be edited in place.
	 * `emissiveScale` rides the database's own authored strength; `emissiveLevel`
	 * replaces it. A surface the look is graded against by eye (a lamp lens, a
	 * lit diffuser) takes the level, so a materials release that re-authors a
	 * strength moves what the map looks like and never how bright the game runs
	 * it. A sign takes the scale, because the database's tiering is the point.
	 * @param tweaks { variantId, emissiveScale, emissiveLevel, emissive, side }
	 */
	variant( key, tweaks = {} ) {

		const id = `${key}|${tweaks.variantId ?? ''}|${tweaks.emissiveScale ?? 1}|${tweaks.emissiveLevel ?? ''}|${tweaks.emissive?.getHexString() ?? ''}|${tweaks.side ?? ''}`;

		if ( this.cache.has( id ) ) return this.cache.get( id );

		const material = this.build( key, tweaks.variantId ).clone();
		material.emissiveIntensity = tweaks.emissiveLevel !== undefined
			? tweaks.emissiveLevel
			: ( material.emissiveIntensity ?? 1 ) * ( tweaks.emissiveScale ?? 1 );
		// A lit diffuser reads as the colour of the lamp behind it, not white.
		if ( tweaks.emissive ) material.emissive = tweaks.emissive.clone();
		if ( tweaks.side !== undefined ) material.side = tweaks.side;
		this.cache.set( id, material );

		return material;

	}

	/**
	 * The mean colour of a key's base colour map, normalised so it carries hue
	 * only. The room fill light needs a surface's reflectance per channel: the
	 * level comes from what the surface is, the hue comes from the map itself,
	 * and that is why a room of warm walls goes warmer with every bounce.
	 * Keys with no base colour map read as neutral.
	 */
	async tint( key ) {

		if ( this.tints.has( key ) ) return this.tints.get( key );

		const url = this.build( key ).userData.basecolorUrl;
		const pending = url ? decodeTint( url ) : Promise.resolve( new THREE.Color( 1, 1, 1 ) );

		this.tints.set( key, pending );

		return pending;

	}

	#fromEntry( key, entry, variantId ) {

		const theme = key.split( '/' )[ 0 ];
		const physical = entry.physical ?? {};
		const variant = entry.variants.find( ( v ) => v.id === variantId ) ?? entry.variants[ 0 ];
		const tiled = entry.alignment === 'tile';
		const repeat = tiled
			? [ 1 / entry.tiling.worldSize[ 0 ], 1 / entry.tiling.worldSize[ 1 ] ]
			: [ 1, 1 ];

		const map = ( name, srgb = false ) => {

			if ( ! this.materialMaps.has( name ) ) return null;
			const path = variant.maps[ name ];

			if ( ! path ) return null;

			const texture = this.loader.load( this.resolver.mapUrl( theme, path ) );
			texture.flipY = false;
			texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
			texture.wrapS = texture.wrapT = tiled ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
			texture.repeat.set( repeat[ 0 ], repeat[ 1 ] );
			texture.anisotropy = this.textureAnisotropy;
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

		if ( variant.maps.basecolor ) material.userData.basecolorUrl = this.resolver.mapUrl( theme, variant.maps.basecolor );

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
