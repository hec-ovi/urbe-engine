import { float, floor, int, mod, select } from 'three/tsl';
import { fnvWords } from './StreetVariants.js';
export { colorGraph } from './PanelGraph.js';

/**
 * Distinct neighbours (Materials `sources/street-variants/CONTRACT.md`,
 * "Required next-version adjacency behavior"): two physical units of one set
 * that share a full edge never wear the same variant.
 *
 * Panels: the whole city's panel graph is built once at load from every
 * placement's panel charts ([PanelGraph](PanelGraph.js), on a worker), two
 * panels joined where they share an edge end to end, to the centimetre (a
 * shared corner alone joins nothing), and coloured greedily in the order of
 * each panel's canonical identity: placements by `piece@x,y,z`, then the
 * surface, the part of the piece and the panel number. Each panel draws among
 * the variants none of its coloured neighbours wears, their authored weights
 * renormalised, with the fraction its own hash gives (`StreetVariants.select`'s
 * hash). A set has eight variants and a slab at most four edge neighbours, so
 * a colour is always left; were none left the panel takes its hash's choice
 * and is counted as a conflict. A copy's colours ride in its instance row.
 *
 * World cells: a cell takes its variant from one of two disjoint halves of the
 * set by the parity of its cell coordinates, so the four cells sharing its
 * edges always draw from the other half. Each condition's takes alternate
 * between the halves; a condition with one take stays in the first.
 */

/** The set's two disjoint halves for world cells, each `{ layers, cdf }`. */
export function cellHalves( set ) {

	const byCondition = new Map();
	set.layers.forEach( ( layer, index ) => {

		const condition = layer.condition ?? layer.id;
		if ( ! byCondition.has( condition ) ) byCondition.set( condition, [] );
		byCondition.get( condition ).push( index );

	} );
	const halves = [ [], [] ];
	for ( const takes of byCondition.values() ) takes.forEach( ( index, take ) => halves[ take % 2 ].push( index ) );
	const weight = ( index ) => set.cdf[ index ] - ( index ? set.cdf[ index - 1 ] : 0 );

	return halves.map( ( layers ) => {

		const total = layers.reduce( ( sum, index ) => sum + weight( index ), 0 );
		let running = 0;
		const cdf = layers.map( ( index ) => ( running += weight( index ) ) / total );
		if ( cdf.length ) cdf[ cdf.length - 1 ] = 1;
		return { layers, cdf };

	} );

}

/** The layer a world cell draws, the reference `cellLayer` reproduces. */
export function selectCell( set, prefix, cx, cz ) {

	const halves = cellHalves( set );
	const half = halves[ ( ( cx + cz ) % 2 + 2 ) % 2 ].layers.length ? halves[ ( ( cx + cz ) % 2 + 2 ) % 2 ] : halves[ 0 ];
	const u = fnvWords( prefix, [ cx, cz ] ) / 4294967296;
	const at = half.cdf.findIndex( ( edge ) => edge > u );

	return half.layers[ at < 0 ? half.layers.length - 1 : at ];

}

/**
 * The shader's world-cell layer: `u` the cell's hash fraction (float node),
 * `cx`, `cz` its integer coordinates (float nodes).
 */
export function cellLayer( set, u, cx, cz ) {

	const halves = cellHalves( set );
	const choose = ( { layers, cdf } ) => {

		let layer = int( layers[ 0 ] );
		for ( let k = 1; k < layers.length; k ++ ) layer = select( u.greaterThanEqual( cdf[ k - 1 ] ), int( layers[ k ] ), layer );
		return layer;

	};
	if ( ! halves[ 1 ].layers.length ) return choose( halves[ 0 ] );
	const odd = mod( floor( cx.add( cz ) ), 2 ).abs().greaterThan( 0.5 );

	return select( odd, choose( halves[ 1 ] ), choose( halves[ 0 ] ) );

}

/**
 * Reads a panel's colour out of the 3-bit fields a copy's row packs, eight
 * panels to a float and 32 to a texel: `texel(column)` reads the row's texel,
 * `panel` the panel number (float node).
 */
export function packedLayer( texel, column, panel ) {

	const value = texel( int( float( column ).add( floor( panel.div( 32 ) ) ) ) );
	const component = mod( floor( panel.div( 8 ) ), 4 );
	const packed = select( component.lessThan( 0.5 ), value.x, select( component.lessThan( 1.5 ), value.y, select( component.lessThan( 2.5 ), value.z, value.w ) ) );
	const shift = mod( panel, 8 );

	return int( mod( floor( packed.div( float( 8 ).pow( shift ) ) ), 8 ) );

}

/** Packs up to `limit` panel colours into a row's floats, the layout `packedLayer` reads. */
export function packColors( colors, out, at, limit = colors.length ) {

	for ( let panel = 0; panel < Math.min( colors.length, limit ); panel ++ ) {

		const slot = at + Math.floor( panel / 32 ) * 4 + Math.floor( panel / 8 ) % 4;
		out[ slot ] += colors[ panel ] * 8 ** ( panel % 8 );

	}

}
