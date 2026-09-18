import { attribute, clamp, dFdx, dFdy, floor, fract, mix, mx_noise_float, positionWorld, sin, smoothstep, texture, uv, vec2 } from 'three/tsl';

/** Authored UVs, a shared world-space asphalt sampling frame, and what each copy asks for itself. */
export class NativeSamples {
	constructor( surface, asphalt, getTexture, { instances = null, scanCells = null } = {} ) {
		this.surface = surface;
		this.asphalt = asphalt;
		this.getTexture = getTexture;
		this.uv = surface.uv.mode === 'world-xz' ? positionWorld.xz.div( vec2( ...surface.uv.scale ) )
			: surface.uv.mode === 'metres' ? uv().div( vec2( ...surface.uv.scale ) ) : uv();
		this.height = attribute( '_street_height', 'float' );
		// The pieces bake a neutral wear field and each placement carries the
		// amount sampled where it stands, so the two add up on the surface.
		const baked = attribute( '_street_wear', 'float' );
		this.wear = instances ? clamp( baked.add( instances.wear ), 0, 1 ) : baked;
		this.text = instances?.text ?? null;
		this.scan = instances?.scan && scanCells ? {
			uv: this.uv.mul( instances.scan.scale ).add( instances.scan.offset ),
			cells: scanCells.map( cell => coordinates => texture( this.getTexture( cell.maps.basecolor ), coordinates ) )
		} : null;
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
