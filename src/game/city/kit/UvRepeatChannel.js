import { Vector4 } from 'three/webgpu';
import { drawIndex, instanceIndex, int, ivec2, replaceDefaultUV, textureLoad, textureSize, varying } from 'three/tsl';
import { FillChannel } from './FillChannel.js';

const CHANNEL = Symbol.for( 'urbe.uv-repeat' );
const value = new Vector4( 1, 1, 0, 0 );

/** One repeat pair per module instance. Geometry and materials stay shared. */
export class UvRepeatChannel extends FillChannel {
    attach( mesh ) { mesh[ CHANNEL ] = this; return this; }
    set( slot, repeat = [ 1, 1 ] ) { super.set( slot, value.set( repeat[ 0 ], repeat[ 1 ], 0, 0 ) ); }
}

/** Repeats every authored surface map, including normals/roughness, at its metre scale.
 * Lookup textures (batch indices and room lighting) keep their explicit UVs. */
export function moduleUvContext( material ) {
    const maps = new Set( [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap' ].map( key => material[ key ] ).filter( Boolean ) );
    return replaceDefaultUV( ( node, builder ) => {
        const channel = builder.object[ CHANNEL ];
        if ( ! channel || ! maps.has( node.value ) ) return null;
        const index = builder.object.isBatchedMesh && builder.getDrawIndex() !== null ? drawIndex : instanceIndex;
        const slot = builder.object.isBatchedMesh ? texel( builder.object._indirectTexture, index ).x : index;
        const repeat = varying( texel( channel.texture, slot ).xy );
        return node.getDefaultUV().mul( repeat );
    } );
}

function texel( data, id ) {
    const size = int( textureSize( textureLoad( data ), 0 ).x ), index = int( id );
    return textureLoad( data, ivec2( index.mod( size ), index.div( size ) ) );
}
