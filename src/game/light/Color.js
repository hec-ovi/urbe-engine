import * as THREE from 'three/webgpu';

/** Relative luminance, the one number that says how bright a colour is. */
export function luminance( color ) {

	return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

}

/**
 * Colour temperature to light colour. Every published fixture states a
 * blackbody temperature in kelvin and three ships no converter, so this walks
 * the Planckian locus (Krystek's uv approximation) through CIE XYZ into linear
 * sRGB and normalises to the brightest channel: the colour carries the hue,
 * the light's power carries the level.
 *
 * Warm against cold is what makes a dark frame readable, so this is the one
 * conversion the whole night look leans on.
 */
export function kelvinColor( kelvin, target = new THREE.Color() ) {

	const t = Math.min( 15000, Math.max( 1000, kelvin ) );
	const t2 = t * t;

	const u = ( 0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2 )
		/ ( 1 + 8.42420235e-4 * t + 7.08145163e-7 * t2 );
	const v = ( 0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2 )
		/ ( 1 - 2.89741816e-5 * t + 1.61456053e-7 * t2 );

	const d = 2 * u - 8 * v + 4;
	const x = 3 * u / d;
	const y = 2 * v / d;

	const X = x / y;
	const Z = ( 1 - x - y ) / y;

	const r = Math.max( 0, 3.2406 * X - 1.5372 - 0.4986 * Z );
	const g = Math.max( 0, - 0.9689 * X + 1.8758 + 0.0415 * Z );
	const b = Math.max( 0, 0.0557 * X - 0.2040 + 1.0570 * Z );
	const peak = Math.max( r, g, b, 1e-6 );

	return target.setRGB( r / peak, g / peak, b / peak, THREE.LinearSRGBColorSpace );

}
