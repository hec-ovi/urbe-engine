import { dot, float, fract, mix, screenCoordinate, sin, smoothstep, time, uv, vec3, vec4 } from 'three/tsl';

export const NOIR = Object.freeze( { saturation: 0.72, grain: 0.7 / 255, vignette: 0.16 } );

/** One composition pass: restrained chroma, cool shadows and fine film texture. */
export function noirGrade( hdr, { grain = true } = {} ) {

	const luminance = dot( hdr.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	const muted = mix( vec3( luminance ), hdr.rgb, NOIR.saturation );
	const cool = muted.mul( vec3( 0.91, 0.99, 1.06 ) );
	const vignette = smoothstep( 0.2, 0.72, uv().sub( 0.5 ).length() ).mul( NOIR.vignette ).oneMinus();
	const output = vec4( cool, hdr.a ).renderOutput();
	const noise = grain ? fract( sin( dot( screenCoordinate, vec3( 12.9898, 78.233, 0 ).xy ).add( time.mul( 13 ) ) ).mul( 43758.5453 ) ).sub( 0.5 ).mul( NOIR.grain ) : float( 0 );
	return vec4( output.rgb.mul( vignette ).add( noise ), output.a );

}
