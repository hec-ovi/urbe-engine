import { cameraViewMatrix, clamp, mix, normalMap, normalView, vec2, vec3, vec4 } from 'three/tsl';

export const bounded = ( node, range ) => clamp( node, ...range );
export const ambient = ( node, strength ) => mix( 1, node.r, strength );

/**
 * A tangent-space normal sample, in view space, decoded in the frame of the
 * coordinates it was read at. A UV-mapped sample follows its UV chart (three's
 * `normalMap`); a sample read at world X and Z follows world X and Z laid onto
 * the surface, so turning a piece's UV chart never turns relief sampled in the
 * world, and the tangent and bitangent run the way the sample's own U and V do.
 * @param world whether the sample was read at world X and Z
 */
export function normal( node, strength, world = false ) {

	if ( ! world ) return normalMap( node.rgb, vec2( strength ) );
	const n = node.rgb.mul( 2 ).sub( 1 );
	const N = normalView;
	const along = ( axis ) => {

		const a = cameraViewMatrix.mul( vec4( axis, 0 ) ).xyz;
		return a.sub( N.mul( N.dot( a ) ) ).normalize();

	};

	return along( vec3( 1, 0, 0 ) ).mul( n.x.mul( strength ) ).add( along( vec3( 0, 0, 1 ) ).mul( n.y.mul( strength ) ) ).add( N.mul( n.z ) ).normalize();

}
