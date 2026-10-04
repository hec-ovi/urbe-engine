/**
 * Where the city map writes its names, worked out on the screen alone so the
 * same placement holds for any camera: each street's name along every stretch
 * of it in view, turned to follow it and kept upright, or each district's name
 * over its centre; never two names over each other, the longer stretches
 * first. `project( [x, z] )` gives a ground point's screen `{ x, y }`, or null
 * behind the camera; `measure( text, kind )` a name's width in pixels.
 */

/** A street is cut into pieces this long (metres) before projecting, so a stretch behind the camera drops out cleanly. */
const CHUNK = 30;
/** Space kept clear around a name, and from the edges of the view, in pixels. */
const PAD = 6;
/** Two pieces meeting closer than this (pixels) are one stretch. */
const JOIN = 2.5;

/**
 * The names to draw: `[{ text, kind: 'street' | 'district', x, y, angle, width, height }]`,
 * `x, y` the name's centre in pixels and `angle` its turn in radians.
 * @param mode `street` (close in) or `district` (further out)
 * @param streets `[{ name, paths: [[[x, z], ...]] }]`
 * @param districts `[{ name, center: [x, z] }]`
 * @param size `{ width, height }` of the view in pixels
 * @param heights `{ street, district }` line heights in pixels
 */
export function placeLabels( { mode, streets = [], districts = [], project, measure, size, heights = { street: 16, district: 14 } } ) {

	const placed = [];
	const free = ( box ) => placed.every( ( other ) => box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom );
	const candidates = mode === 'street'
		? streetCandidates( streets, project, measure, size, heights.street )
		: districtCandidates( districts, project, measure, size, heights.district );
	const labels = [];
	for ( const label of candidates ) {

		const box = boxOf( label );
		if ( box.left < 0 || box.top < 0 || box.right > size.width || box.bottom > size.height || ! free( box ) ) continue;
		placed.push( box );
		labels.push( label );

	}
	return labels;

}

function streetCandidates( streets, project, measure, size, height ) {

	const candidates = [];
	for ( const street of streets ) {

		const width = measure( street.name, 'street' );
		for ( const stretch of stretchesOf( street.paths, project, size ) ) {

			const length = lengthOf( stretch );
			if ( length < width + PAD * 4 ) continue;
			const { point, angle } = halfway( stretch, length );
			candidates.push( { text: street.name, kind: 'street', x: point.x, y: point.y, angle: upright( angle ), width, height, length } );

		}

	}
	// The longest stretches name their streets first.
	return candidates.sort( ( a, b ) => b.length - a.length ).map( ( { length, ...label } ) => label );

}

function districtCandidates( districts, project, measure, size, height ) {

	return districts.flatMap( ( district ) => {

		const point = project( district.center );
		if ( ! point || point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height ) return [];
		return [ { text: district.name, kind: 'district', x: point.x, y: point.y, angle: 0, width: measure( district.name, 'district' ), height } ];

	} );

}

/** The stretches of a street in view, each a screen polyline: its paths cut into chunks, projected, cut to the view and joined where they meet. */
function stretchesOf( paths, project, size ) {

	const stretches = [];
	for ( const path of paths ) {

		let current = null;
		for ( let i = 1; i < path.length; i ++ ) {

			const [ ax, az ] = path[ i - 1 ], [ bx, bz ] = path[ i ];
			const chunks = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) / CHUNK ) );
			for ( let c = 0; c < chunks; c ++ ) {

				const from = project( [ ax + ( bx - ax ) * c / chunks, az + ( bz - az ) * c / chunks ] );
				const to = project( [ ax + ( bx - ax ) * ( c + 1 ) / chunks, az + ( bz - az ) * ( c + 1 ) / chunks ] );
				const piece = from && to ? clip( from, to, size ) : null;
				if ( ! piece ) {

					current = null;
					continue;

				}
				if ( current && near( current.at( - 1 ), piece[ 0 ] ) ) current.push( piece[ 1 ] );
				else {

					current = [ piece[ 0 ], piece[ 1 ] ];
					stretches.push( current );

				}

			}

		}

	}
	// The edges of one street join where one ends and the next begins.
	for ( let i = 0; i < stretches.length; i ++ ) for ( let j = 0; j < stretches.length; j ++ ) {

		if ( i === j || ! stretches[ i ] || ! stretches[ j ] ) continue;
		if ( near( stretches[ i ].at( - 1 ), stretches[ j ][ 0 ] ) ) {

			stretches[ i ].push( ...stretches[ j ].slice( 1 ) );
			stretches[ j ] = null;
			j = - 1;

		}

	}
	return stretches.filter( Boolean );

}

/** A screen segment cut to the view, kept PAD inside its edges (Liang-Barsky), or null when none of it is inside. */
function clip( a, b, size ) {

	const dx = b.x - a.x, dy = b.y - a.y;
	let t0 = 0, t1 = 1;
	for ( const [ p, q ] of [ [ - dx, a.x - PAD ], [ dx, size.width - PAD - a.x ], [ - dy, a.y - PAD ], [ dy, size.height - PAD - a.y ] ] ) {

		if ( p === 0 ) {

			if ( q < 0 ) return null;
			continue;

		}
		const t = q / p;
		if ( p < 0 ) t0 = Math.max( t0, t );
		else t1 = Math.min( t1, t );
		if ( t0 > t1 ) return null;

	}
	return [ { x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 } ];

}

function near( a, b ) {

	return Math.abs( a.x - b.x ) <= JOIN && Math.abs( a.y - b.y ) <= JOIN;

}

function lengthOf( line ) {

	let length = 0;
	for ( let i = 1; i < line.length; i ++ ) length += Math.hypot( line[ i ].x - line[ i - 1 ].x, line[ i ].y - line[ i - 1 ].y );
	return length;

}

/** The point half way along a polyline and the way the line runs there. */
function halfway( line, length ) {

	let left = length / 2;
	for ( let i = 1; i < line.length; i ++ ) {

		const a = line[ i - 1 ], b = line[ i ];
		const step = Math.hypot( b.x - a.x, b.y - a.y );
		if ( step >= left || i === line.length - 1 ) {

			const t = step > 0 ? Math.min( 1, left / step ) : 0;
			return { point: { x: a.x + ( b.x - a.x ) * t, y: a.y + ( b.y - a.y ) * t }, angle: Math.atan2( b.y - a.y, b.x - a.x ) };

		}
		left -= step;

	}
	return { point: line[ 0 ], angle: 0 };

}

/** A turn that keeps the words upright: within a quarter turn either way. */
function upright( angle ) {

	let turned = angle;
	while ( turned > Math.PI / 2 ) turned -= Math.PI;
	while ( turned <= - Math.PI / 2 ) turned += Math.PI;
	return turned;

}

/** The screen box a turned name covers, with PAD around it. */
function boxOf( { x, y, angle, width, height } ) {

	const cos = Math.abs( Math.cos( angle ) ), sin = Math.abs( Math.sin( angle ) );
	const halfX = ( width / 2 ) * cos + ( height / 2 ) * sin + PAD;
	const halfY = ( width / 2 ) * sin + ( height / 2 ) * cos + PAD;
	return { left: x - halfX, right: x + halfX, top: y - halfY, bottom: y + halfY };

}
