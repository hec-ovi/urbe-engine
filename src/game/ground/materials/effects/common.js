import { clamp, mix, normalMap, vec2 } from 'three/tsl';

export const bounded = ( node, range ) => clamp( node, ...range );
export const normal = ( node, strength ) => normalMap( node.rgb, vec2( strength ) );
export const ambient = ( node, strength ) => mix( 1, node.r, strength );
