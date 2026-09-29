/**
 * Leaves out of a frame the objects that would draw nothing in it.
 *
 * Three hands every visible object in a render list to the backend: it
 * refreshes the object's nodes, uniforms and bindings, and only then does the
 * draw find there is nothing to draw. Most of the city is shared draws that
 * cannot be frustum tested whole, so that happens to a great many objects
 * every frame: an instanced furniture part with no copies left, a car model
 * nobody drives, a batch whose copies are all behind the camera. Each costs
 * what a real draw costs on the CPU, which on WebGL2 is the frame.
 *
 * This render object function skips two kinds before any of that work:
 *
 * - an instanced mesh with a count of 0;
 * - a batch that culls its own copies against the pass's camera
 *   (`cullsBeforeDraw`, see SphereCulledBatch) and keeps none. It is culled
 *   here first; three's own call right after finds the same camera and
 *   nothing edited, and keeps that list without culling again.
 *
 * Only drawing goes through it: a compile, which is how a warm-up builds
 * programs, calls three's own function and still builds empty objects.
 * A shadow pass sets its own function for its duration and gets none of this.
 */
export function skipEmptyDraws( renderer ) {

	const skip = function ( object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId ) {

		if ( object.isInstancedMesh === true && object.count === 0 ) return;

		if ( object.cullsBeforeDraw === true ) {

			object.onBeforeRender( renderer, scene, camera, geometry, material, group );
			if ( object._multiDrawCount === 0 ) return;

		}

		renderer.renderObject( object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId );

	};

	renderer.setRenderObjectFunction( skip );

	return skip;

}
