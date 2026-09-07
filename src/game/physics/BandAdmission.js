import { triangleChunks } from './TriangleChunks.js';

/** Cooks disabled pieces across frames and enables the complete band together. */
export class BandAdmission {

	constructor( physics, source ) {

		this.physics = physics;
		this.source = source;
		this.handles = [];
		this.cancelled = false;

	}

	async prepare() {

		try {

			let since = performance.now(), count = 0;
			for ( const geometry of triangleChunks( this.source ) ) {

				if ( this.cancelled ) { geometry.dispose(); return false; }
				try { this.handles.push( this.physics.addTrimesh( geometry, { enabled: false } ) ); }
				finally { geometry.dispose(); }
				if ( ++ count === 4 || performance.now() - since >= 4 ) {

					await nextFrame();
					if ( this.cancelled ) return false;
					since = performance.now();
					count = 0;

				}

			}
			if ( this.cancelled ) return false;
			for ( const handle of this.handles ) handle.body.setEnabled( true );
			return true;

		} catch ( error ) { this.cancel(); throw error; }
		finally { this.source = null; }

	}

	cancel() {

		this.cancelled = true;
		for ( const handle of this.handles ) this.physics.remove( handle );
		this.handles.length = 0;

	}

}

function nextFrame() {

	return new Promise( resolve => globalThis.requestAnimationFrame ? requestAnimationFrame( resolve ) : setTimeout( resolve, 0 ) );

}
