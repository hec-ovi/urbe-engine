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

/**
 * A district of street modules the way Atlas publishes one without paving
 * bands, on Klamm's measures: 14 m avenues and a 7 m side street with 0.5 m
 * gutters, 0.2 m kerbs and 4.2 m sidewalks, lots behind them, crossing
 * landings that take the whole pavement where a street's first post is due, a
 * parking lay-by, a courtyard, a fringe strip and a lot strip facing the
 * highway that no walk route enters, a tree on the pavement, and a highway on
 * an 8 m deck passing over the east avenue's node, with the court beneath it
 * and the block sidewalks beside it painted on the ground as Atlas paints
 * them.
 */
export function streetLampDistrictFixture() {
	const atlas = {
		parcels: [], streets: { nodes: [], edges: [], planting: [], highwayStructures: [], construction: { junctions: [] } },
		volumetric: { buildings: [], ground: [] }
	};
	const walk = { nodes: [], edges: [] };
	// Axis-aligned cover between two corners, wound counter-clockwise.
	const box = ( x0, z0, x1, z1 ) => rectangle( Math.min( x0, x1 ), Math.min( z0, z1 ), Math.abs( x1 - x0 ), Math.abs( z1 - z0 ) );
	const ground = ( surface, ...boxes ) => {
		for ( const corners of boxes ) atlas.volumetric.ground.push( { surface, polygon: box( ...corners ), bottom: 0, top: surface === 'roadway' || surface === 'gutter' ? 0 : 0.2 } );
	};
	const building = ( id, ...corners ) => {
		const footprint = box( ...corners );
		atlas.parcels.push( { id, footprint } );
		atlas.volumetric.buildings.push( { parcelId: id, footprint, height: 20 } );
	};
	const route = ( id, path, kind = 'sidewalk', width = 2 ) => {
		const from = `${id}:start`, to = `${id}:end`;
		walk.nodes.push( { id: from, x: path[ 0 ][ 0 ], y: 0.2, z: path[ 0 ][ 1 ], kind: 'sidewalk' }, { id: to, x: path.at( - 1 )[ 0 ], y: 0.2, z: path.at( - 1 )[ 1 ], kind: 'sidewalk' } );
		walk.edges.push( { id, from, to, kind, width, level: 0.2, path, path3: path.map( ( [ x, z ] ) => [ x, 0.2, z ] ) } );
	};
	const side = { profileId: 'district', bands: { curb: 0.2, border: 1, furnishing: 1, walking: 2, frontage: 0.2 },
		geometry: { version: '1.0.0', edge: { curbRise: 0.2, gutter: { width: 0.5 } }, pavedWidth: 4.2, totalWidth: 4.9 } };
	const street = ( id, from, to, width = 14 ) => atlas.streets.edges.push( {
		id, class: width > 7 ? 'road' : 'street', from: from.id, to: to.id, path: [ from.position, to.position ], width, sidewalk: { left: 4.9, right: 4.9 }, level: 0,
		crossSection: { profileId: width > 7 ? 'avenue' : 'local', sidewalks: { left: side, right: side } }
	} );
	const highway = ( id, from, to ) => atlas.streets.edges.push( {
		id, class: 'highway', from: from.id, to: to.id, path: [ from.position, to.position ], width: 14, sidewalk: { left: 0, right: 0 }, level: 8
	} );
	// Atlas groups the edges meeting at a node by the level they meet at.
	const node = ( id, position, levels ) => {
		const value = { id, position, edgeIds: levels.flatMap( ( [ , ids ] ) => ids ), connections: levels.map( ( [ level, edgeIds ] ) => ( { level, edgeIds } ) ) };
		atlas.streets.nodes.push( value );
		return value;
	};

	// The avenue along z = 0 in three runs, the cross avenue along x = 0, a side
	// street meeting the avenue from the south at x = 100, and the highway
	// along x = 200, its deck over the avenue's node there.
	const c = node( 'c', [ 0, 0 ], [ [ 0, [ 'w', 'e', 's', 'n' ] ] ] );
	const t = node( 't', [ 100, 0 ], [ [ 0, [ 'e', 'e1', 'm' ] ] ] );
	const h = node( 'h', [ 200, 0 ], [ [ 0, [ 'e1', 'e2' ] ], [ 8, [ 'hs', 'hn' ] ] ] );
	const end = ( id, position, level = 0 ) => node( `${id}:end`, position, [ [ level, [ id ] ] ] );
	street( 'w', end( 'w', [ - 120, 0 ] ), c ); street( 'e', c, t ); street( 'e1', t, h ); street( 'e2', end( 'e2', [ 320, 0 ] ), h );
	street( 's', end( 's', [ 0, - 60 ] ), c ); street( 'n', c, end( 'n', [ 0, 60 ] ) ); street( 'm', end( 'm', [ 100, - 60 ] ), t, 7 );
	highway( 'hs', h, end( 'hs', [ 200, - 60 ], 8 ) ); highway( 'hn', h, end( 'hn', [ 200, 60 ], 8 ) );
	atlas.streets.highwayStructures.push( {
		edgeIds: [ 'hs', 'hn' ], path: [ [ 200, - 60 ], [ 200, 60 ] ], width: 14, level: 8, deckThickness: 1,
		elevationProfile: [ { distance: 0, level: 8 }, { distance: 120, level: 8 } ],
		supports: [ - 30, 30 ].map( z => ( { position: [ 200, z ], footprint: box( 199, z - 1, 201, z + 1 ), bottom: 0, top: 7 } ) )
	} );

	// Asphalt: the streets, a 2 m parking bay on the west avenue's north side
	// and the court under the deck, which Atlas paints as roadway.
	ground( 'roadway', [ - 120, - 7, 320, 7 ], [ - 7, - 60, 7, - 7 ], [ - 7, 7, 7, 60 ], [ 96.5, - 60, 103.5, - 7 ],
		[ - 100, 7, - 60, 9 ], [ 193, - 60, 207, - 7 ], [ 193, 7, 207, 60 ] );
	for ( const s of [ - 1, 1 ] ) {
		for ( const [ x0, x1, out ] of s > 0 ? [ [ - 120, - 100, 0 ], [ - 100, - 60, 2 ], [ - 60, - 7, 0 ], [ 7, 193, 0 ], [ 207, 320, 0 ] ] : [ [ - 120, - 7, 0 ], [ 7, 193, 0 ], [ 207, 320, 0 ] ] ) {
			ground( 'gutter', [ x0, s * ( 7 + out ), x1, s * ( 7.5 + out ) ] );
			ground( 'curb', [ x0, s * ( 7.5 + out ), x1, s * ( 7.7 + out ) ] );
		}
		for ( const [ x, half, z0, z1 ] of [ [ 0, 7, 7, 60 ], [ 0, 7, - 60, - 7 ], [ 100, 3.5, - 60, - 7 ], [ 200, 7, 7, 60 ], [ 200, 7, - 60, - 7 ] ] ) {
			ground( 'gutter', [ x + s * half, z0, x + s * ( half + 0.5 ), z1 ] );
			ground( 'curb', [ x + s * ( half + 0.5 ), z0, x + s * ( half + 0.7 ), z1 ] );
		}
	}
	// Sidewalks, one cover per stretch: the avenue's run its corners, the cross
	// streets' start behind them, and the block sidewalks beside the court.
	ground( 'sidewalk',
		[ - 120, 7.7, - 100, 11.9 ], [ - 100, 9.7, - 60, 11.9 ], [ - 60, 7.7, - 7.7, 11.9 ], [ 7.7, 7.7, 192.3, 11.9 ], [ 207.7, 7.7, 320, 11.9 ],
		[ - 120, - 11.9, - 7.7, - 7.7 ], [ 7.7, - 11.9, 95.8, - 7.7 ], [ 104.2, - 11.9, 192.3, - 7.7 ], [ 207.7, - 11.9, 320, - 7.7 ],
		[ - 11.9, 11.9, - 7.7, 60 ], [ 7.7, 11.9, 11.9, 60 ], [ - 11.9, - 60, - 7.7, - 11.9 ], [ 7.7, - 60, 11.9, - 11.9 ],
		[ 91.6, - 60, 95.8, - 11.9 ], [ 104.2, - 60, 108.4, - 11.9 ],
		[ 188.1, 11.9, 192.3, 60 ], [ 207.7, 11.9, 211.9, 60 ], [ 188.1, - 60, 192.3, - 11.9 ], [ 207.7, - 60, 211.9, - 11.9 ] );
	// Lots, a courtyard in the north-east block, the fringe past the west
	// avenue's end and an unbuilt strip along the court's north-east sidewalk,
	// so that sidewalk passes no facade there; no walk route enters any of them.
	ground( 'block', [ - 120, 11.9, - 11.9, 60 ], [ 11.9, 11.9, 188.1, 60 ], [ 211.9, 11.9, 320, 29 ], [ 240, 29, 320, 60 ],
		[ - 120, - 60, - 11.9, - 11.9 ], [ 11.9, - 60, 91.6, - 11.9 ], [ 108.4, - 60, 188.1, - 11.9 ], [ 211.9, - 60, 320, - 11.9 ] );
	ground( 'open', [ 60, 30, 120, 50 ], [ - 140, - 60, - 120, 60 ], [ 211.9, 29, 240, 60 ] );

	// Crosswalks: at the four-way junction 8 to 12 m out, and across the east
	// run just past the side street's sidewalk, where its first post is due.
	const landing = ( edgeId, a, b ) => ( { edgeId, landings: { left: box( ...a ), right: box( ...b ) } } );
	atlas.streets.construction.junctions.push( { approaches: [
		landing( 'e', [ 8, 7.7, 12, 11.9 ], [ 8, - 11.9, 12, - 7.7 ] ),
		landing( 'w', [ - 12, 7.7, - 8, 11.9 ], [ - 12, - 11.9, - 8, - 7.7 ] ),
		landing( 'n', [ 7.7, 8, 11.9, 12 ], [ - 11.9, 8, - 7.7, 12 ] ),
		landing( 's', [ 7.7, - 12, 11.9, - 8 ], [ - 11.9, - 12, - 7.7, - 8 ] )
	] }, { approaches: [ landing( 'e1', [ 108.4, 7.7, 112.4, 11.9 ], [ 108.4, - 11.9, 112.4, - 7.7 ] ) ] } );
	route( 'cross:e', [ [ 10, - 10.7 ], [ 10, 10.7 ] ], 'crossing', 3 );
	route( 'cross:w', [ [ - 10, - 10.7 ], [ - 10, 10.7 ] ], 'crossing', 3 );
	route( 'cross:n', [ [ - 10.7, 10 ], [ 10.7, 10 ] ], 'crossing', 3 );
	route( 'cross:s', [ [ - 10.7, - 10 ], [ 10.7, - 10 ] ], 'crossing', 3 );
	route( 'cross:e1', [ [ 110.4, - 10.7 ], [ 110.4, 10.7 ] ], 'crossing', 3 );
	// Each sidewalk's walking band, 3.7 m behind its kerb.
	for ( const s of [ - 1, 1 ] ) {
		const runs = s > 0 ? [ [ - 120, - 10.7 ], [ 10.7, 190.2 ], [ 209.8, 320 ] ] : [ [ - 120, - 10.7 ], [ 10.7, 92.8 ], [ 107.2, 190.2 ], [ 209.8, 320 ] ];
		for ( const [ x0, x1 ] of runs ) route( `walk:${s}:${x0}`, [ [ x0, s * 10.7 ], [ x1, s * 10.7 ] ] );
		for ( const x of [ - 10.7, 10.7, 190.2, 209.8 ] ) route( `walk:${s}:x${x}`, [ [ x, s * 10.7 ], [ x, s * 60 ] ] );
	}
	for ( const x of [ 92.8, 107.2 ] ) route( `walk:m:${x}`, [ [ x, - 10.7 ], [ x, - 60 ] ] );

	// Frontages along the avenues and the court, so a stretch no post reaches
	// has a wall to light it from, all but the court's north-east side.
	for ( const s of [ - 1, 1 ] ) {
		building( `front:w:${s}`, - 118, s * 13, - 13, s * 28 );
		building( `front:e2:${s}`, 213, s * 13, 318, s * 28 );
		building( `court:west:${s}`, 170, s * 29, 186, s * 58 );
	}
	building( 'court:east:-1', 213, - 29, 229, - 58 );
	building( 'front:e:1', 13, 13, 186, 28 );
	building( 'front:e:-1', 13, - 13, 90, - 28 );
	building( 'front:e1:-1', 110, - 13, 186, - 28 );
	// A street tree just where the east run's fifth post is due.
	atlas.streets.planting.push( { edgeId: 'e2', kind: 'tree', position: [ 234.3, 9.4 ] } );
	return { atlas, walk, nodes: { c, t, h } };
}
