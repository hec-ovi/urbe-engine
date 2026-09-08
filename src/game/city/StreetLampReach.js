/** Exact uncovered intervals along a route, indexed by fixture range. */
export class Reach {

	constructor( cell ) {

		this.cell = cell;
		this.cells = new Map();

	}

	add( x, z, range ) {

		const key = `${Math.floor( x / this.cell )}:${Math.floor( z / this.cell )}`;

		if ( ! this.cells.has( key ) ) this.cells.set( key, [] );

		this.cells.get( key ).push( { x, z, range } );

	}

	/** @returns the uncovered intervals of the line, as [from, to] distances along it. */
	gaps( ax, az, ux, uz, length ) {

		const spans = [];

		for ( const light of this.#around( ax, az, ax + ux * length, az + uz * length ) ) {

			const dx = light.x - ax;
			const dz = light.z - az;
			const along = dx * ux + dz * uz;
			const half = light.range * light.range - ( dx * dx + dz * dz - along * along );

			if ( half > 0 ) spans.push( [ along - Math.sqrt( half ), along + Math.sqrt( half ) ] );

		}

		spans.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );

		const gaps = [];
		let at = 0;

		for ( const [ from, to ] of spans ) {

			if ( from > at ) gaps.push( [ at, Math.min( from, length ) ] );

			at = Math.max( at, to );

			if ( at >= length ) return gaps;

		}

		gaps.push( [ at, length ] );

		return gaps;

	}

	/** Every fixture filed near the box the line spans, one cell of slack around it. */
	#around( ax, az, bx, bz ) {

		const found = [];
		const x0 = Math.floor( Math.min( ax, bx ) / this.cell ) - 1;
		const x1 = Math.floor( Math.max( ax, bx ) / this.cell ) + 1;
		const z0 = Math.floor( Math.min( az, bz ) / this.cell ) - 1;
		const z1 = Math.floor( Math.max( az, bz ) / this.cell ) + 1;

		for ( let cx = x0; cx <= x1; cx ++ ) {

			for ( let cz = z0; cz <= z1; cz ++ ) {

				for ( const light of this.cells.get( `${cx}:${cz}` ) ?? [] ) found.push( light );

			}

		}

		return found;

	}

}
