/**
 * Where a world point is: a streamed room or published building footprint
 * owns occupied space, with the original parcel lots as the outdoor fallback.
 * One kit building may intentionally stand across more than one Atlas lot.
 */
export class Locator {

	/** buildingFootprints: [{ parcelId, outline, holes? }], in world coordinates. */
	constructor( atlas, transitRoutes = [], stationEntrances = [], { buildingFootprints = [] } = {} ) {

		this.districts = atlas.districts.map( ( d ) => ( {
			id: d.id,
			label: `${d.kind} · ${d.tier}`.replace( /_/g, ' ' ),
			ring: d.boundary
		} ) );

		this.parcels = atlas.parcels.map( ( p ) => ( {
			id: p.id,
			label: `${p.id} ${p.type}`.replace( /_/g, ' ' ),
			ring: p.lot ?? p.footprint
		} ) );
		this.parcelById = new Map( this.parcels.map( parcel => [ parcel.id, parcel ] ) );
		// Only a published, known building can own space. Do not enlarge its
		// source lot or relabel a whole absorbed lot: courtyards and setbacks
		// outside the occupied outline retain their original geography.
		this.buildingFootprints = buildingFootprints.filter( footprint =>
			this.parcelById.has( footprint.parcelId ) && footprint.outline?.length >= 3 );

		const busLevels = new Map();
		for ( const route of transitRoutes.filter( ( candidate ) => candidate.kind === 'bus' ) ) {

			for ( const stop of route.stops ) if ( ! busLevels.has( stop.stopId ) ) busLevels.set( stop.stopId, stop.y );

		}
		this.transitPlaces = [
			...( atlas.transit?.busStops ?? [] ).map( ( stop ) => ( {
				kind: 'bus-stop', id: stop.id,
				position: [ stop.position[ 0 ], busLevels.get( stop.id ) ?? 0, stop.position[ 1 ] ], ring: null
			} ) ),
			...( atlas.transit?.trainStations ?? [] ).map( ( station ) => stationPlace( 'train-station', station ) ),
			...( atlas.transit?.subwayStations ?? [] ).map( ( station ) => stationPlace( 'subway-station', station ) ),
			...stationEntrances.flatMap( entry => [
				{ kind: `${entry.kind}-station`, id: entry.stationId, position: [ entry.origin[ 0 ], entry.top, entry.origin[ 1 ] ], ring: null },
				{ kind: `${entry.kind}-station`, id: entry.stationId, position: entry.arrival, ring: null }
			] )
		];

	}

	/** The exact published stop or platform under the player's feet. */
	transitPlace( x, y, z ) {

		const candidates = this.transitPlaces.filter( ( place ) => {

			if ( Math.abs( place.position[ 1 ] - y ) > 1 ) return false;
			if ( place.ring ) return inside( place.ring, x, z );
			return Math.hypot( place.position[ 0 ] - x, place.position[ 2 ] - z ) <= 3;

		} );
		candidates.sort( ( left, right ) => horizontalDistance( left.position, x, z )
			- horizontalDistance( right.position, x, z ) || transitKey( left ).localeCompare( transitKey( right ) ) );
		const place = candidates[ 0 ];
		return place ? { kind: place.kind, id: place.id } : null;

	}

	district( x, z ) {

		return this.districts.find( ( d ) => inside( d.ring, x, z ) )?.label ?? 'outskirts';

	}

	parcel( x, z, roomParcelId = null ) {

		return this.#parcelAt( x, z, roomParcelId )?.label ?? null;

	}

	/** The actual standing building at this point, excluding lot setbacks and holes. */
	occupiedParcelId( x, z ) {

		return this.buildingFootprints.find( footprint =>
			( inside( footprint.outline, x, z ) || onRing( footprint.outline, x, z ) ) &&
			! ( footprint.holes ?? [] ).some( hole => inside( hole, x, z ) || onRing( hole, x, z ) ) )?.parcelId ?? null;

	}

	/** Exact runtime place identities at a point, including an authoritative streamed room parcel. */
	refs( x, z, roomParcelId = null ) {

		const refs = [];
		const district = this.districts.find( ( candidate ) => inside( candidate.ring, x, z ) );
		if ( district ) refs.push( { kind: 'district', id: district.id } );

		const parcel = this.#parcelAt( x, z, roomParcelId );
		if ( parcel ) refs.push( { kind: 'parcel', id: parcel.id } );

		return refs;

	}

	/** Stable save-game location, preferring the parcel over its containing district. */
	location( x, z, roomParcelId = null ) {

		const parcel = this.#parcelAt( x, z, roomParcelId );
		if ( parcel ) return { id: parcel.id, name: parcel.label };

		const district = this.districts.find( ( candidate ) => inside( candidate.ring, x, z ) );
		return district ? { id: district.id, name: district.label } : { id: 'outskirts', name: 'outskirts' };

	}

	#parcelAt( x, z, roomParcelId ) {

		const room = this.parcelById.get( roomParcelId );
		if ( room ) return room;
		const buildingId = this.occupiedParcelId( x, z );
		if ( buildingId ) return this.parcelById.get( buildingId );
		return this.parcels.find( parcel => inside( parcel.ring, x, z ) );

	}

}

function stationPlace( kind, station ) {

	return {
		kind,
		id: station.id,
		position: [ station.position[ 0 ], station.level, station.position[ 1 ] ],
		ring: station.platform
	};

}

function horizontalDistance( position, x, z ) {

	return Math.hypot( position[ 0 ] - x, position[ 2 ] - z );

}

function transitKey( place ) {

	return `${place.kind}:${place.id}`;

}

function inside( ring, x, z ) {

	let hit = false;

	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ xi, zi ] = ring[ i ];
		const [ xj, zj ] = ring[ j ];

		if ( ( zi > z ) !== ( zj > z ) && x < ( ( xj - xi ) * ( z - zi ) ) / ( zj - zi ) + xi ) hit = ! hit;

	}

	return hit;

}

/** Occupied outer edges belong to the building; a hole edge belongs to the hole. */
function onRing( ring, x, z ) {

	const epsilon = 1e-7;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ ax, az ] = ring[ j ];
		const [ bx, bz ] = ring[ i ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );
		if ( length === 0 ) continue;
		if ( Math.abs( dx * ( z - az ) - dz * ( x - ax ) ) > epsilon * length ) continue;
		const along = ( x - ax ) * dx + ( z - az ) * dz;
		if ( along >= - epsilon * length && along <= length * length + epsilon * length ) return true;

	}
	return false;

}
