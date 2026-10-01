/**
 * The most instances of each draw key that can stand at once in the shared
 * interior draws, worked out from the registered buildings' placement tables
 * before anything stands, so the draws can be sized once while the city loads
 * instead of growing on the frame a building comes into sight.
 *
 * What stands follows the interior stream's own rules:
 *
 * - a building's copies are drawn only while the player is within `view` of
 *   its footprint (or in it), so two buildings drawn at once lie within twice
 *   that of each other: the buildings drawn together are always among one
 *   building's neighbours at that distance;
 * - of a drawn building, the floors within `reach` of the one the player
 *   stands on are drawn, and those within `reach` of a floor a lift was sent
 *   to, which one building at a time has;
 * - a floor within `reach` that is not shown yet stands its `support`
 *   placements, in any building within `drop` of the player.
 *
 * So a key's peak is, over every building, what its neighbours within twice
 * `view` draw at their fullest window of floors, plus one more window for the
 * building with a lift request, plus the supports its neighbours within twice
 * `drop` stand the same way. Each term takes a key's own fullest window, so the
 * peak is never below what the stream can stand, and it is what one
 * neighbourhood holds rather than the whole city.
 *
 * @param interiors [{ floors: floor records, bounds: { x0, x1, z0, z1 } | null, center: { x, z } | null }]
 * @param keysOf placement => the keys one copy of it takes an instance under
 * @param support placement => whether it stands before its floor is shown
 * @returns Map of key to instances
 */
export function standingPeaks( interiors, { keysOf, support = () => false, reach = 1, view = 36, drop = 95 } ) {

	const counted = new WeakMap();
	const count = ( placements ) => {

		let tally = counted.get( placements );
		if ( tally ) return tally;
		tally = { drawn: new Map(), support: new Map() };
		for ( const placement of placements ) {

			const keys = keysOf( placement );
			for ( const key of keys ) add( tally.drawn, key, 1 );
			if ( keys.length && support( placement ) ) for ( const key of keys ) add( tally.support, key, 1 );

		}
		counted.set( placements, tally );

		return tally;

	};

	const buildings = interiors.map( ( { floors, bounds, center } ) => {

		// A floor's own window returns are counted apart from the table its layout shares.
		const tallies = floors.map( ( floor ) => [ count( floor.placements ), floor.treatments?.length ? count( floor.treatments ) : null ] );

		return {
			area: bounds ?? ( center ? { x0: center.x, x1: center.x, z0: center.z, z1: center.z } : null ),
			drawn: fullest( tallies.map( ( parts ) => parts.map( ( tally ) => tally?.drawn ) ), reach ),
			support: fullest( tallies.map( ( parts ) => parts.map( ( tally ) => tally?.support ) ), reach )
		};

	} );

	const peaks = new Map();
	for ( const [ field, radius ] of [ [ 'drawn', view ], [ 'support', drop ] ] ) {

		const most = new Map();
		for ( const building of buildings ) {

			const together = new Map();
			const largest = new Map();
			for ( const other of buildings ) {

				if ( gap( building.area, other.area ) > 2 * radius ) continue;
				for ( const [ key, instances ] of other[ field ] ) {

					add( together, key, instances );
					largest.set( key, Math.max( largest.get( key ) ?? 0, instances ) );

				}

			}
			for ( const [ key, instances ] of together ) most.set( key, Math.max( most.get( key ) ?? 0, instances + largest.get( key ) ) );

		}
		for ( const [ key, instances ] of most ) add( peaks, key, instances );

	}

	return peaks;

}

/**
 * Per key, the most instances any run of floors `2 * reach + 1` long holds.
 * @param floors per floor, the tallies (Map or null) its parts add up to
 */
function fullest( floors, reach ) {

	const keys = new Set();
	for ( const parts of floors ) for ( const tally of parts ) if ( tally ) for ( const key of tally.keys() ) keys.add( key );

	const best = new Map();
	for ( const key of keys ) {

		const per = floors.map( ( parts ) => parts.reduce( ( sum, tally ) => sum + ( tally?.get( key ) ?? 0 ), 0 ) );
		let most = 0;
		for ( let standing = 0; standing < per.length; standing ++ ) {

			let sum = 0;
			for ( let floor = Math.max( 0, standing - reach ); floor <= Math.min( per.length - 1, standing + reach ); floor ++ ) sum += per[ floor ];
			most = Math.max( most, sum );

		}
		if ( most > 0 ) best.set( key, most );

	}

	return best;

}

/** Ground distance between two footprints; one with no place is next to everything. */
function gap( a, b ) {

	if ( ! a || ! b ) return 0;

	return Math.hypot( Math.max( b.x0 - a.x1, 0, a.x0 - b.x1 ), Math.max( b.z0 - a.z1, 0, a.z0 - b.z1 ) );

}

function add( map, key, instances ) {

	map.set( key, ( map.get( key ) ?? 0 ) + instances );

}
