/**
 * One plan's blueprint, and the parcel blueprints it stands for.
 *
 * Every parcel of a plan is the same building in a different place, so its
 * blueprint is the same document moved and turned. The city publishes that
 * document once, in the plan's own frame with its origin at zero and face 0
 * along +X, and a parcel composes its own when a consumer asks for one.
 *
 * A plan starts at its entrance corner with face 0 along +X; a parcel's lot
 * starts at its own first corner, so the record says which lot face the
 * entrance stands in and the composition renumbers rings and edges onto it.
 *
 * Two things inside a blueprint repeat as hard as the buildings do: a tower's
 * storeys are one plate over and over, and its facade grids are one grid per
 * storey and face. The plan writes each distinct plate and grid once and every
 * floor names the one it uses, which is what keeps a city's building data in
 * megabytes instead of tens of them.
 *
 * What the plan cannot say is what the parcel is used for: its floor kinds and
 * its exterior style follow the parcel's own type and tier, so they ride on the
 * placement record and are put back on the way out.
 */

/** An opening the floor's own pieces named, numbered from the plan's placements. */
const PLACED = /^place:(\d+)\/(.*)$/;

/**
 * The plan's blueprint as it is published: floors and facade grids written
 * once, and the per parcel fields left out.
 * @param blueprint Exterior's blueprint for the plan, in the plan's own frame
 */
export function packPlanBlueprint( blueprint ) {

	const { buildingId, floors, facade, ...rest } = blueprint;
	const { exteriorStyle, grids, ...facadeRest } = facade;
	const plates = distinct( floors, floorPlate );
	const gridPlates = distinct( grids, gridPlate );

	return {
		...rest,
		plates: plates.parts,
		floors: floors.map( ( floor, at ) => ( {
			index: floor.index,
			elevation: floor.elevation,
			plate: plates.of[ at ],
			// Opening ids carry the placement they came from; a plate is shared
			// by every storey of its band, so it counts from its own floor.
			placementBase: placementBase( floor )
		} ) ),
		facade: {
			...facadeRest,
			gridPlates: gridPlates.parts,
			grids: grids.map( ( grid, at ) => ( { floor: grid.floor, plate: gridPlates.of[ at ] } ) )
		}
	};

}

/**
 * One parcel's blueprint: the plan's document in the frame that parcel stands
 * in. It is the same document Exterior draws for the parcel itself, to the
 * millimetre, with the parcel's own building id, floor kinds and style, and
 * without a room envelope: that rectangle is fitted on the construction
 * lattice under the lot, which a shared plan cannot say, so it is left out
 * rather than approximated.
 * @param plan the packed plan blueprint
 * @param record the parcel's placement record
 */
export function parcelBlueprint( plan, record ) {

	const frame = new PlanFrame( record );
	const { plates, floors, facade, ...rest } = plan;
	const { gridPlates, grids, ...facadeRest } = facade;

	return {
		...rest,
		buildingId: record.parcel,
		bounds: { ...rest.bounds, footprint: frame.ring( rest.bounds.footprint ) },
		floors: floors.map( ( floor, at ) => composeFloor( plates[ floor.plate ], floor, record.floorKinds[ at ], frame ) ),
		anchors: ( rest.anchors ?? [] ).map( ( anchor ) => ( {
			...anchor, position: frame.point3( anchor.position ), normal: frame.direction( anchor.normal )
		} ) ),
		signage: ( rest.signage ?? [] ).map( ( sign ) => facing( sign, frame ) ),
		screens: ( rest.screens ?? [] ).map( ( screen ) => facing( screen, frame ) ),
		lights: ( rest.lights ?? [] ).map( ( light ) => ( {
			...facing( light, frame ), position: frame.point3( light.position )
		} ) ),
		modelInstances: rest.modelInstances?.map( ( model ) => ( {
			...model, position: frame.point3( model.position ), rotation: frame.turn( model.rotation )
		} ) ),
		facade: {
			...facadeRest,
			exteriorStyle: record.exteriorStyle,
			grids: grids.map( ( grid ) => frame.onFace( { ...gridPlates[ grid.plate ], floor: grid.floor } ) )
		},
		facadeArtifacts: ( rest.facadeArtifacts ?? [] ).map( ( artifact ) => frame.onFace( artifact ) ),
		fireEscape: rest.fireEscape ? frame.onFace( rest.fireEscape ) : rest.fireEscape,
		roof: composeRoof( rest.roof, frame )
	};

}

/**
 * Where a composed blueprint stops matching the one Exterior draws for the
 * parcel itself, or '' when the two are the same building. A drift here would
 * move every opening of every building that shares the plan, so assembly reads
 * it for each parcel rather than trusting the composition.
 *
 * Two things are the plan's and not the parcel's, and are compared as the
 * building rather than as the document: Exterior lays a parcel's pieces out
 * from the lot's first corner and a plan's from its entrance, so the two number
 * their openings and order their grids differently.
 */
export function blueprintDrift( composed, planned, tolerance = 1e-6 ) {

	return drift( asBuilding( composed ), asBuilding( planned ), tolerance, '' );

}

/**
 * A blueprint with what only labels its parts taken out of it. Exterior's own
 * document carries a room envelope and a composed one does not, so the field is
 * set aside here; everything a consumer reads is compared.
 */
function asBuilding( blueprint ) {

	return {
		...blueprint,
		floors: blueprint.floors.map( ( { openings, roomEnvelope, ...floor } ) => ( {
			...floor,
			openings: [ ...openings.map( named ) ].sort( byPlace )
		} ) ),
		facade: { ...blueprint.facade, grids: [ ...blueprint.facade.grids ].sort( byFace ) }
	};

}

/** One opening under the name its own piece gave it, not its placement's. */
function named( opening ) {

	const found = PLACED.exec( opening.id );

	return found ? { ...opening, id: found[ 2 ] } : opening;

}

const byPlace = ( a, b ) => a.edge - b.edge || a.offset - b.offset || a.sill - b.sill || a.id.localeCompare( b.id );
const byFace = ( a, b ) => a.floor - b.floor || a.edge - b.edge;

function drift( composed, planned, tolerance, path ) {

	if ( typeof composed === 'number' && typeof planned === 'number' ) {

		return Math.abs( composed - planned ) <= tolerance ? '' : `${path}: ${composed} is not ${planned}`;

	}
	if ( Array.isArray( composed ) || Array.isArray( planned ) ) {

		if ( ! Array.isArray( composed ) || ! Array.isArray( planned ) ) return `${path}: one side is not a list`;
		if ( composed.length !== planned.length ) return `${path}: ${composed.length} entries, not ${planned.length}`;

		for ( let at = 0; at < composed.length; at ++ ) {

			const found = drift( composed[ at ], planned[ at ], tolerance, `${path}/${at}` );
			if ( found ) return found;

		}

		return '';

	}
	if ( composed && planned && typeof composed === 'object' && typeof planned === 'object' ) {

		const keys = new Set( [ ...Object.keys( composed ), ...Object.keys( planned ) ]
			.filter( ( key ) => composed[ key ] !== undefined || planned[ key ] !== undefined ) );

		for ( const key of keys ) {

			const found = drift( composed[ key ], planned[ key ], tolerance, `${path}/${key}` );
			if ( found ) return found;

		}

		return '';

	}

	return composed === planned ? '' : `${path}: ${JSON.stringify( composed )} is not ${JSON.stringify( planned )}`;

}

/** Where a plan's origin stands and how far it is turned. */
class PlanFrame {

	constructor( { origin, rotationY, face } ) {

		this.origin = origin;
		this.rotationY = rotationY;
		this.face = face;
		this.cos = Math.cos( rotationY );
		this.sin = Math.sin( rotationY );

	}

	/** A point on the ground plane, in metres. */
	point( [ x, z ] ) {

		return [ this.origin[ 0 ] + x * this.cos + z * this.sin, this.origin[ 2 ] - x * this.sin + z * this.cos ];

	}

	point3( [ x, y, z ] ) {

		const [ worldX, worldZ ] = this.point( [ x, z ] );

		return [ worldX, this.origin[ 1 ] + y, worldZ ];

	}

	/** A unit vector on the ground plane: turned, never moved. */
	direction( [ x, z ] ) {

		return [ x * this.cos + z * this.sin, - x * this.sin + z * this.cos ];

	}

	/** A lot ring: turned, and started at the corner the entrance face runs from. */
	ring( points ) {

		return points.map( ( _, at ) => this.point( points[ ( at - this.face + points.length ) % points.length ] ) );

	}

	/** Anything the plan hung on one of its faces, renumbered onto the lot's. */
	onFace( mounted ) {

		return { ...mounted, edge: ( mounted.edge + this.face ) % 4 };

	}

	turn( radians ) {

		return radians + this.rotationY;

	}

	degrees( value ) {

		return value + this.rotationY * 180 / Math.PI;

	}

}

/**
 * One repeated part written once.
 * @returns `parts`, the distinct shapes in first use order, and `of`, which of
 * them each input is
 */
function distinct( inputs, shape ) {

	const seen = new Map();
	const parts = [];
	const of = [];

	for ( const input of inputs ) {

		const part = shape( input );
		const key = JSON.stringify( part );
		let at = seen.get( key );

		if ( at === undefined ) {

			at = parts.push( part ) - 1;
			seen.set( key, at );

		}

		of.push( at );

	}

	return { parts, of };

}

/**
 * One storey as its band draws it: no floor of its own, no elevation, no use.
 * The room envelope stays out: Exterior fits it on the construction lattice
 * where the lot sits, so it belongs to the parcel and not to the plan.
 */
function floorPlate( floor ) {

	const { index, elevation, kind, openings, roomEnvelope, ...rest } = floor;
	const base = placementBase( floor );

	return {
		...rest,
		openings: openings.map( ( opening ) => ( { ...opening, id: rebase( opening.id, - base ) } ) )
	};

}

function composeFloor( plate, floor, kind, frame ) {

	const { openings, outline, ...rest } = plate;

	return {
		...rest,
		index: floor.index,
		kind,
		elevation: floor.elevation,
		outline: frame.ring( outline ),
		openings: openings.map( ( opening ) => frame.onFace( { ...opening, id: rebase( opening.id, floor.placementBase ) } ) )
	};

}

/** One facade grid without the storey it was measured on. */
function gridPlate( grid ) {

	const { floor, ...rest } = grid;

	return rest;

}

function composeRoof( roof, frame ) {

	return {
		...roof,
		outline: frame.ring( roof.outline ),
		bulkhead: roof.bulkhead ? {
			...roof.bulkhead,
			center: frame.point( roof.bulkhead.center ),
			axis: frame.direction( roof.bulkhead.axis ),
			doorNormal: frame.direction( roof.bulkhead.doorNormal )
		} : roof.bulkhead,
		artifacts: ( roof.artifacts ?? [] ).map( ( artifact ) => ( {
			...artifact,
			center: frame.point( artifact.center ),
			...( artifact.rotationDeg === undefined ? {} : { rotationDeg: frame.degrees( artifact.rotationDeg ) } )
		} ) )
	};

}

/** A sign, a screen or a lamp mounted flat on one face. */
function facing( field, frame ) {

	return { ...frame.onFace( field ), center: frame.point3( field.center ), normal: frame.direction( field.normal ) };

}

/** The lowest placement any of this floor's openings came from. */
function placementBase( floor ) {

	const placed = floor.openings.map( ( opening ) => PLACED.exec( opening.id ) )
		.filter( Boolean ).map( ( found ) => Number( found[ 1 ] ) );

	return placed.length ? Math.min( ...placed ) : 0;

}

function rebase( id, by ) {

	const found = PLACED.exec( id );

	return found ? `place:${Number( found[ 1 ] ) + by}/${found[ 2 ]}` : id;

}
