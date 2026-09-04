import { pointInRing } from '../ground/Polygons.js';

/** Scenic rooms follow a human-scale width even behind continuous glazing. */
export function windowRects( rect ) {

	const count = Math.max( 1, Math.ceil( rect.width / 5 ) );
	return Array.from( { length: count }, ( _, index ) => ( {
		...rect,
		start: rect.start.clone().lerp( rect.end, index / count ),
		end: rect.start.clone().lerp( rect.end, ( index + 1 ) / count ),
		width: rect.width / count,
		outerLeft: index === 0,
		outerRight: index === count - 1
	} ) );

}

/** A room's open front starts behind the deepest authored curtain or reveal. */
export function windowBay( floor, rect, wallDepth, occupied ) {

	const inset = Math.max( 0.2, wallDepth + 0.06, ( rect.housingBackDepth ?? 0 ) + 0.06 );
	const width = rect.width - 0.06;
	const bottom = Math.max( floor.elevation + 0.06, rect.y0 - 0.5 );
	const top = Math.min( floor.elevation + floor.height - 0.08, rect.y1 + 0.15 );
	if ( width < 0.3 || top - bottom < 0.4 ) return null;
	const along = [ ( rect.end.x - rect.start.x ) / rect.width, ( rect.end.z - rect.start.z ) / rect.width ];
	const point = ( u, v ) => [
		rect.start.x + along[ 0 ] * ( u + 0.03 ) - rect.normal.x * v,
		rect.start.z + along[ 1 ] * ( u + 0.03 ) - rect.normal.z * v
	];
	for ( let depth = Math.min( 2.6, Math.max( 1.2, width * 0.9 ) ); depth >= 0.6; depth -= 0.25 ) {

		const footprint = [ point( 0, inset ), point( width, inset ), point( width, inset + depth ), point( 0, inset + depth ) ];
		if ( ! footprint.every( ( p ) => pointInRing( ...p, floor.outline ) ) ) continue;
		if ( boundariesCross( footprint, floor.outline ) ) continue;
		if ( ! clearsBoundary( footprint, floor.outline, Math.max( 0.16, wallDepth ) + 0.03 ) ) continue;
		if ( occupied.some( ( other ) => overlaps( footprint, other ) ) ) continue;
		return { footprint, bottom, top, width, depth, returns: Number.isFinite( rect.housingBackDepth ) ? {
			pocketDepth: Math.max( rect.housingBackDepth, wallDepth + 0.003 ),
			outerLeft: rect.outerLeft, outerRight: rect.outerRight,
			housingDepth: rect.housingBackDepth,
			width: rect.width, bottom: rect.y0, top: rect.y1,
			point: ( u, y, v ) => [
				rect.start.x + along[ 0 ] * u - rect.normal.x * v, y,
				rect.start.z + along[ 1 ] * u - rect.normal.z * v
			]
		} : null, point: ( u, y, v ) => {

			const [ x, z ] = point( u, inset + v );
			return [ x, y, z ];

		} };

	}
	return null;

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
	if ( bay.returns ) appendReturns( bay, surfaceFor, color, level );
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

/** Connects each open room perimeter to its authored housing, without a front face. */
function appendReturns( bay, surfaceFor, color, level ) {

	const { width: w, bottom: b, top: t, point: p, returns: r } = bay;
	const front = ( u, y, depth = r.pocketDepth ) => r.point( u, y, depth );
	const faces = [
		[ 'left', [ front( 0, r.bottom ), p( 0, b, 0 ), p( 0, t, 0 ), front( 0, r.top ) ] ],
		[ 'right', [ p( w, b, 0 ), front( r.width, r.bottom ), front( r.width, r.top ), p( w, t, 0 ) ] ],
		[ 'floor', [ front( 0, r.bottom ), front( r.width, r.bottom ), p( w, b, 0 ), p( 0, b, 0 ) ] ],
		[ 'ceiling', [ p( 0, t, 0 ), p( w, t, 0 ), front( r.width, r.top ), front( 0, r.top ) ] ]
	];
	if ( r.pocketDepth - r.housingDepth > 1e-6 ) {

		faces.push(
			[ 'floor', [ front( 0, r.bottom, r.housingDepth ), front( r.width, r.bottom, r.housingDepth ), front( r.width, r.bottom ), front( 0, r.bottom ) ] ],
			[ 'ceiling', [ front( 0, r.top ), front( r.width, r.top ), front( r.width, r.top, r.housingDepth ), front( 0, r.top, r.housingDepth ) ] ]
		);
		if ( r.outerLeft ) faces.push( [ 'left', [ front( 0, r.bottom, r.housingDepth ), front( 0, r.bottom ), front( 0, r.top ), front( 0, r.top, r.housingDepth ) ] ] );
		if ( r.outerRight ) faces.push( [ 'right', [ front( r.width, r.bottom ), front( r.width, r.bottom, r.housingDepth ), front( r.width, r.top, r.housingDepth ), front( r.width, r.top ) ] ] );

	}
	for ( const [ role, corners ] of faces ) {

		const surface = surfaceFor( role );
		const length = ( a, b ) => Math.hypot( ...a.map( ( v, i ) => v - b[ i ] ) );
		const aspect = ( length( corners[ 0 ], corners[ 1 ] ) + length( corners[ 2 ], corners[ 3 ] ) )
			/ ( length( corners[ 1 ], corners[ 2 ] ) + length( corners[ 3 ], corners[ 0 ] ) );
		quad( surface.data, corners, surface.color ?? color, level, cropRect( aspect, surface.aspect ) );

	}

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

function clearsBoundary( a, b, clearance ) {

	const distance = ( p, q, r ) => {

		const dx = r[ 0 ] - q[ 0 ];
		const dz = r[ 1 ] - q[ 1 ];
		const t = Math.max( 0, Math.min( 1, ( ( p[ 0 ] - q[ 0 ] ) * dx + ( p[ 1 ] - q[ 1 ] ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
		return Math.hypot( p[ 0 ] - q[ 0 ] - t * dx, p[ 1 ] - q[ 1 ] - t * dz );

	};
	return a.every( ( p, i ) => b.every( ( r, j ) => {

		const q = a[ ( i + 1 ) % a.length ];
		const s = b[ ( j + 1 ) % b.length ];
		return Math.min( distance( p, r, s ), distance( q, r, s ), distance( r, p, q ), distance( s, p, q ) ) >= clearance;

	} ) );

}

function boundariesCross( a, b ) {

	const side = ( p, q, r ) => ( q[ 0 ] - p[ 0 ] ) * ( r[ 1 ] - p[ 1 ] ) - ( q[ 1 ] - p[ 1 ] ) * ( r[ 0 ] - p[ 0 ] );
	return a.some( ( p, i ) => b.some( ( r, j ) => {

		const q = a[ ( i + 1 ) % a.length ];
		const s = b[ ( j + 1 ) % b.length ];
		return side( p, q, r ) * side( p, q, s ) < - 1e-10 && side( r, s, p ) * side( r, s, q ) < - 1e-10;

	} ) );

}
