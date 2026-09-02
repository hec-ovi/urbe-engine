/**
 * What the renderer built for itself in the frame that just ended.
 *
 * A material draws for the first time and the backend links its program right
 * there, on the frame that wanted it; a map reaches a shader for the first time
 * and the whole mip chain uploads the same way. On WebGL2 both are blocking
 * calls, and either can be the whole of a freeze that the world's own notes
 * cannot explain, because the world did nothing: it just looked at something
 * new. The renderer counts its live programs and textures, so the difference
 * across a frame names that work exactly.
 *
 * Only growth is reported. Dropping a floor disposes textures and programs, and
 * a negative difference is a release, not a cost.
 */
export class RenderWork {

	/** @param info `renderer.info`, whose `memory` counters this reads */
	constructor( info ) {

		this.info = info;
		this.programs = info?.memory?.programs ?? 0;
		this.textures = info?.memory?.textures ?? 0;

	}

	/**
	 * @returns a note for the frame that just ended, or null when the renderer
	 * built nothing new in it
	 */
	since() {

		const memory = this.info?.memory;

		if ( ! memory ) return null;

		const programs = memory.programs - this.programs;
		const textures = memory.textures - this.textures;

		this.programs = memory.programs;
		this.textures = memory.textures;

		const built = [];

		if ( programs > 0 ) built.push( `${programs} shader${programs === 1 ? '' : 's'} linked` );
		if ( textures > 0 ) built.push( `${textures} texture${textures === 1 ? '' : 's'} uploaded` );

		return built.length ? built.join( ', ' ) : null;

	}

}
