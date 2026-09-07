const rectangle = ( x, z, width, depth ) => [ [ x, z ], [ x + width, z ], [ x + width, z + depth ], [ x, z + depth ] ];

/** Authored streets, wall-lit alley, plaza and crossing overhead volumes. */
export function streetLampFixture() {
	const atlas = { parcels: [], streets: { nodes: [], edges: [], planting: [], highwayStructures: [] }, volumetric: { buildings: [], ground: [] } };
	const walk = { nodes: [], edges: [] };
	const building = ( id, footprint ) => {
		atlas.parcels.push( { id, footprint } );
		atlas.volumetric.buildings.push( { parcelId: id, footprint, height: 20 } );
	};
	const route = ( id, path, kind = 'sidewalk', level = 0.15 ) => {
		const from = `${id}:start`, to = `${id}:end`;
		const nodeKind = kind === 'link' ? 'link-portal' : 'sidewalk';
		walk.nodes.push( { id: from, x: path[ 0 ][ 0 ], y: level, z: path[ 0 ][ 1 ], kind: nodeKind }, { id: to, x: path.at( - 1 )[ 0 ], y: level, z: path.at( - 1 )[ 1 ], kind: nodeKind } );
		walk.edges.push( { id, from, to, kind, width: 1.5, level, path, path3: path.map( ( [ x, z ] ) => [ x, level, z ] ), ...( kind === 'link' ? { linkId: id } : {} ) } );
	};
	const street = ( id, z, length, width, kind = 'street' ) => {
		const from = `${id}:start`, to = `${id}:end`;
		atlas.streets.nodes.push( { id: from, position: [ 0, z ], edgeIds: [ id ] }, { id: to, position: [ length, z ], edgeIds: [ id ] } );
		atlas.streets.edges.push( { id, from, to, class: kind, width, sidewalk: { left: 2.5, right: 2.5 }, path: [ [ 0, z ], [ length, z ] ] } );
		if ( width ) atlas.volumetric.ground.push( { surface: 'roadway', polygon: rectangle( 0, z - width / 2, length, width ), bottom: 0, top: 0 } );
		for ( const side of [ - 1, 1 ] ) atlas.volumetric.ground.push( { surface: 'sidewalk', polygon: rectangle( 0, z + ( side < 0 ? - width / 2 - 2.5 : width / 2 ), length, 2.5 ), bottom: 0, top: 0.15 } );
	};
	for ( let i = 0; i < 8; i ++ ) {
		const z = i * 40;
		street( `street-${i}`, z, 300, 7 );
		building( `north-${i}`, rectangle( 0, z + 8, 300, 10 ) );
		building( `south-${i}`, rectangle( 0, z - 18, 300, 10 ) );
		for ( const side of [ - 1, 1 ] ) route( `walk-${i}-${side}`, [ [ 0, z + side * 5 ], [ 300, z + side * 5 ] ] );
		atlas.streets.planting.push( { edgeId: `street-${i}`, kind: 'tree', position: [ 9.5, z - 3.99 ] } );
	}
	street( 'alley', 350, 120, 0, 'alley' );
	building( 'alley-north', rectangle( 0, 353, 120, 12 ) );
	building( 'alley-south', rectangle( 0, 335, 120, 12 ) );
	route( 'alley-walk', [ [ 0, 350 ], [ 120, 350 ] ] );
	const plaza = rectangle( 340, 100, 60, 60 );
	atlas.volumetric.ground.push( { surface: 'open', polygon: plaza, bottom: 0, top: 0.15 } );
	route( 'plaza-walk', [ ...plaza, plaza[ 0 ] ] );
	atlas.streets.highwayStructures.push( {
		path: [ [ 55, 0 ], [ 140, 0 ] ], width: 12, deckThickness: 0.4,
		elevationProfile: [ { distance: 0, level: 6.6 }, { distance: 85, level: 6.6 } ],
		supports: [ { footprint: rectangle( 84.5, - 5.5, 2, 2 ), bottom: 0, top: 6.2 } ]
	} );
	route( 'raised-link', [ [ 200, 3.22 ], [ 240, 3.22 ] ], 'link', 4 );
	return { atlas, walk };
}
