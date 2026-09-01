/**
 * Deterministic PRNG (mulberry32). Same seed, same sequence, on every platform.
 */
export class Rng {

	constructor( seed ) {

		this.state = seed >>> 0;

	}

	/** Float in [0, 1). */
	next() {

		this.state = ( this.state + 0x6d2b79f5 ) >>> 0;
		let t = this.state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	/** Float in [min, max). */
	range( min, max ) {

		return min + ( max - min ) * this.next();

	}

	/** Index into a weights array, picked proportionally. */
	pickWeighted( weights ) {

		let total = 0;
		for ( const w of weights ) total += w;
		let r = this.next() * total;
		for ( let i = 0; i < weights.length; i ++ ) {

			r -= weights[ i ];
			if ( r < 0 ) return i;

		}

		return weights.length - 1;

	}

}
