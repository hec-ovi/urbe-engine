/** Most people a person is told about in the building they stand in, nearest first. */
const MOST_PEOPLE = 8;
/** Rooms nobody names when they say what a floor holds. */
const UNSAID = new Set( [ 'corridor', 'elevator_lobby', 'stair', 'shaft' ] );

/**
 * The building a person stands in, as the dialog layer tells it (Quests
 * `DialogBuilding`), from the building's own circulation plan
 * (`InteriorRoutes.plan`): what each floor holds (the rooms people share by
 * kind, the numbers on its apartment doors), how many lifts and staircases
 * join the floors, the kind of room the person is in and who else is inside.
 * @param plan `{ floors: [{ index, lifts, stairs, rooms: [{ kind, unit? }] }], apartments: [{ floor, number? }] }`
 * @param room the kind of room the person stands in, or null
 * @param insiders `[{ name?, role, floor, room?, metres }]`, the others in the building
 */
export function buildingFacts( plan, { room = null, insiders = [] } = {} ) {

	const floors = plan.floors.map( ( floor ) => {

		const rooms = [ ...new Set( floor.rooms.filter( ( entry ) => ! entry.unit && ! UNSAID.has( entry.kind ) ).map( ( entry ) => entry.kind ) ) ].sort();
		const apartments = plan.apartments.filter( ( home ) => home.floor === floor.index && home.number ).map( ( home ) => home.number ).sort();
		return { index: floor.index, rooms, ...( apartments.length ? { apartments } : {} ) };

	} );
	const ids = ( kind ) => new Set( plan.floors.flatMap( ( floor ) => floor[ kind ].map( ( way ) => way.id ) ) ).size;
	const people = [ ...insiders ].sort( ( a, b ) => a.metres - b.metres ).slice( 0, MOST_PEOPLE )
		.map( ( { name, role, floor, room: where } ) => ( { ...( name ? { name } : {} ), role, floor, ...( where && ! UNSAID.has( where ) ? { room: where } : {} ) } ) );
	return {
		floors, lifts: ids( 'lifts' ), stairs: ids( 'stairs' ),
		...( room && ! UNSAID.has( room ) ? { room } : {} ),
		...( people.length ? { people } : {} )
	};

}
