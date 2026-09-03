/**
 * Where a world point is, in the blueprint's own terms: which district, and
 * which parcel if you are standing on one. Small city, few polygons, so a
 * direct point-in-polygon test is the whole implementation.
 */
export class Locator {

	constructor( atlas, transitRoutes = [] ) {

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
			...( atlas.transit?.subwayStations ?? [] ).map( ( station ) => stationPlace( 'subway-station', station ) )
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

	parcel( x, z ) {

		return this.parcels.find( ( p ) => inside( p.ring, x, z ) )?.label ?? null;

	}

	/** Exact runtime place identities at a point, including an authoritative streamed room parcel. */
	refs( x, z, roomParcelId = null ) {

		const refs = [];
		const district = this.districts.find( ( candidate ) => inside( candidate.ring, x, z ) );
		if ( district ) refs.push( { kind: 'district', id: district.id } );

		const parcel = roomParcelId
			? this.parcels.find( ( candidate ) => candidate.id === roomParcelId )
			: this.parcels.find( ( candidate ) => inside( candidate.ring, x, z ) );
		if ( parcel ) refs.push( { kind: 'parcel', id: parcel.id } );

		return refs;

	}

	/** Stable save-game location, preferring the parcel over its containing district. */
	location( x, z ) {

		const parcel = this.parcels.find( ( candidate ) => inside( candidate.ring, x, z ) );
		if ( parcel ) return { id: parcel.id, name: parcel.label };

		const district = this.districts.find( ( candidate ) => inside( candidate.ring, x, z ) );
		return district ? { id: district.id, name: district.label } : { id: 'outskirts', name: 'outskirts' };

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
