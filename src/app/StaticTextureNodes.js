import { TextureNode } from 'three/webgpu';
import { NodeUpdateType } from 'three/tsl';

/**
 * A texture that can never need its image flipped keeps no per-draw update.
 *
 * On the WebGL2 backend three 0.185.1 gives every texture sample a `flipY`
 * uniform (TextureNode.setupUV), and a node carrying one updates per object:
 * before every draw of every object, each texture node its material samples
 * recomputes whether its texture is an ImageBitmap uploaded with `flipY`, or
 * a render target, framebuffer or depth texture. That flag is false for every
 * other texture and never changes for one whose `flipY` is off, which is what
 * every map this engine loads is (glTF textures, the material factory's maps,
 * data textures). Tens of thousands of such updates a frame were a sixth of
 * the time the renderer spent drawing the city.
 *
 * So when a texture node is built, one that samples a plain texture with
 * `flipY` off and no uv transform keeps its uniform at false and asks for no
 * update, and the builder leaves it out of the per-object list. Anything else,
 * a render target, a flipped image, a transformed map, keeps three's update.
 * WebGPU never adds the uniform and is not touched.
 *
 * It reads two of three's private fields, `_flipYUniform` and
 * `_matrixUniform`; StaticTextureNodes.test.js checks they are still there,
 * so a three upgrade that renames them fails a test rather than a frame. The
 * one thing it cannot see coming is a material swapping in, after it was
 * built, a texture that does need flipping: nothing in the engine does.
 */
export function installStaticTextureNodes() {

	if ( TextureNode.prototype.getUpdateType.staticFlip ) return;

	const getUpdateType = TextureNode.prototype.getUpdateType;
	const staticAware = function () {

		if ( this.updateType === NodeUpdateType.OBJECT && neverFlips( this ) ) {

			this._flipYUniform.value = false;
			return NodeUpdateType.NONE;

		}

		return getUpdateType.call( this );

	};
	staticAware.staticFlip = true;
	TextureNode.prototype.getUpdateType = staticAware;

}

/** Whether a texture node's only per-object work is a flipY flag that is always false. */
export function neverFlips( node ) {

	const texture = node.value;

	return node._flipYUniform != null && node._matrixUniform === null
		&& texture?.isTexture === true && texture.flipY === false
		&& texture.isRenderTargetTexture !== true && texture.isFramebufferTexture !== true && texture.isDepthTexture !== true;

}
