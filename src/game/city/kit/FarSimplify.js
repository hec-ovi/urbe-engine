import { MeshoptSimplifier } from 'meshoptimizer';

/** How far, in metres, a far surface may stray from the surface it stands for. */
export const FAR_ERROR = 0.1;

/**
 * The triangles of one surface kept within FAR_ERROR of it: coplanar runs are
 * merged, collapses may cross a seam between faces, and parts smaller than the
 * error (a bolt, a sill, a mullion's end) are dropped. A producer writes each
 * face with vertices of its own, so vertices that agree on every attribute are
 * welded first, or no face could merge into its neighbour. The result draws
 * the surface's own vertices, so the far surface wears its normals and uvs,
 * and holds only the ones it draws, so the thread asking has nothing to sort.
 *
 * @param index Uint32Array or Uint16Array of triangles
 * @param count how many vertices the surface has
 * @param attributes every attribute the surface carries, the first its
 *   positions in metres (a Float32Array), each as `{ array, itemSize, stride, offset }`:
 *   component c of vertex i is `array[ i * stride + offset + c ]`
 * @returns `{ index, attributes }`: the kept triangles (a Uint32Array, empty
 *   when nothing is worth drawing) over only the vertices they draw, and each
 *   attribute's values for those vertices, in the order given, packed
 *   `itemSize` to a vertex in an array of the attribute's own type
 */
export async function simplifyFar( index, count, attributes ) {

	await MeshoptSimplifier.ready;

	const same = weld( count, attributes );
	// The simplifier reads a vertex sharing its position with another as a seam,
	// so it is handed only the welded vertices, numbered afresh.
	const kept = [];
	const renumbered = new Uint32Array( count );
	for ( let vertex = 0; vertex < count; vertex ++ ) {

		if ( same[ vertex ] === vertex ) renumbered[ vertex ] = kept.push( vertex ) - 1;

	}
	const welded = new Uint32Array( index.length );
	for ( let i = 0; i < index.length; i ++ ) welded[ i ] = renumbered[ same[ index[ i ] ] ];
	const { array, stride, offset } = attributes[ 0 ];
	const points = new Float32Array( kept.length * 3 );
	kept.forEach( ( vertex, at ) => {

		for ( let c = 0; c < 3; c ++ ) points[ at * 3 + c ] = array[ vertex * stride + offset + c ];

	} );

	const simplified = MeshoptSimplifier.simplify( welded, points, 3, 0, FAR_ERROR, [ 'ErrorAbsolute', 'Prune', 'Permissive' ] )[ 0 ];

	return drawnOnly( simplified.map( ( vertex ) => kept[ vertex ] ), attributes );

}

/** Triangles over the surface's vertices renumbered to only the ones they draw, in first use, with those vertices' values. */
function drawnOnly( triangles, attributes ) {

	const moved = new Map();
	const index = new Uint32Array( triangles.length );
	for ( let i = 0; i < triangles.length; i ++ ) {

		const vertex = triangles[ i ];
		if ( ! moved.has( vertex ) ) moved.set( vertex, moved.size );
		index[ i ] = moved.get( vertex );

	}

	return {
		index,
		attributes: attributes.map( ( { array, itemSize, stride, offset } ) => {

			const values = new array.constructor( moved.size * itemSize );
			for ( const [ vertex, at ] of moved ) {

				for ( let c = 0; c < itemSize; c ++ ) values[ at * itemSize + c ] = array[ vertex * stride + offset + c ];

			}

			return values;

		} )
	};

}

/** Each vertex's first twin: the first vertex whose bytes match it in every attribute. */
function weld( count, attributes ) {

	const views = attributes.map( ( { array, itemSize, stride, offset } ) => {

		const bytes = array.BYTES_PER_ELEMENT;

		return { bytes: new Uint8Array( array.buffer, array.byteOffset, array.byteLength ), stride: stride * bytes, offset: offset * bytes, length: itemSize * bytes };

	} );
	const size = 2 ** Math.ceil( Math.log2( Math.max( 2, count * 2 ) ) );
	const table = new Int32Array( size ).fill( - 1 );
	const same = new Uint32Array( count );

	for ( let vertex = 0; vertex < count; vertex ++ ) {

		let slot = hash( views, vertex ) & ( size - 1 );
		while ( table[ slot ] >= 0 && ! equal( views, table[ slot ], vertex ) ) slot = ( slot + 1 ) & ( size - 1 );
		if ( table[ slot ] < 0 ) table[ slot ] = vertex;
		same[ vertex ] = table[ slot ];

	}

	return same;

}

function hash( views, vertex ) {

	let value = 2166136261;
	for ( const { bytes, stride, offset, length } of views ) {

		for ( let at = vertex * stride + offset, end = at + length; at < end; at ++ ) value = Math.imul( value ^ bytes[ at ], 16777619 );

	}

	return value >>> 0;

}

function equal( views, a, b ) {

	for ( const { bytes, stride, offset, length } of views ) {

		const from = a * stride + offset, to = b * stride + offset;
		for ( let i = 0; i < length; i ++ ) if ( bytes[ from + i ] !== bytes[ to + i ] ) return false;

	}

	return true;

}
