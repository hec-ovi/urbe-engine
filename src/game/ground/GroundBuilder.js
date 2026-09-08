import { GroundRegions } from './GroundRegions.js';
import { GroundMeshBuilder } from './GroundMeshBuilder.js';
import { GroundStream } from './GroundStream.js';

export { SIDEWALK_HEIGHT } from './GroundMeshBuilder.js';

/** Authored ground for bounded previews or spatially streamed cities. */
export class GroundBuilder {

	static regionFootprints( atlas, band ) { return new GroundRegions( atlas ).footprints( band ); }

	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	build() { return new GroundMeshBuilder( this.atlas, this.factory ).build(); }

	stream( options ) { return new GroundStream( this.atlas, this.factory, options ); }

}
