import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three/webgpu';
import { attribute, faceDirection, float, Fn, mix, normalView, positionView, smoothstep, texture } from 'three/tsl';

// A 5 cm fabric tile. Six 128² layers share one 512 KiB mipmapped texture.
// R: dye variation, G: roughness variation, B: yarn height, A: inter-yarn occlusion.
// It is made once, before the garment's first upload; changing clothes/colours
// neither rebakes it nor adds a draw. Coordinates stay on the skinned rest surface.
export const TEXTILE_SIZE = 128;
export const TEXTILE_LAYERS = [ 'canvas', 'jersey', 'rib-knit', 'twill', 'ripstop', 'leather' ];
let atlas;

const WOVEN = {
	'top-tee': 1, 'top-tank': 1, 'top-turtleneck': 2, 'jacket-bomber': 4,
	'pants-leggings': 1, 'pants-joggers': 1, 'pants-chinos': 3,
	'pants-office': 3, 'office-jacket': 3, 'vest-tailored': 3
};

/** Deterministic, wrapping textile masters; independent of a renderer/DOM. */
export function textilePixels( size = TEXTILE_SIZE ) {

	const pixels = new Uint8Array( size * size * TEXTILE_LAYERS.length * 4 );
	const tau = Math.PI * 2;
	const wave = ( x ) => Math.cos( x * tau );
	const grain = ( u, v ) => ( wave( u * 3 + v * 2 + 0.17 ) * 0.46
		+ wave( u * 7 - v * 5 + 0.61 ) * 0.28 + wave( u * 19 + v * 13 + 0.32 ) * 0.16
		+ wave( u * 37 - v * 29 + 0.91 ) * 0.1 );
	for ( let layer = 0; layer < TEXTILE_LAYERS.length; layer ++ ) {

		for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {

			const u = ( x + 0.5 ) / size, v = ( y + 0.5 ) / size;
			const yarnX = ( wave( u * 32 ) + 1 ) * 0.5;
			const yarnY = ( wave( v * 32 ) + 1 ) * 0.5;
			const cross = ( Math.floor( u * 32 ) + Math.floor( v * 32 ) ) % 2;
			const slub = grain( u, v );
			let height, dye, rough;
			if ( layer === 0 ) {

				height = cross ? yarnX * 0.7 + yarnY * 0.15 : yarnY * 0.7 + yarnX * 0.15;
				dye = height * 0.38 + slub * 0.13;
				rough = 0.15 - height * 0.24 + slub * 0.08;

			} else if ( layer === 1 || layer === 2 ) {

				const row = wave( v * 24 );
				const loops = ( wave( u * 24 + row * 0.16 ) + 1 ) * 0.5;
				const ribs = layer === 2 ? ( wave( u * 12 ) + 1 ) * 0.22 : 0;
				height = loops * 0.48 + ( row + 1 ) * 0.1 + ribs;
				dye = height * 0.3 + slub * 0.08;
				rough = 0.13 - height * 0.12 + slub * 0.12;

			} else if ( layer === 3 ) {

				const over = ( Math.floor( u * 32 ) - Math.floor( v * 32 ) + 32 ) % 4 < 3;
				height = over ? yarnX * 0.74 + yarnY * 0.12 : yarnY * 0.74 + yarnX * 0.12;
				dye = ( over ? 0.13 : - 0.08 ) + height * 0.2 + slub * 0.1;
				rough = 0.12 - height * 0.28 + slub * 0.08;

			} else if ( layer === 4 ) {

				const reinforced = Math.pow( ( wave( u * 8 ) + 1 ) * 0.5, 14 )
					+ Math.pow( ( wave( v * 8 ) + 1 ) * 0.5, 14 );
				height = ( cross ? yarnX : yarnY ) * 0.45 + Math.min( 1, reinforced ) * 0.4;
				dye = height * 0.2 + slub * 0.1;
				rough = 0.1 - height * 0.32 + slub * 0.1;

			} else {

				const pores = pebble( u, v, 36 );
				height = 0.24 + pores * 0.58 + slub * 0.025;
				dye = slub * 0.035 + pores * 0.075;
				rough = slub * 0.06 - pores * 0.16;

			}
			const i = ( layer * size * size + y * size + x ) * 4;
			pixels[ i ] = byte( 0.43 + dye );
			pixels[ i + 1 ] = byte( 0.5 + rough );
			pixels[ i + 2 ] = byte( height );
			pixels[ i + 3 ] = byte( 0.84 + height * 0.16 );

		}

	}
	return pixels;

}

function byte( value ) { return Math.round( Math.max( 0, Math.min( 1, value ) ) * 255 ); }

function pebble( u, v, count ) {

	const wrap = ( x ) => ( x % count + count ) % count;
	const hash = ( x, y, seed ) => {

		let n = Math.imul( wrap( x ) + seed, 374761393 ) ^ Math.imul( wrap( y ) + seed, 668265263 );
		n = Math.imul( n ^ n >>> 13, 1274126177 );
		return ( ( n ^ n >>> 16 ) >>> 0 ) / 4294967296;

	};
	const x = u * count, y = v * count, ix = Math.floor( x ), iy = Math.floor( y );
	let near = Infinity, next = Infinity;
	for ( let oy = - 1; oy <= 1; oy ++ ) for ( let ox = - 1; ox <= 1; ox ++ ) {

		const px = ix + ox, py = iy + oy;
		const dx = px + 0.15 + hash( px, py, 7 ) * 0.7 - x;
		const dy = py + 0.15 + hash( px, py, 31 ) * 0.7 - y;
		const distance = dx * dx + dy * dy;
		if ( distance < near ) { next = near; near = distance; }
		else if ( distance < next ) next = distance;

	}
	const edge = Math.min( 1, ( Math.sqrt( next ) - Math.sqrt( near ) ) / 0.15 );
	return edge * edge * ( 3 - 2 * edge ) * ( 1 - Math.min( 0.45, near * 0.5 ) );

}

function textileAtlas() {

	if ( atlas ) return atlas;
	atlas = new DataArrayTexture( textilePixels(), TEXTILE_SIZE, TEXTILE_SIZE, TEXTILE_LAYERS.length );
	atlas.name = 'garment-textile-response';
	atlas.wrapS = atlas.wrapT = RepeatWrapping;
	atlas.magFilter = LinearFilter;
	atlas.minFilter = LinearMipmapLinearFilter;
	atlas.generateMipmaps = true;
	atlas.anisotropy = 2;
	atlas.needsUpdate = true;
	return atlas;

}

/** One shared sample graph supplies dye, roughness and normal relief. */
export function textileResponse( id, fabric ) {

	const footwear = /^(boots|shoes|sneakers)-/.test( id );
	const woven = WOVEN[ id ] ?? 0;
	const technical = id === 'pants-leggings' ? 5 : /top-(tee|tank|turtleneck)|pants-joggers/.test( id ) ? woven : 4;
	const layer = footwear ? float( id.startsWith( 'sneakers-' ) ? 1 : 5 )
		: mix( mix( float( technical ), float( woven ), fabric.equal( 1 ) ), float( 5 ), fabric.equal( 2 ) );
	const map = texture( textileAtlas() );
	return Fn( () => {

		// garmentSurface is measured in body-height shares (~1.8 m), not UVs.
		const p = attribute( 'garmentSurface', 'vec3' ).mul( 36 ).toVar();
		const n = attribute( 'garmentNormal', 'vec3' ).abs().pow( 4 ).toVar();
		const weight = n.div( n.x.add( n.y ).add( n.z ).max( 0.0001 ) ).toVar();
		return map.sample( p.yz ).depth( layer ).mul( weight.x )
			.add( map.sample( p.xz ).depth( layer ).mul( weight.y ) )
			.add( map.sample( p.xy ).depth( layer ).mul( weight.z ) );

	} )();

}

/** Physical-height surface gradient on the posed skin, without tangent UVs. */
export const textileNormal = Fn( ( [ height ] ) => {

	const dx = positionView.dFdx().toVar(), dy = positionView.dFdy().toVar();
	const n = normalView.toVar();
	const r1 = dy.cross( n ).toVar(), r2 = n.cross( dx ).toVar();
	const det = dx.dot( r1 ).mul( faceDirection ).toVar();
	const gradient = r1.mul( height.dFdx() ).add( r2.mul( height.dFdy() ) ).mul( det.sign() );
	return n.mul( det.abs().max( 1e-12 ) ).sub( gradient ).normalize();

} );

/** Soft polishing at contacts; no dark noise sprayed over the whole outfit. */
export function garmentWear( id, p, shares ) {

	const line = ( value, width ) => smoothstep( width, width * 2, value.abs() ).oneMinus();
	if ( id.startsWith( 'pants-' ) ) return line( p.y.sub( 0.29 ), 0.032 ).mul( 0.6 )
		.add( line( p.y.sub( id === 'pants-shorts' ? 0.36 : 0.09 ), 0.009 ).mul( 0.45 ) ).clamp( 0, 1 );
	if ( /^(boots|shoes|sneakers)-/.test( id ) ) return line( p.y.sub( 0.028 ), 0.01 ).mul( 0.7 );
	return shares.y.mul( line( p.x.abs().sub( 0.26 ), 0.019 ) ).mul( 0.45 )
		.add( line( p.y.sub( id === 'jacket-cropped' ? 0.64 : id === 'jacket-bomber' ? 0.61 : 0.575 ), 0.008 ).mul( 0.5 ) ).clamp( 0, 1 );

}
