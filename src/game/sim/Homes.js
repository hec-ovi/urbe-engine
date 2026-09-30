/**
 * The dwellings of a furnished building, as the simulation takes them in its
 * Interior NPC support (`homes`): each numbered apartment entrance Interior
 * publishes on a floor (`floors[].apartmentEntrances`) is one dwelling, its
 * rooms the layout rooms of that entrance's unit, named as the NPC anchors
 * name them (`floor:<index>/<room id>`), its entrance the door's world XZ.
 */
export function homesOf( { interior } = {} ) {

	const homes = [];
	for ( const floor of interior?.building?.floors ?? [] ) {

		const rooms = interior.layouts?.[ floor.layout ]?.floor?.rooms ?? [];
		for ( const entrance of floor.apartmentEntrances ?? [] ) {

			const unit = rooms.filter( ( room ) => room.unit === entrance.unit ).map( ( room ) => `floor:${floor.index}/${room.id}` );
			if ( ! unit.length ) continue;
			homes.push( {
				id: `floor:${floor.index}/${entrance.unit}`, floor: floor.index,
				...( entrance.number ? { number: String( entrance.number ) } : {} ),
				rooms: unit, entrance: [ entrance.position[ 0 ], entrance.position[ 1 ] ]
			} );

		}

	}
	return homes;

}

/**
 * The names a story's cast keeps to itself, as the simulation's `avoidNames`:
 * every family name and full name a questline gives a role, reserved or
 * written for the character.
 */
export function castNames( questlines = [] ) {

	const full = new Map();
	for ( const questline of questlines ) for ( const role of questline.roles ?? [] ) {

		for ( const name of [ role.reservedName, role.characterName ] ) if ( name?.given && name?.family ) full.set( `${name.given}\n${name.family}`, { given: name.given, family: name.family } );

	}
	const names = [ ...full.values() ];
	return { family: [ ...new Set( names.map( ( name ) => name.family ) ) ].sort(), full: names };

}
