/**
 * The cross section each link kind is swept through, as a closed loop of
 * corners in metres across and up from the centerline, plus the material role
 * of every edge. Edge `i` runs from corner `i` to the next one round the loop,
 * so a section is closed by construction: a link has a floor, walls and a roof
 * whatever kind it is, and never a strip missing that would leave you looking
 * at the sky through a wall.
 *
 * Roles are what the surface is made of, not where it sits: `shell` is the
 * structure, `glass` the glazing. Links.js binds a role to a Materials key.
 */

/** Glazing sits at eye level: a 1.4 m band starting 0.9 m off the floor. */
const SILL = 0.9;
const HEAD = 2.3;
/** Under this much wall above the sill the band is not worth cutting. */
const MIN_BAND = 0.4;

/** A duct or a service tunnel: four flats round a rectangle. */
export function rectTube( width, height ) {

	const [ across, up ] = [ width / 2, height / 2 ];

	return {
		corners: [ [ - across, - up ], [ across, - up ], [ across, up ], [ - across, up ] ],
		roles: [ 'shell', 'shell', 'shell', 'shell' ]
	};

}

/**
 * A skybridge: an enclosed crossing with a floor, two walls, a roof and a
 * glazed band down each wall. The aperture at either end is a doorway into
 * this corridor, which is what the published walking flags say a bridge is,
 * walked through and never over.
 */
export function glazedBridge( width, height ) {

	const [ across, up ] = [ width / 2, height / 2 ];
	const sill = - up + SILL;
	const head = Math.min( - up + HEAD, up - MIN_BAND );

	if ( head <= sill ) return rectTube( width, height );

	return {
		corners: [
			[ - across, - up ], [ across, - up ],
			[ across, sill ], [ across, head ], [ across, up ],
			[ - across, up ], [ - across, head ], [ - across, sill ]
		],
		roles: [ 'shell', 'shell', 'glass', 'shell', 'shell', 'shell', 'glass', 'shell' ]
	};

}

/**
 * A cable as a closed tube of `sides` flats. A wire is 10 cm across and read
 * from metres away, so the flats never show and the tube costs a fraction of a
 * smooth one.
 */
export function roundTube( radius, sides ) {

	const corners = [];

	for ( let i = 0; i < sides; i ++ ) {

		const angle = i / sides * Math.PI * 2;

		corners.push( [ Math.cos( angle ) * radius, Math.sin( angle ) * radius ] );

	}

	return { corners, roles: corners.map( () => 'shell' ) };

}
