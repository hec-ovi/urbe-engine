import { buildingAddresses } from '../access/Addresses.js';

/** Interior's entrance kit by building tier, as it furnishes an apartment entrance that names none. */
const TIER_KIT = Object.freeze( { poor: 'damaged', mid: 'capsule', rich: 'luxury', high_rich: 'luxury' } );
/** A door head as Interior frames one: 2.5 m for one or two leaves, 3 m for more, a casing under the ceiling. */
const HEAD = 2.5;
const WIDE_HEAD = 3;
const CASING = 0.08;
/** The pocket leaf module's own width and height, which a doorway's leaves are scaled from. */
const LEAF_WIDTH = 0.9;
const LEAF_HEIGHT = 2.5;
/** What Interior's apartment doors run to past half their doorway. */
const OVERRUN = 0.055;

/**
 * The doors the engine stands in the doorways of a building's private rooms
 * (its offices, executive offices, kitchens behind a counter, archives, stores,
 * plant and locker rooms, security and server rooms), which Interior publishes
 * as open framed passages. Each is an entrance in the form Interior gives an
 * apartment's (`role: 'room'`): a pair of the building's own pocket leaves
 * scaled to the doorway, closing in the wall line and sliding along it, with
 * the scope that opens it and the room's address label. The floor's build
 * stands them as it stands apartment doors (ApartmentDoors), so they lock,
 * open, close by themselves and are walked through as those are.
 *
 * Derived at load from the published layouts; nothing is published for them.
 * @param parcelId the building's parcel
 * @param interior `{ building, layouts }` as BuildingSource reads them
 * @returns Map of floor index to that floor's room entrances
 */
export function roomEntrances( parcelId, interior ) {

	const byFloor = new Map();
	let units;
	try {

		units = buildingAddresses( parcelId, { interior } ).units.filter( ( unit ) => unit.kind === 'room' );

	} catch {

		return byFloor;

	}
	if ( ! units.length ) return byFloor;
	const leaf = `apartment-pocket-leaf-${kitOf( interior.building )}`;
	for ( const unit of units ) {

		const floor = interior.building.floors.find( ( entry ) => entry.index === unit.floor );
		const layout = interior.layouts?.[ floor?.layout ]?.floor ?? null;
		const room = layout?.rooms?.find( ( candidate ) => candidate.id === unit.roomId );
		if ( ! room ) continue;
		const clear = Number.isFinite( layout.ceilingElevation ) && Number.isFinite( layout.elevation ) ? layout.ceilingElevation - layout.elevation : 3;
		for ( const door of unit.doors ) {

			const published = room.doors?.find( ( entry ) => entry.id === door.connection )
				?? layout.rooms.flatMap( ( other ) => other.doors ?? [] ).find( ( entry ) => entry.id === door.connection );
			const height = Math.round( Math.min( ( published?.leaves ?? 1 ) >= 3 ? WIDE_HEAD : HEAD, clear - 2 * CASING ) * 1e6 ) / 1e6;
			if ( ! byFloor.has( unit.floor ) ) byFloor.set( unit.floor, [] );
			byFloor.get( unit.floor ).push( entrance( unit, door, height, leaf ) );

		}

	}
	return byFloor;

}

/** The kit a building's doors are made in: the one its apartment doors wear, else its tier's. */
function kitOf( building ) {

	for ( const floor of building.floors ?? [] ) for ( const entrance of floor.apartmentEntrances ?? [] ) {

		const kit = /^apartment-pocket-leaf-(\w+)$/.exec( entrance.leaves?.[ 0 ]?.module ?? '' )?.[ 1 ];
		if ( kit ) return kit;

	}
	return TIER_KIT[ building.tier ] ?? 'luxury';

}

/**
 * One doorway's entrance, as Interior builds an apartment's: the hinge at the
 * doorway's start along the wall, +X across the opening, +Z into the room,
 * the two leaves meeting in the middle and each running half the doorway and
 * a little more into the wall beside it.
 */
function entrance( unit, door, height, leaf ) {

	const [ ix, iz ] = door.inward;
	const along = [ iz, - ix ];
	const half = door.width / 2;
	const travel = half + OVERRUN;
	const hinge = [ door.position[ 0 ] - along[ 0 ] * half, door.position[ 1 ] - along[ 1 ] * half ];
	const rotationY = - Math.atan2( along[ 1 ], along[ 0 ] );
	const at = ( x ) => [ hinge[ 0 ] + along[ 0 ] * x, 0, hinge[ 1 ] + along[ 1 ] * x ];
	const scale = [ half / LEAF_WIDTH, height / LEAF_HEIGHT, 1 ];
	return {
		id: `room:${unit.roomId}:${door.connection}`, role: 'room', scope: unit.scope, label: unit.label, number: unit.number,
		privateRoom: unit.roomId, corridorRoom: door.from, connection: door.connection,
		position: [ door.position[ 0 ], door.position[ 1 ] ], inward: [ ix, iz ], width: door.width, height, leafDepth: 0.06,
		motion: { kind: 'pocket', maxTravel: travel, leaves: [ { leaf: 0, travelU: - travel }, { leaf: 1, travelU: travel } ] },
		leaves: [
			{ module: leaf, position: at( 0 ), rotationY, scale },
			{ module: leaf, position: at( door.width ), rotationY: rotationY + Math.PI, scale }
		],
		pockets: [],
		fixed: []
	};

}
