import { ImageLoader } from 'three/webgpu';

/** Retains PNG row orientation for Texture.flipY=true. */
export async function decodeNativeTexture( bytes ) {
	const url = URL.createObjectURL( new Blob( [ bytes ], { type: 'image/png' } ) );
	try { return await new ImageLoader().loadAsync( url ); }
	finally { URL.revokeObjectURL( url ); }
}
