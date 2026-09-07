import { pointInRing } from './Polygons.js';

/** Ground openings follow the authored shaft footprints used by station entrance stairs. */

/** Every shaft footprint that breaks the surface, as a hole ring. */
export function shaftMouths( atlas ) {

	const mouths = [];

	for ( const station of stationsOf( atlas ) ) {

		for ( const shaft of station.shafts ?? [] ) {

			if ( shaft.bottom < 0 && shaft.top >= 0 && shaft.footprint?.length >= 3 ) mouths.push( shaft.footprint );

		}

	}

	return mouths;

}

/** The deepest metre any station volume reaches, or 0 when none goes below grade. */
export function stationDepth( atlas ) {

	let deepest = 0;

	for ( const station of stationsOf( atlas ) ) {

		deepest = Math.min( deepest, station.box?.bottom ?? 0 );

		for ( const shaft of station.shafts ?? [] ) deepest = Math.min( deepest, shaft.bottom ?? 0 );

	}

	return deepest;

}

/** Each hole against the cover ring that holds it, so a fill only cuts its own. */
export function holesWithin( ring, mouths ) {

	return mouths.filter( ( mouth ) => pointInRing( centre( mouth )[ 0 ], centre( mouth )[ 1 ], ring ) );

}

/** Both modes' stations in one pass; a blueprint without transit has none. */
export function stationsOf( atlas ) {

	return [
		...( atlas.transit?.trainStations ?? [] ),
		...( atlas.transit?.subwayStations ?? [] )
	];

}

export function centre( ring ) {

	let x = 0;
	let z = 0;

	for ( const [ px, pz ] of ring ) {

		x += px;
		z += pz;

	}

	return [ x / ring.length, z / ring.length ];

}
