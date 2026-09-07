/** Bounded local reports assembled once per second, outside individual subsystem work. */
export class FrameReports {

	constructor( send, snapshot ) {

		this.send = send;
		this.snapshot = snapshot;
		this.last = 0;
		this.gaps = [];
		this.hitches = [];

	}

	frame( now, gapMs, notes ) {

		this.gaps.push( gapMs );
		if ( gapMs > 40 ) {

			this.hitches.push( { ms: gapMs, notes: [ ...notes ] } );
			if ( this.hitches.length > 20 ) this.hitches.shift();

		}
		if ( now - this.last < 1000 ) return;
		this.last = now;
		const gaps = this.gaps.sort( ( a, b ) => a - b );
		try {

			this.send( {
				...this.snapshot(), at: Date.now(),
				frames: { count: gaps.length, median: gaps[ Math.floor( gaps.length * 0.5 ) ], p95: gaps[ Math.floor( gaps.length * 0.95 ) ], worst: gaps.at( - 1 ) },
				hitches: this.hitches
			} );

		} catch ( error ) {

			console.warn( `performance report: ${error.message}` );

		}
		this.gaps = [];
		this.hitches = [];

	}

}
