/**
 * Holds every program a warm-up has had the renderer build, for as long as the
 * renderer lives.
 *
 * The renderer counts the draws that use a render pipeline and each of its two
 * shader stages, and frees them with the last of those draws. A batch that
 * grows disposes its material to be rebuilt against its new buffers, a floor
 * that leaves takes its geometry with it, and either can be the last user of a
 * program: the next draw that wants it would link it again, on the frame that
 * wanted it. A pin is one more use that never leaves. After each compile every
 * pipeline the renderer holds and this has not pinned yet takes one use, on the
 * pipeline and on both of its stages, so the linked program stays cached under
 * its code and render state and the next draw that asks for it finds it.
 *
 * A plain draw's graph is keyed by its material, vertex layout and pass, never
 * by the object, so any later draw of the same material reuses it; the graphs
 * a plain draw's compile added are pinned the same way, so a floor or a scene
 * that comes back costs no graph build either. An instanced or batched draw's
 * graph is keyed by that object's own buffers and leaves with it.
 *
 * Nothing is built for a pin: no copy of a material, no geometry, no second
 * compile. What this reads are the renderer's own caches, `_pipelines.caches`
 * and `_nodes.nodeBuilderCache`; ProgramPins.test.js holds them against
 * three's own classes, so an upgrade that moves them fails there first. A
 * renderer without them (a test double, a canvas preview) pins nothing.
 */
export class ProgramPins {

	constructor() {

		this.pipelines = new WeakSet();
		this.graphs = new WeakSet();
		/** Pipelines pinned. */
		this.size = 0;

	}

	/**
	 * @param renderer the renderer that just compiled
	 * @param plain whether every draw that compile prepared is keyed without its object, so its graphs are worth keeping
	 * @returns pipelines newly pinned
	 */
	pin( renderer, plain = false ) {

		let pinned = 0;
		const caches = renderer?._pipelines?.caches;

		if ( caches instanceof Map ) for ( const pipeline of caches.values() ) {

			if ( this.pipelines.has( pipeline ) ) continue;
			this.pipelines.add( pipeline );
			pipeline.usedTimes ++;
			const stages = pipeline.isComputePipeline ? [ pipeline.computeProgram ] : [ pipeline.vertexProgram, pipeline.fragmentProgram ];
			for ( const stage of stages ) if ( stage ) stage.usedTimes ++;
			pinned ++;

		}

		const graphs = renderer?._nodes?.nodeBuilderCache;

		if ( graphs instanceof Map ) for ( const state of graphs.values() ) {

			if ( this.graphs.has( state ) ) continue;
			this.graphs.add( state );
			if ( plain ) state.usedTimes ++;

		}

		this.size += pinned;

		return pinned;

	}

}

/** Whether a renderable's graph is keyed without the object itself (ProgramKey.js). */
export function plainDraw( node ) {

	return ! ( node.isInstancedMesh || node.isBatchedMesh || node.count > 1 );

}
