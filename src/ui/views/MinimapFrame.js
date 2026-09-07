/** One display transform keeps the baked city and live marks facing forward. */
export class MinimapFrame {
	constructor( bake, position, heading, centre ) {
		this.bake = bake;
		this.origin = bake.toPixels( position.x, position.z );
		this.heading = heading;
		this.centre = centre;
		this.cos = Math.cos( heading );
		this.sin = Math.sin( heading );
	}
	toScreen( x, z ) {
		const [ px, pz ] = this.bake.toPixels( x, z );
		const dx = px - this.origin[ 0 ], dz = pz - this.origin[ 1 ];
		return [ this.centre + dx * this.cos - dz * this.sin, this.centre + dx * this.sin + dz * this.cos ];
	}
	paintCity( context ) {
		context.save();
		context.translate( this.centre, this.centre );
		context.rotate( this.heading );
		context.drawImage( this.bake.canvas, - this.origin[ 0 ], - this.origin[ 1 ] );
		context.restore();
	}
	paintNorth( context, label, inset ) {
		const radius = this.centre - inset;
		context.font = 'bold 11px ui-monospace, monospace';
		context.textAlign = 'center'; context.textBaseline = 'middle';
		context.fillText( label, this.centre + this.sin * radius, this.centre - this.cos * radius );
	}
}
