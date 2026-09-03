import { el } from '../components/dom.js';
import { MapPainter } from './MapPainter.js';

const PAD = 40;

/**
 * The whole city drawn once into an offscreen canvas at a fixed scale, so a
 * redraw is one image copy however big the city is. Both maps use one.
 */
export class CityBake {

	constructor( { bounds, roads, blocks, transit }, pixelsPerMetre ) {

		this.pixelsPerMetre = pixelsPerMetre;
		this.origin = [ bounds.min[ 0 ] - PAD, bounds.min[ 1 ] - PAD ];
		this.canvas = el( 'canvas', {
			width: Math.ceil( ( bounds.max[ 0 ] - bounds.min[ 0 ] + PAD * 2 ) * pixelsPerMetre ),
			height: Math.ceil( ( bounds.max[ 1 ] - bounds.min[ 1 ] + PAD * 2 ) * pixelsPerMetre )
		} );

		this.context = this.canvas.getContext( '2d' );
		MapPainter.city(
			this.context,
			{ roads, blocks, transit },
			( x, z ) => this.toPixels( x, z ),
			pixelsPerMetre,
			this.canvas.width,
			this.canvas.height
		);

	}

	/** World metres to pixels inside the baked image. */
	toPixels( x, z ) {

		return [
			( x - this.origin[ 0 ] ) * this.pixelsPerMetre,
			( z - this.origin[ 1 ] ) * this.pixelsPerMetre
		];

	}

}
