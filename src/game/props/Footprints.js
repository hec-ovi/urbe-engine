/** XZ polygon arithmetic. Ground owners are disjoint; prop footprints are convex. */
export function area( ring ) {
	let sum = 0;
	for ( let i = 0; i < ring.length; i ++ ) { const a = ring[ i ], b = ring[ ( i + 1 ) % ring.length ]; sum += a[ 0 ] * b[ 1 ] - b[ 0 ] * a[ 1 ]; }
	return Math.abs( sum ) / 2;
}
export function bounds( ring ) {
	const result = { minX: Infinity, maxX: - Infinity, minZ: Infinity, maxZ: - Infinity };
	for ( const [ x, z ] of ring ) { result.minX = Math.min( result.minX, x ); result.maxX = Math.max( result.maxX, x ); result.minZ = Math.min( result.minZ, z ); result.maxZ = Math.max( result.maxZ, z ); }
	return result;
}
export function pointDistance( p, a, b ) {
	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const t = Math.max( 0, Math.min( 1, ( ( p[ 0 ] - a[ 0 ] ) * dx + ( p[ 1 ] - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
	return Math.hypot( p[ 0 ] - a[ 0 ] - dx * t, p[ 1 ] - a[ 1 ] - dz * t );
}
export function inside( p, ring ) {
	let value = false;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {
		const a = ring[ i ], b = ring[ j ];
		if ( pointDistance( p, a, b ) < 1e-8 ) return true;
		if ( ( a[ 1 ] > p[ 1 ] ) !== ( b[ 1 ] > p[ 1 ] ) && p[ 0 ] < ( b[ 0 ] - a[ 0 ] ) * ( p[ 1 ] - a[ 1 ] ) / ( b[ 1 ] - a[ 1 ] ) + a[ 0 ] ) value = ! value;
	}
	return value;
}
function cross( a, b, c ) { return ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] ); }
function segmentDistance( a, b, c, d ) {
	if ( cross( a, b, c ) * cross( a, b, d ) < 0 && cross( c, d, a ) * cross( c, d, b ) < 0 ) return 0;
	return Math.min( pointDistance( a, c, d ), pointDistance( b, c, d ), pointDistance( c, a, b ), pointDistance( d, a, b ) );
}
export function distance( a, b ) {
	if ( inside( a[ 0 ], b ) || inside( b[ 0 ], a ) ) return 0;
	let nearest = Infinity;
	for ( let i = 0; i < a.length; i ++ ) for ( let j = 0; j < b.length; j ++ ) nearest = Math.min( nearest, segmentDistance( a[ i ], a[ ( i + 1 ) % a.length ], b[ j ], b[ ( j + 1 ) % b.length ] ) );
	return nearest;
}
export function intersectionArea( subject, clip ) {
	let output = subject;
	for ( let i = 0; i < clip.length && output.length; i ++ ) {
		const a = clip[ i ], b = clip[ ( i + 1 ) % clip.length ], input = output;
		output = [];
		for ( let j = 0; j < input.length; j ++ ) {
			const p = input[ j ], q = input[ ( j + 1 ) % input.length ];
			const cp = cross( a, b, p ), cq = cross( a, b, q );
			if ( cp >= 0 ) output.push( p );
			if ( ( cp >= 0 ) !== ( cq >= 0 ) ) { const t = cp / ( cp - cq ); output.push( [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * t, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * t ] ); }
		}
	}
	return area( output );
}
export function rectangle( minX, minZ, maxX, maxZ ) { return [ [ minX, minZ ], [ maxX, minZ ], [ maxX, maxZ ], [ minX, maxZ ] ]; }

export class SpatialIndex {
	constructor() { this.cells = new Map(); }
	add( ring, value, margin = 0 ) {
		for ( const key of this.keys( ring, margin ) ) { if ( ! this.cells.has( key ) ) this.cells.set( key, new Set() ); this.cells.get( key ).add( value ); }
	}
	query( ring, margin = 0 ) { return new Set( this.keys( ring, margin ).flatMap( key => [ ...this.cells.get( key ) ?? [] ] ) ); }
	keys( ring, margin ) {
		const b = bounds( ring ), out = [];
		for ( let x = Math.floor( ( b.minX - margin ) / 32 ); x <= Math.floor( ( b.maxX + margin ) / 32 ); x ++ ) for ( let z = Math.floor( ( b.minZ - margin ) / 32 ); z <= Math.floor( ( b.maxZ + margin ) / 32 ); z ++ ) out.push( `${x}:${z}` );
		return out;
	}
}
