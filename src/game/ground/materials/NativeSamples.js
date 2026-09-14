import { attribute, dFdx, dFdy, floor, fract, mix, mx_noise_float, positionWorld, sin, smoothstep, texture, uv, vec2 } from 'three/tsl';

/** Authored UVs and a shared world-space asphalt sampling frame. */
export class NativeSamples {
	constructor( surface, asphalt, getTexture ) {
		this.surface = surface;
		this.asphalt = asphalt;
		this.getTexture = getTexture;
		this.uv = surface.uv.mode === 'world-xz' ? positionWorld.xz.div( vec2( ...surface.uv.scale ) )
			: surface.uv.mode === 'metres' ? uv().div( vec2( ...surface.uv.scale ) ) : uv();
		this.wear = attribute( '_street_wear', 'float' );
		this.height = attribute( '_street_height', 'float' );
	}
	map( slot, coordinates = this.uv ) {
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
}
