import { BufferAttribute } from 'three/webgpu';
import { float, int, select, uint } from 'three/tsl';
import { fail } from './NativeMaterialError.js';

/** The Materials binding the variants come in (`materials/bindings/street-variants.json`). */
export const VARIANT_BINDING = 'street-variants';
/** The four maps a variant replaces together, as one bundle. */
export const VARIANT_MAPS = Object.freeze( [ 'basecolor', 'normal', 'roughness', 'ao' ] );
/** Which base sampling each selection unit draws over. */
const UNITS = Object.freeze( { panel: [ 'panel' ], 'world-cell': [ 'world-xz' ] } );
const OFFSET = 2166136261, PRIME = 16777619;
/** Two triangles whose reconstructed panel origins lie closer than this are one panel. */
const SAME_PANEL = 0.02;

/** FNV-1a 32 over the UTF-8 bytes of `text`, continuing from `hash`. */
export function fnv1a( text, hash = OFFSET ) {

	for ( const byte of new TextEncoder().encode( text ) ) hash = Math.imul( hash ^ byte, PRIME ) >>> 0;

	return hash >>> 0;

}

/** FNV-1a 32 continued over 32-bit words, each as four little-endian bytes (a negative word in two's complement). */
export function fnvWords( hash, words ) {

	for ( const word of words ) {

		for ( let shift = 0; shift < 32; shift += 8 ) hash = Math.imul( hash ^ ( ( word >>> shift ) & 255 ), PRIME ) >>> 0;

	}

	return hash >>> 0;

}

/** The first variant whose cumulative weight exceeds the hash read as a fraction of 2^32. */
export function choose( cdf, hash ) {

	const u = ( hash >>> 0 ) / 4294967296;
	const index = cdf.findIndex( ( edge ) => edge > u );

	return index < 0 ? cdf.length - 1 : index;

}

/** A placement's stable identity: the piece it copies and where it stands. */
export const placementId = ( placement ) => `${placement.piece}@${placement.position.join( ',' )}`;

/**
 * Whole-bundle variants of the street surfaces (Materials
 * `sources/street-variants/CONTRACT.md`): a surface the binding names draws
 * every one of its panels, or every repeat cell of a world-sampled tiling,
 * with one of its set's variants, chosen by a stable hash and the set's
 * weights. A variant replaces basecolor, normal, roughness and AO together and
 * keeps the surface's own parameters, tint, effect and UVs.
 *
 * The choice: FNV-1a 32 over the UTF-8 bytes of
 * `JSON.stringify([salt, String(worldSeed), surfaceId, String(placementId)])`,
 * continued over the unit's 32-bit words as little-endian bytes, read as a
 * fraction of 2^32 against the set's cumulative weights (normalised to their
 * sum). A `panel` unit is the panel's index in its piece (`withPanelUnits`)
 * under the placement `piece@x,y,z`; a `world-cell` unit is the two words
 * floor(sample coordinate) under the placement `world`. The prefix is hashed
 * once per placement on the CPU and the shader finishes it, so the same panel
 * draws the same variant across reloads, streaming and batch slots.
 */
export class StreetVariants {

	/**
	 * @param binding the parsed `street-variants` binding
	 * @param base the world's native street snapshot the variants dress
	 * @param worldSeed the city's seed
	 */
	constructor( binding, { base, worldSeed } ) {

		if ( ! record( binding ) || binding.version !== 1 || ! record( binding.textures ) || ! record( binding.sets ) || ! record( binding.surfaces ) ) fail( 'Invalid street variant binding' );
		if ( ! record( base?.surfaces ) ) fail( 'Street variants need the native snapshot they dress' );
		this.worldSeed = String( worldSeed ?? '' );
		this.sets = new Map();
		this.surfaces = new Map();
		this.skipped = [];
		for ( const [ surfaceId, setId ] of Object.entries( binding.surfaces ) ) {

			const reason = this.#bind( binding, base, surfaceId, setId );
			if ( reason ) this.skipped.push( { surfaceId, reason } );

		}

	}

	/**
	 * The SHA-256 the binding's `baseBinding` names a native snapshot by: the
	 * hash of the file Materials writes for it, two-space JSON and a newline.
	 */
	static async fingerprint( base ) {

		const bytes = new TextEncoder().encode( `${JSON.stringify( base, null, 2 )}\n` );
		const digest = await globalThis.crypto.subtle.digest( 'SHA-256', bytes );

		return [ ...new Uint8Array( digest ) ].map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

	}

	/** The set a surface draws its variants from, or null when it keeps its own maps. */
	of( surfaceId ) {

		return this.surfaces.get( surfaceId ) ?? null;

	}

	/** The hash prefix of one surface under one placement (`'world'` for world cells). */
	seed( surfaceId, placement ) {

		const set = this.#set( surfaceId );

		return fnv1a( JSON.stringify( [ set.salt, this.worldSeed, surfaceId, String( placement ) ] ) );

	}

	/** The variant index a unit of a surface draws, the reference the shader reproduces. */
	select( surfaceId, placement, words ) {

		return choose( this.#set( surfaceId ).cdf, fnvWords( this.seed( surfaceId, placement ), words ) );

	}

	#set( surfaceId ) {

		const set = this.of( surfaceId );
		if ( ! set ) fail( `Street surface has no variants: ${surfaceId}` );

		return set;

	}

	#bind( binding, base, surfaceId, setId ) {

		const surface = base.surfaces[ surfaceId ];
		if ( ! surface ) return 'not in this world';
		if ( surface.effect !== 'photographed' ) return `effect ${surface.effect} is not photographed`;
		if ( ! this.sets.has( setId ) ) {

			const set = described( binding, setId );
			if ( typeof set === 'string' ) return set;
			this.sets.set( setId, set );

		}
		const set = this.sets.get( setId );
		if ( ! UNITS[ set.unit ].includes( surface.uv?.mode ) ) return `${set.unit} unit over ${surface.uv?.mode} sampling`;
		this.surfaces.set( surfaceId, set );

		return null;

	}

}

/** A set as the engine draws it, or why it cannot be drawn. */
function described( binding, id ) {

	const set = binding.sets[ id ];
	if ( ! record( set ) || ! Array.isArray( set.variants ) || ! set.variants.length ) return `set ${id} is missing`;
	const { unit, salt, fallback } = set.selection ?? {};
	if ( ! Object.hasOwn( UNITS, unit ) ) return `set ${id} selects by ${unit}`;
	if ( typeof salt !== 'string' || set.selection.uvTransform !== 'identity' ) return `set ${id} has no salt or moves the UVs`;
	const layers = [];
	let resolution = null;
	for ( const variant of set.variants ) {

		if ( ! ( variant.weight > 0 ) || ! record( variant.maps ) ) return `set ${id} variant ${variant.id} is malformed`;
		const maps = {};
		for ( const slot of VARIANT_MAPS ) {

			const texture = binding.textures[ variant.maps[ slot ] ];
			if ( ! record( texture ) || typeof texture.path !== 'string' || ! texture.path.startsWith( 'themes/' )
				|| texture.path.split( '/' ).some( ( part ) => ! part || part === '.' || part === '..' ) ) return `set ${id} variant ${variant.id} lacks ${slot}`;
			if ( texture.colorSpace !== ( slot === 'basecolor' ? 'srgb' : 'linear' ) ) return `set ${id} ${slot} is not ${slot === 'basecolor' ? 'sRGB' : 'linear'}`;
			resolution ??= texture.resolution;
			if ( ! Array.isArray( texture.resolution ) || texture.resolution[ 0 ] !== resolution[ 0 ] || texture.resolution[ 1 ] !== resolution[ 1 ] ) return `set ${id} mixes map sizes`;
			maps[ slot ] = Object.freeze( { path: texture.path, sha256: texture.sha256 } );

		}
		layers.push( Object.freeze( { id: variant.id, condition: variant.condition ?? variant.id, maps: Object.freeze( maps ) } ) );

	}
	const total = set.variants.reduce( ( sum, variant ) => sum + variant.weight, 0 );
	let running = 0;
	const cdf = set.variants.map( ( variant ) => ( running += variant.weight ) / total );
	cdf[ cdf.length - 1 ] = 1;
	const fallbackIndex = Math.max( 0, set.variants.findIndex( ( variant ) => variant.id === fallback ) );

	return Object.freeze( { id, unit, salt, cdf: Object.freeze( cdf ), fallback: fallbackIndex, resolution: Object.freeze( [ ...resolution ] ), layers: Object.freeze( layers ) } );

}

/**
 * A unit's hash as a fraction of 2^32, as the shader reproduces `fnvWords`:
 * `seed` the prefix as a uint node, `words` the unit's 32-bit words as uint nodes.
 */
export function variantFraction( seed, words ) {

	let hash = seed;
	for ( const word of words ) {

		for ( let shift = 0; shift < 32; shift += 8 ) hash = hash.bitXor( word.shiftRight( uint( shift ) ).bitAnd( uint( 255 ) ) ).mul( uint( PRIME ) );

	}

	return float( hash ).mul( 1 / 4294967296 ).toConst();

}

/** The layer a hash fraction `u` picks by the set's own weights, as `choose` does. */
export function variantLayer( set, u ) {

	return set.cdf.slice( 0, - 1 ).reduce( ( layer, edge ) => layer.add( select( u.greaterThanEqual( edge ), int( 1 ), int( 0 ) ) ), int( 0 ) );

}

/**
 * Numbers every panel of a slab-mapped primitive, as the per-vertex
 * `_street_panel` attribute: each triangle finds its UV chart (the point its
 * UV is 0, 0 at and the metres one unit of U and of V runs) and the repeat of
 * it the triangle lies in, and triangles sharing all of them, to 2 cm, are one
 * panel, clipped remainders included. Panels are numbered in the order of
 * their charts, so a piece numbers its panels the same way every time it
 * loads. A vertex two panels share is split in two.
 */
export function withPanelUnits( geometry ) {

	const position = geometry.getAttribute( 'position' ), uv = geometry.getAttribute( 'uv' );
	const index = geometry.index;
	const corners = index ? index.count : position.count;
	const vertexOf = ( corner ) => index ? index.getX( corner ) : corner;
	const keys = [], panels = [];
	const grid = new Map();
	for ( let corner = 0; corner < corners; corner += 3 ) {

		const key = chart( position, uv, vertexOf( corner ), vertexOf( corner + 1 ), vertexOf( corner + 2 ) );
		let panel = -1;
		const cell = [ 0, 1, 2 ].map( ( axis ) => Math.floor( key[ axis ] / SAME_PANEL ) );
		for ( let dx = - 1; dx <= 1 && panel < 0; dx ++ ) for ( let dy = - 1; dy <= 1 && panel < 0; dy ++ ) for ( let dz = - 1; dz <= 1 && panel < 0; dz ++ ) {

			for ( const candidate of grid.get( [ cell[ 0 ] + dx, cell[ 1 ] + dy, cell[ 2 ] + dz, key[ 3 ], key[ 4 ] ].join( ',' ) ) ?? [] ) {

				if ( same( panels[ candidate ], key ) ) { panel = candidate; break; }

			}

		}
		if ( panel < 0 ) {

			panel = panels.push( key ) - 1;
			const at = [ ...cell, key[ 3 ], key[ 4 ] ].join( ',' );
			grid.set( at, [ ...( grid.get( at ) ?? [] ), panel ] );

		}
		keys.push( panel );

	}
	// Number the panels by where they start, to the centimetre, not by which triangle met them first.
	const rank = panels.map( ( [ x, y, z, u, v, ...axes ] ) => [ u, v, x, z, y, ...axes ].map( ( value, at ) => at < 2 ? value : Math.round( value * 100 ) ) );
	const order = panels.map( ( _, panel ) => panel ).sort( ( a, b ) => {

		for ( let at = 0; at < rank[ a ].length; at ++ ) if ( rank[ a ][ at ] !== rank[ b ][ at ] ) return rank[ a ][ at ] - rank[ b ][ at ];
		return a - b;

	} );
	const number = new Int32Array( panels.length );
	order.forEach( ( panel, rank ) => { number[ panel ] = rank; } );

	// A vertex keeps the first panel that claims it; another panel gets a copy.
	const owner = new Int32Array( position.count ).fill( - 1 );
	const copies = [], remap = new Map();
	const corner = new Uint32Array( corners );
	for ( let at = 0; at < corners; at ++ ) {

		const vertex = vertexOf( at ), panel = number[ keys[ Math.floor( at / 3 ) ] ];
		if ( owner[ vertex ] < 0 || owner[ vertex ] === panel ) {

			owner[ vertex ] = panel;
			corner[ at ] = vertex;
			continue;

		}
		const key = `${vertex}:${panel}`;
		if ( ! remap.has( key ) ) remap.set( key, position.count + copies.push( { vertex, panel } ) - 1 );
		corner[ at ] = remap.get( key );

	}
	if ( copies.length ) {

		for ( const [ name, shared ] of Object.entries( geometry.attributes ) ) {

			const attribute = owned( shared ), size = attribute.itemSize;
			const array = new attribute.array.constructor( ( position.count + copies.length ) * size );
			array.set( attribute.array.subarray( 0, position.count * size ) );
			copies.forEach( ( { vertex }, n ) => array.set( attribute.array.subarray( vertex * size, ( vertex + 1 ) * size ), ( position.count + n ) * size ) );
			geometry.setAttribute( name, new BufferAttribute( array, size, attribute.normalized ) );

		}

	}
	const total = position.count + copies.length;
	const units = new Float32Array( total );
	for ( let vertex = 0; vertex < position.count; vertex ++ ) units[ vertex ] = Math.max( 0, owner[ vertex ] );
	copies.forEach( ( { panel }, n ) => { units[ position.count + n ] = panel; } );
	geometry.setIndex( new BufferAttribute( total > 65535 ? corner : new Uint16Array( corner ), 1 ) );
	geometry.setAttribute( '_street_panel', new BufferAttribute( units, 1 ) );
	// Each panel's chart in the piece's metres, in panel order: where its UV is
	// 0, 0 and the metres one unit of U and of V runs, for the panel graph.
	const charts = new Float64Array( panels.length * 9 );
	order.forEach( ( panel, rank ) => {

		// A chart that repeats across a primitive starts each repeat a whole U or V on.
		const [ x, y, z, ru, rv, ux, uy, uz, vx, vy, vz ] = panels[ panel ];
		charts.set( [ x + ux * ru + vx * rv, y + uy * ru + vy * rv, z + uz * ru + vz * rv, ux, uy, uz, vx, vy, vz ], rank * 9 );

	} );
	geometry.userData.streetPanels = charts;

	return geometry;

}

/** Whether two charts are one: the same repeat, and origins and axes within 2 cm. */
function same( p, q ) {

	if ( p[ 3 ] !== q[ 3 ] || p[ 4 ] !== q[ 4 ] ) return false;
	for ( const at of [ 0, 5, 8 ] ) if ( Math.hypot( p[ at ] - q[ at ], p[ at + 1 ] - q[ at + 1 ], p[ at + 2 ] - q[ at + 2 ] ) >= SAME_PANEL ) return false;

	return true;

}

/**
 * A triangle's UV chart: where its UV is 0, 0, which whole repeat of the chart
 * the triangle covers, and the metres one unit of U and of V runs.
 */
function chart( position, uv, a, b, c ) {

	const p = [ a, b, c ].map( ( vertex ) => [ position.getX( vertex ), position.getY( vertex ), position.getZ( vertex ) ] );
	const t = [ a, b, c ].map( ( vertex ) => [ uv.getX( vertex ), uv.getY( vertex ) ] );
	const du1 = t[ 1 ][ 0 ] - t[ 0 ][ 0 ], dv1 = t[ 1 ][ 1 ] - t[ 0 ][ 1 ], du2 = t[ 2 ][ 0 ] - t[ 0 ][ 0 ], dv2 = t[ 2 ][ 1 ] - t[ 0 ][ 1 ];
	const det = du1 * dv2 - du2 * dv1;
	const repeat = [ 0, 1 ].map( ( axis ) => Math.floor( ( t[ 0 ][ axis ] + t[ 1 ][ axis ] + t[ 2 ][ axis ] ) / 3 ) );
	// A triangle with no UV area cannot say where its chart starts; it stands on its first corner.
	if ( Math.abs( det ) < 1e-12 ) return [ ...p[ 0 ], ...repeat, 0, 0, 0, 0, 0, 0 ];
	const alongU = [], alongV = [];
	const point = [ 0, 1, 2 ].map( ( axis ) => {

		const e1 = p[ 1 ][ axis ] - p[ 0 ][ axis ], e2 = p[ 2 ][ axis ] - p[ 0 ][ axis ];
		alongU[ axis ] = ( e1 * dv2 - e2 * dv1 ) / det;
		alongV[ axis ] = ( e2 * du1 - e1 * du2 ) / det;
		return p[ 0 ][ axis ] - alongU[ axis ] * t[ 0 ][ 0 ] - alongV[ axis ] * t[ 0 ][ 1 ];

	} );

	return [ ...point, ...repeat, ...alongU, ...alongV ];

}

/** An attribute with an array of its own, read out of an interleaved buffer where it shares one. */
function owned( attribute ) {

	if ( ! attribute.isInterleavedBufferAttribute ) return attribute;
	const values = new Float32Array( attribute.count * attribute.itemSize );
	for ( let i = 0; i < attribute.count; i ++ ) for ( let c = 0; c < attribute.itemSize; c ++ ) values[ i * attribute.itemSize + c ] = attribute.getComponent( i, c );

	return new BufferAttribute( values, attribute.itemSize );

}

const record = ( value ) => value !== null && typeof value === 'object' && ! Array.isArray( value );
