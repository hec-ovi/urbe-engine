/**
 * The city as the preview draws it: one entry per parcel with its footprint
 * and its floors. A built parcel takes the floors its assembled blueprint
 * published (elevation and height each), an unbuilt one stands as a single
 * prism of the atlas envelope height, so the map is honest about what exists.
 */
export function cityModel( atlas, builtFloors ) {

	const byParcel = new Map( atlas.parcels.map( ( p ) => [ p.id, p ] ) );

	const buildings = atlas.volumetric.buildings
		.filter( ( b ) => b.footprint.length >= 3 )
		.map( ( b ) => {

			const parcel = byParcel.get( b.parcelId );
			const floors = builtFloors.get( b.parcelId );
			return {
				parcelId: b.parcelId,
				ring: b.footprint,
				built: Boolean( floors ),
				type: parcel?.type ?? 'unknown',
				tier: parcel?.tier ?? 'unknown',
				name: parcel?.name ?? null,
				floors: floors
					? floors.filter( ( f ) => f.index >= 0 ).map( ( f ) => ( { index: f.index, elevation: f.elevation, height: f.height } ) )
					: [ { index: 0, elevation: 0, height: b.height } ]
			};

		} );

	return { buildings, ground: atlas.volumetric.ground };

}

/** The parcel a picked scene object belongs to, or null: objects are named `parcel:<id>` up the chain. */
export function parcelOf( object ) {

	for ( let node = object; node; node = node.parent ) {

		if ( typeof node.name === 'string' && node.name.startsWith( 'parcel:' ) ) return node.name.slice( 'parcel:'.length );

	}

	return null;

}

/** The viewer page for one parcel of a served world. */
export function viewerUrl( parcelId, out ) {

	return `?mode=building&parcel=${encodeURIComponent( parcelId )}&out=${encodeURIComponent( out )}`;

}
