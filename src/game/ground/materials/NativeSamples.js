import { InterpolationSamplingMode, InterpolationSamplingType } from 'three/webgpu';
import { attribute, clamp, dFdx, dFdy, floor, fract, int, max, mix, mx_noise_float, positionWorld, sin, smoothstep, texture, uint, varying, vec2, vec4, uv } from 'three/tsl';
import { VARIANT_MAPS, variantFraction } from './StreetVariants.js';
import { cellLayer } from './VariantColoring.js';

/** Authored UVs, a shared world-space asphalt sampling frame, and what each copy asks for itself. */
export class NativeSamples {
	/** @param response a surface whose maps answer this one's roughness and colour response, read in world metres (road paint) */
	/** @param worldUv a metre-mapped surface on a scaled part reads world metres at its own scale instead of its UVs */
	/** @param variant `{ set, arrays, seed }` the whole-bundle variants this surface draws its four maps from ([StreetVariants](StreetVariants.js)) */
	constructor( surface, asphalt, getTexture, { instances = null, scanCells = null, response = null, worldUv = false, variant = null } = {} ) {
		this.surface = surface;
		this.asphalt = asphalt;
		this.getTexture = getTexture;
		/** Whether `uv` runs in world metres, so its normals decode in the world's frame and not the UV chart's. */
		this.world = surface.uv.mode === 'world-xz' || worldUv;
		this.uv = this.world ? positionWorld.xz.div( vec2( ...( surface.uv.scale ?? [ 1, 1 ] ) ) )
			: surface.uv.mode === 'metres' ? uv().div( vec2( ...surface.uv.scale ) ) : uv();
		this.height = attribute( '_street_height', 'float' );
		// The pieces bake a neutral wear field and each placement carries the
		// amount sampled where it stands, so the two add up on the surface.
		const baked = attribute( '_street_wear', 'float' );
		this.wear = instances ? clamp( baked.add( instances.wear ), 0, 1 ) : baked;
		this.text = instances?.text ?? null;
		this.response = response ? slot => texture( this.getTexture( response.maps[ slot ] ), positionWorld.xz.div( vec2( ...( response.uv.scale ?? [ 1, 1 ] ) ) ) ) : null;
		this.responseParameters = response?.parameters ?? null;
		this.scan = instances?.scan && scanCells ? {
			uv: this.uv.mul( instances.scan.scale ).add( instances.scan.offset ),
			cells: scanCells.map( cell => coordinates => texture( this.getTexture( cell.maps.basecolor ), coordinates ) )
		} : null;
		this.variant = variant ? this.#variant( variant, instances ) : null;
	}
	map( slot, coordinates = this.uv ) {
		if ( this.variant && VARIANT_MAPS.includes( slot ) ) return this.variant( slot, coordinates );
		return texture( this.getTexture( this.surface.maps[ slot ] ), coordinates );
	}
	road( slot ) {
		const p = this.asphalt;
		const q = positionWorld.xz.div( vec2( ...p.scale ) );
		const region = mx_noise_float( positionWorld.mul( p.regionScale ) ).mul( p.regionGain ).add( p.regionBias );
		const index = floor( region );
		const frequency = vec2( ...p.offsetFrequency );
		const a = sin( frequency.mul( index ) ).mul( p.offsetGain );
		const b = sin( frequency.mul( index.add( 1 ) ) ).mul( p.offsetGain );
		const blend = smoothstep( ...p.blendRange, fract( region ) );
		return mix( this.map( slot, q.add( a ) ).grad( dFdx( q ), dFdy( q ) ),
			this.map( slot, q.add( b ) ).grad( dFdx( q ), dFdy( q ) ), blend );
	}

	/**
	 * The four maps of one variant, the one this fragment's panel or world cell
	 * draws: a panel the variant coloured for it, which its copy's row carries
	 * by its `_street_panel` number; a world cell the half of the set its
	 * parity draws from, by the surface's `world` prefix hashed with floor of
	 * its sample coordinate ([VariantColoring](VariantColoring.js)). Without
	 * either it draws the set's fallback. Basecolor comes from the colour
	 * array; the normal's X and Y, roughness and AO from the packed response
	 * array, the normal's Z rebuilt.
	 */
	#variant( { set, arrays, seed }, instances ) {
		let layer = int( set.fallback );
		if ( set.unit === 'world-cell' || this.world ) {
			const cell = floor( this.uv ).toConst();
			layer = cellLayer( set, variantFraction( uint( seed ), [ uint( int( cell.x ) ), uint( int( cell.y ) ) ] ), cell.x, cell.y );
		} else if ( instances?.variant ) {
			const panel = varying( attribute( '_street_panel', 'float' ) ).setInterpolation( InterpolationSamplingType.FLAT, InterpolationSamplingMode.EITHER );
			layer = instances.variant.layer( floor( panel.add( 0.5 ) ) );
		}
		layer = layer.toConst();
		return ( slot, coordinates ) => {
			if ( slot === 'basecolor' ) return texture( arrays.color, coordinates ).depth( layer );
			const packed = texture( arrays.response, coordinates ).depth( layer );
			if ( slot === 'roughness' ) return vec4( packed.b );
			if ( slot === 'ao' ) return vec4( packed.a );
			const xy = packed.rg.mul( 2 ).sub( 1 );
			const z = max( xy.dot( xy ).oneMinus(), 0 ).sqrt();
			return vec4( packed.rg, z.mul( 0.5 ).add( 0.5 ), 1 );
		};
	}
}
