/*
 * Carried over from the NPC Studio (codex_npcs, src/clothing/collars.js): a
 * top's neck opening finished as a continuous collar band instead of the
 * source mesh's uneven triangle cut.
 */

/**
 * The lower ring is exactly the shell's boundary. A shallow rounded band rises
 * from it and ends in a level annulus that runs on beneath the neck, so the
 * opening reads continuous even where the body's triangles cross the cut at
 * different heights. Every vertex keeps one boundary vertex's four skin
 * influences; the upper rim shares one neck binding, so its edge stays smooth
 * through head turns while the short lower band blends into the shell. The
 * band is appended to the shell's own arrays: no mesh, material or frame work.
 *
 * @returns the boundary edge keys whose ordinary inward wall must be left out
 */
export function appendCollar( {
	descriptor, edgeMap, welded, contexts, sourcePosition, sourceIndex, sourceWeight, outerPosition,
	positions, normals, joints, weights, garmentCoordinates, garmentNormals, garmentWeights, garmentRims, indices
} ) {

	const handled = new Set();
	if ( descriptor.category !== 'top' || descriptor.collar === false ) return handled;
	const candidates = closedBoundaryLoops( edgeMap, welded ).filter( ( { vertices } ) => {

		const values = vertices.map( ( index ) => contexts[ index ] );
		const mean = ( read ) => values.reduce( ( sum, value ) => sum + read( value ), 0 ) / values.length;
		const left = Math.min( ...values.map( ( { x } ) => x ) );
		const right = Math.max( ...values.map( ( { x } ) => x ) );
		return mean( ( { y } ) => y ) > 0.79 && left < 0 && right > 0 && right - left < 0.24
			&& Math.max( ...values.map( ( { y } ) => y ) ) - Math.min( ...values.map( ( { y } ) => y ) ) < 0.09
			&& mean( ( value ) => value.weight( 'upperarm' ) + value.weight( 'lowerarm' ) ) < 0.2;

	} );
	// The neck is the uppermost central contour: armholes and front and hem
	// openings keep their own closures, sleeveless tops included.
	candidates.sort( ( a, b ) => averageHeight( b.vertices, contexts ) - averageHeight( a.vertices, contexts ) );
	const loop = candidates[ 0 ];
	if ( ! loop ) return handled;

	const sourceVertices = loop.vertices;
	const count = sourceVertices.length;
	const height = contexts[ sourceVertices[ 0 ] ].height;
	const lower = sourceVertices.map( ( index ) => outerPosition( index ) );
	const center = [ 0, 0, 0 ];
	for ( const point of lower ) {

		center[ 0 ] += point[ 0 ] / count;
		center[ 2 ] += point[ 2 ] / count;

	}
	const style = descriptor.collar?.style ?? 'crew';
	const rise = ( style === 'stand' ? 0.0028 : style === 'open' ? 0.0006 : 0.0012 ) * height;
	const bodyBottom = sourcePosition.getY( sourceVertices[ 0 ] ) - contexts[ sourceVertices[ 0 ] ].y * height;
	const top = Math.max( Math.max( ...lower.map( ( point ) => point[ 1 ] ) ) + rise, bodyBottom + ( descriptor.collar?.height ?? 0 ) * height );
	// Torso and neck weights alternating round the cut would turn even a level
	// rim into teeth when the head tilts. One original neck binding moves the
	// whole upper ring as one affine piece, with no per-frame smoothing.
	const neckSource = sourceVertices.reduce( ( best, index ) => contexts[ index ].weight( 'neck' ) > contexts[ best ].weight( 'neck' ) ? index : best, sourceVertices[ 0 ] );
	const bevel = Math.min( rise * 0.6, height * 0.0012 );
	const sourceTop = Math.max( ...sourceVertices.map( ( index ) => sourcePosition.getY( index ) ) );
	const outer = [];
	const shoulder = [];
	const inner = [];
	const directions = [];

	for ( let index = 0; index < count; index ++ ) {

		const previous = lower[ ( index + count - 1 ) % count ];
		const point = lower[ index ];
		const next = lower[ ( index + 1 ) % count ];
		// A small contour fairing takes out single dents and keeps the neck's
		// fitted shape; padding keeps the rounded edge outside the skin.
		const x = point[ 0 ] * 0.75 + ( previous[ 0 ] + next[ 0 ] ) * 0.125 - center[ 0 ];
		const z = point[ 2 ] * 0.75 + ( previous[ 2 ] + next[ 2 ] ) * 0.125 - center[ 2 ];
		const length = Math.hypot( x, z ) || height * 0.01;
		const direction = [ x / length, 0, z / length ];
		const radius = length + height * 0.00045;
		const source = sourceVertices[ index ];
		const sourceY = sourcePosition.getY( source ) * 0.5
			+ ( sourcePosition.getY( sourceVertices[ ( index + count - 1 ) % count ] )
				+ sourcePosition.getY( sourceVertices[ ( index + 1 ) % count ] ) ) * 0.25;
		// The shell's boundary is already levelled by the fitter. A crew/open
		// binding can soften that contour a little; it cannot recover a cut neck.
		const level = top - ( style === 'stand' ? 0 : Math.min( height * 0.0015, Math.max( 0, sourceTop - sourceY ) ) );
		directions.push( direction );
		shoulder.push( [ center[ 0 ] + direction[ 0 ] * radius, level - bevel, center[ 2 ] + direction[ 2 ] * radius ] );
		outer.push( [ center[ 0 ] + direction[ 0 ] * ( radius - bevel * 0.45 ), level, center[ 2 ] + direction[ 2 ] * ( radius - bevel * 0.45 ) ] );
		const bodyRadius = Math.hypot( sourcePosition.getX( source ) - center[ 0 ], sourcePosition.getZ( source ) - center[ 2 ] );
		// A narrow cloth binding underlaps the neck, instead of a broad flat
		// plate that closes more than half the opening. Keep the same skin binding.
		const underlap = Math.max( height * 0.002, bodyRadius * 0.08 );
		const innerRadius = Math.max( 0, Math.min( bodyRadius - underlap, radius - height * 0.0025 ) );
		inner.push( [ center[ 0 ] + direction[ 0 ] * innerRadius, level - bevel * 0.3, center[ 2 ] + direction[ 2 ] * innerRadius ] );

	}

	function vertex( source, point, normal, rim ) {

		const index = positions.length / 3;
		const context = contexts[ source ];
		positions.push( ...point );
		normals.push( ...normal );
		for ( let slot = 0; slot < 4; slot ++ ) {

			joints.push( sourceIndex.getComponent( source, slot ) );
			weights.push( sourceWeight.getComponent( source, slot ) );

		}
		garmentCoordinates.push( context.x, context.y, context.z );
		garmentNormals.push( context.nx, context.ny, context.nz );
		garmentWeights.push( context.weight( 'torso' ) + context.weight( 'pelvis' ), context.weight( 'upperarm' ) + context.weight( 'lowerarm' ),
			context.weight( 'neck' ), context.weight( 'foot' ) );
		garmentRims.push( rim );
		return index;

	}

	function connect( first, second, expectedNormal ) {

		for ( let index = 0; index < count; index ++ ) {

			const next = ( index + 1 ) % count;
			triangle( first[ index ], second[ index ], first[ next ], expectedNormal( index, next ) );
			triangle( first[ next ], second[ index ], second[ next ], expectedNormal( index, next ) );

		}

	}

	function triangle( a, b, c, normal ) {

		const ab = [ positions[ b * 3 ] - positions[ a * 3 ], positions[ b * 3 + 1 ] - positions[ a * 3 + 1 ], positions[ b * 3 + 2 ] - positions[ a * 3 + 2 ] ];
		const ac = [ positions[ c * 3 ] - positions[ a * 3 ], positions[ c * 3 + 1 ] - positions[ a * 3 + 1 ], positions[ c * 3 + 2 ] - positions[ a * 3 + 2 ] ];
		const facing = ( ab[ 1 ] * ac[ 2 ] - ab[ 2 ] * ac[ 1 ] ) * normal[ 0 ]
			+ ( ab[ 2 ] * ac[ 0 ] - ab[ 0 ] * ac[ 2 ] ) * normal[ 1 ]
			+ ( ab[ 0 ] * ac[ 1 ] - ab[ 1 ] * ac[ 0 ] ) * normal[ 2 ];
		if ( facing < 0 ) indices.push( a, c, b );
		else indices.push( a, b, c );

	}

	const bottomRing = sourceVertices.map( ( source, index ) => vertex( source, lower[ index ], directions[ index ], 0 ) );
	const shoulderRing = sourceVertices.map( ( _, index ) => vertex( neckSource, shoulder[ index ], directions[ index ], 1 ) );
	const outerRing = sourceVertices.map( ( _, index ) => {

		const radial = directions[ index ];
		return vertex( neckSource, outer[ index ], [ radial[ 0 ] * Math.SQRT1_2, Math.SQRT1_2, radial[ 2 ] * Math.SQRT1_2 ], 1 );

	} );
	const innerRing = sourceVertices.map( ( _, index ) => vertex( neckSource, inner[ index ], [ 0, 1, 0 ], 1 ) );
	const outward = ( a, b ) => [ directions[ a ][ 0 ] + directions[ b ][ 0 ], 0, directions[ a ][ 2 ] + directions[ b ][ 2 ] ];
	connect( bottomRing, shoulderRing, outward );
	connect( shoulderRing, outerRing, ( a, b ) => [ outward( a, b )[ 0 ], 1, outward( a, b )[ 2 ] ] );
	connect( outerRing, innerRing, () => [ 0, 1, 0 ] );
	for ( const edge of loop.edges ) handled.add( edge.key );
	return handled;

}

function averageHeight( vertices, contexts ) {

	return vertices.reduce( ( sum, index ) => sum + contexts[ index ].y, 0 ) / vertices.length;

}

function closedBoundaryLoops( edges, welded ) {

	const adjacent = new Map();
	for ( const edge of edges.values() ) {

		if ( edge.count !== 1 ) continue;
		for ( const vertex of [ edge.a, edge.b ] ) {

			const key = welded[ vertex ];
			if ( ! adjacent.has( key ) ) adjacent.set( key, [] );
			adjacent.get( key ).push( edge );

		}

	}
	const visited = new Set();
	const loops = [];
	for ( const [ start, neighbors ] of adjacent ) {

		if ( visited.has( start ) || neighbors.length !== 2 ) continue;
		const vertices = [];
		const loopEdges = [];
		let key = start;
		let previous = null;
		let complete = false;
		while ( ! visited.has( key ) ) {

			visited.add( key );
			const connected = adjacent.get( key );
			if ( connected?.length !== 2 ) break;
			const edge = connected.find( ( candidate ) => candidate !== previous );
			const source = welded[ edge.a ] === key ? edge.a : edge.b;
			vertices.push( source );
			loopEdges.push( edge );
			key = welded[ edge.a ] === key ? welded[ edge.b ] : welded[ edge.a ];
			previous = edge;
			if ( key === start ) {

				complete = true;
				break;

			}

		}
		if ( complete && vertices.length >= 6 ) loops.push( { vertices, edges: loopEdges } );

	}
	return loops;

}
