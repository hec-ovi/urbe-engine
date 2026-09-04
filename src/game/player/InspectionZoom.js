const RESPONSE = 18;
const SETTLED = 0.001;

/** Time-based zoom easing preserves framing across render frame rates. */
export class InspectionZoom {

	constructor( camera ) {

		this.camera = camera;

	}

	update( delta, held, active ) {

		const target = active && held ? 2 : 1;
		const current = this.camera.zoom;
		const eased = active ? target + ( current - target ) * Math.exp( - RESPONSE * Math.max( 0, delta ) ) : 1;
		const next = Math.abs( eased - target ) < SETTLED ? target : eased;
		if ( next === current ) return;
		this.camera.zoom = next;
		this.camera.updateProjectionMatrix();

	}

}
