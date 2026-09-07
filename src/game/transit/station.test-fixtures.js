/** Published 8 x 3 m shafts, side approaches and directed Connections service. */
export function stationCity( headings = [ 0, Math.PI / 3, - Math.PI / 2 ] ) {

	const stations = headings.map( ( heading, index ) => {
		const c = Math.cos( heading ), s = Math.sin( heading ), x = 20 + index * 100, z = 30;
		const point = ( across, along ) => [ x + c * across + s * along, z - s * across + c * along ];
		const footprint = [ [ - 1.5, - 4 ], [ 1.5, - 4 ], [ 1.5, 4 ], [ - 1.5, 4 ] ].map( p => point( ...p ) );
		const bay = [ [ - 2.5, - 5 ], [ 2.5, - 5 ], [ 2.5, 5 ], [ - 2.5, 5 ],
			[ - 2.5, 1.5 ], [ - 3.5, 1.5 ], [ - 3.5, - 1.5 ], [ - 2.5, - 1.5 ] ].map( p => point( ...p ) );
		const position = point( - 12, 0 ), origin = point( 0, 0 );
		const stairs = [ [ 0, 0 ], [ 3, - 2 ], [ - 3, - 6 ], [ 3, - 10 ], [ 0, - 12 ] ]
			.map( ( [ along, y ] ) => { const [ x, z ] = point( 0, along ); return [ x, y, z ]; } );
		const handoff = [ position[ 0 ], - 12, position[ 1 ] ];
		return {
			id: `s${index}`, name: [ 'Ash Market', 'Cinder Terminus', 'Memorial Exchange' ][ index ], districtId: 'd0',
			position, level: - 12, box: { bottom: - 12, top: - 7 },
			platform: [ [ - 16, - 70 ], [ - 8, - 70 ], [ - 8, 70 ], [ - 16, 70 ] ].map( p => point( ...p ) ),
			entrances: [ origin ],
			entranceBays: [ { edgeId: 'e0', side: 'right', distance: 20, footprint: bay, shaft: footprint, approach: [ point( - 3.5, 0 ), origin ] } ],
			shafts: [ { footprint, top: 0, bottom: - 12, passage: [ point( 0, - 2 ), point( 0, 2 ), point( - 12, 2 ), point( - 12, - 2 ) ] } ],
			accessPaths: [ { entranceIndex: 0, segments: [ { kind: 'stairs', path: stairs }, { kind: 'passage', path: [ stairs.at( - 1 ), handoff ] } ], platformHandoff: handoff } ]
		};
	} );
	return {
		districts: [], parcels: [], streets: { edges: [] },
		transit: { busStops: [], trainStations: [], subwayStations: stations },
		volumetric: { ground: [ { id: 'g0', surface: 'sidewalk', bottom: 0, top: 0.26,
			polygon: [ [ - 100, - 100 ], [ 400, - 100 ], [ 400, 200 ], [ - 100, 200 ] ] } ] }
	};

}

export function stationRoute( atlas, indices = [ 0, 1 ] ) {

	const stops = indices.map( index => atlas.transit.subwayStations[ index ] );
	const shape = stops.map( station => [ station.position[ 0 ], station.level, station.position[ 1 ] ] );
	let distance = 0;
	return {
		id: 'route-subway', kind: 'subway', lineId: 'Quiet Line', shape,
		stops: stops.map( ( station, index ) => {
			if ( index ) distance += Math.hypot( ...shape[ index ].map( ( value, axis ) => value - shape[ index - 1 ][ axis ] ) );
			return { stopId: station.id, x: shape[ index ][ 0 ], y: shape[ index ][ 1 ], z: shape[ index ][ 2 ], shapeDist: distance };
		} ),
		template: stops.map( ( _, index ) => ( { arrive: index * 110, depart: index * 110 + ( index === stops.length - 1 ? 0 : 10 ) } ) ),
		service: [ { start: 1000, end: 2000, headway: 300, phase: 0 } ]
	};

}
