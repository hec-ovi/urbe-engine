import { pointInRing } from '../ground/Polygons.js';

/** One rectangular scene, one metre deep, directly behind the window glass. */
export function windowBay( floor, rect, wallDepth, occupied ) {

  const inset = Math.max( 0, rect.glassDepth ?? rect.housingBackDepth ?? wallDepth );
  const width = rect.width, depth = 1, bottom = rect.y0, top = rect.y1;
  if ( width < 0.3 || top - bottom < 0.15 ) return null;
  const along = [ ( rect.end.x - rect.start.x ) / rect.width, ( rect.end.z - rect.start.z ) / rect.width ];
  const point = ( u, v ) => [
    rect.start.x + along[ 0 ] * u - rect.normal.x * v,
    rect.start.z + along[ 1 ] * u - rect.normal.z * v
  ];
  const footprint = [ point( 0, inset ), point( width, inset ), point( width, inset + depth ), point( 0, inset + depth ) ];
  if ( ! footprint.every( ( p ) => pointInRing( ...p, floor.outline ) ) || boundariesCross( footprint, floor.outline ) ) return null;
  if ( occupied.some( ( other ) => overlaps( footprint, other ) ) ) return null;
  return { footprint, bottom, top, width, depth, point: ( u, y, v ) => {
    const [ x, z ] = point( u, inset + v );
    return [ x, y, z ];
  } };

}

/** Five room faces and one shallow ceiling luminaire, no front-facing card. */
export function appendBay( bay, surfaceFor, fixtures, color, level, lit ) {

	const { width: w, depth: d, bottom: b, top: t, point: p } = bay;
	const face = ( data, corners, brightness ) => quad( data, corners.map( ( v ) => p( ...v ) ), color, brightness );
	const faces = [
		[ 'back', [ [ 0, b, d ], [ w, b, d ], [ w, t, d ], [ 0, t, d ] ], w / ( t - b ), 1.8 ],
		[ 'left', [ [ 0, b, 0 ], [ 0, b, d ], [ 0, t, d ], [ 0, t, 0 ] ], d / ( t - b ), 1 ],
		[ 'right', [ [ w, b, d ], [ w, b, 0 ], [ w, t, 0 ], [ w, t, d ] ], d / ( t - b ), 1 ],
		[ 'floor', [ [ 0, b, 0 ], [ w, b, 0 ], [ w, b, d ], [ 0, b, d ] ], w / d, 0.7 ],
		[ 'ceiling', [ [ 0, t, d ], [ w, t, d ], [ w, t, 0 ], [ 0, t, 0 ] ], w / d, 1 ]
	];
	for ( const [ role, corners, aspect, brightness ] of faces ) {

		const surface = surfaceFor( role );
		quad( surface.data, corners.map( ( v ) => p( ...v ) ), surface.color ?? color,
			level * brightness, cropRect( aspect, surface.aspect ) );

	}
	if ( ! lit ) return;
	const x0 = w * 0.22;
	const x1 = w * 0.78;
	const z0 = Math.min( 0.55, d * 0.35 );
	const z1 = z0 + 0.12;
	const y = t - 0.045;
	// A visible underside with four solid edge faces fitted to the ceiling.
	face( fixtures, [ [ x0, y, z0 ], [ x1, y, z0 ], [ x1, y, z1 ], [ x0, y, z1 ] ], 110 );
	face( fixtures, [ [ x0, y, z0 ], [ x0, t, z0 ], [ x1, t, z0 ], [ x1, y, z0 ] ], 22 );
	face( fixtures, [ [ x1, y, z1 ], [ x1, t, z1 ], [ x0, t, z1 ], [ x0, y, z1 ] ], 22 );
	face( fixtures, [ [ x0, y, z1 ], [ x0, t, z1 ], [ x0, t, z0 ], [ x0, y, z0 ] ], 22 );
	face( fixtures, [ [ x1, y, z0 ], [ x1, t, z0 ], [ x1, t, z1 ], [ x1, y, z1 ] ], 22 );

}

function quad( data, corners, color, level, rect = null ) {

	const width = Math.hypot( ...corners[ 1 ].map( ( v, i ) => v - corners[ 0 ][ i ] ) );
	const height = Math.hypot( ...corners[ 3 ].map( ( v, i ) => v - corners[ 0 ][ i ] ) );
	const [ u0, v0, u1, v1 ] = rect ?? [ 0, 0, width, height ];
	const uv = [ [ u0, v1 ], [ u1, v1 ], [ u1, v0 ], [ u0, v0 ] ];
	for ( const i of [ 0, 1, 2, 0, 2, 3 ] ) {

		data.position.push( ...corners[ i ] );
		data.color.push( color.r * level, color.g * level, color.b * level );
		data.uv.push( ...uv[ i ] );

	}

}

/** Center crop preserves image proportions on any fitted rear wall. */
function cropRect( targetAspect, imageAspect ) {

	const u = Math.min( 1, targetAspect / imageAspect );
	const v = Math.min( 1, imageAspect / targetAspect );
	return [ ( 1 - u ) / 2, ( 1 - v ) / 2, ( 1 + u ) / 2, ( 1 + v ) / 2 ];

}

function overlaps( a, b ) {

	return a.some( ( p ) => pointInRing( ...p, b ) ) || b.some( ( p ) => pointInRing( ...p, a ) ) || boundariesCross( a, b );

}

function boundariesCross( a, b ) {

	const side = ( p, q, r ) => ( q[ 0 ] - p[ 0 ] ) * ( r[ 1 ] - p[ 1 ] ) - ( q[ 1 ] - p[ 1 ] ) * ( r[ 0 ] - p[ 0 ] );
	return a.some( ( p, i ) => b.some( ( r, j ) => {

		const q = a[ ( i + 1 ) % a.length ];
		const s = b[ ( j + 1 ) % b.length ];
		return side( p, q, r ) * side( p, q, s ) < - 1e-10 && side( r, s, p ) * side( r, s, q ) < - 1e-10;

	} ) );

}
