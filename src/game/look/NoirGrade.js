import { dot, mix, smoothstep, uv, vec3, vec4 } from 'three/tsl';

export const NOIR = Object.freeze( { saturation: 0.72, vignette: 0.16 } );

/** One composition pass: restrained chroma and cool shadows on linear HDR, the tone response, then a soft vignette. */
export function noirGrade( hdr ) {

	const luminance = dot( hdr.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	const muted = mix( vec3( luminance ), hdr.rgb, NOIR.saturation );
	const cool = muted.mul( vec3( 0.91, 0.99, 1.06 ) );
	const vignette = smoothstep( 0.2, 0.72, uv().sub( 0.5 ).length() ).mul( NOIR.vignette ).oneMinus();
	const output = vec4( cool, hdr.a ).renderOutput();
	return vec4( output.rgb.mul( vignette ), output.a );

}
