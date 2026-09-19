/**
 * One plan's blueprint, and the parcel blueprints it stands for.
 *
 * Every parcel of a plan is the same building in a different place, so its
 * blueprint is the same document moved and turned. Exterior draws that document
 * once, in the plan's own frame with its origin at zero and face 0 along +X, and
 * a parcel composes its own when a consumer asks for one.
 *
 * The composition is that frame and nothing else: every point is moved and
 * turned, and every edge keeps the number the plan gave it, so a consumer reads
 * an outline and an opening's edge against each other exactly as it does for a
 * generated shell.
 *
 * A floor's room envelope and its construction lattice move with it: the plan
 * fitted them on its own lot, and a copy stands that same lot somewhere else.
 */

/**
 * One parcel's blueprint: the plan's document in the frame that parcel stands
 * in, under this parcel's own building id.
 * @param plan Exterior's blueprint for the plan, in the plan's own frame
 * @param record the parcel's placement record
 */
export function parcelBlueprint( plan, record ) {

	const frame = new PlanFrame( record );
	const { buildingId, floors, ...rest } = plan;

	return {
		...rest,
		buildingId: record.parcel,
		bounds: { ...rest.bounds, footprint: frame.ring( rest.bounds.footprint ) },
		floors: floors.map( ( floor ) => composeFloor( floor, frame ) ),
		anchors: ( rest.anchors ?? [] ).map( ( anchor ) => ( {
			...anchor, position: frame.point3( anchor.position ), normal: frame.direction( anchor.normal )
		} ) ),
		signage: ( rest.signage ?? [] ).map( ( sign ) => facing( sign, frame ) ),
		screens: ( rest.screens ?? [] ).map( ( screen ) => facing( screen, frame ) ),
		lights: ( rest.lights ?? [] ).map( ( light ) => facing( light, frame ) ),
		modelInstances: rest.modelInstances?.map( ( model ) => ( {
			...model, position: frame.point3( model.position ), rotation: frame.turn( model.rotation )
		} ) ),
		roof: composeRoof( rest.roof, frame )
	};

}

/** Where a plan's origin stands and how far it is turned. */
export class PlanFrame {

	constructor( { origin, rotationY } ) {

		this.origin = origin;
		this.rotationY = rotationY;
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

	/** A direction in space: turned on the ground plane, its rise kept. */
	direction3( [ x, y, z ] ) {

		const [ turnedX, turnedZ ] = this.direction( [ x, z ] );

		return [ turnedX, y, turnedZ ];

	}

	/** A ring of the plan's own ground plane, in world metres. */
	ring( points ) {

		return points.map( ( point ) => this.point( point ) );

	}

	turn( radians ) {

		return radians + this.rotationY;

	}

	/** A heading measured as atan2(z, x), turned with everything else. */
	heading( radians ) {

		const [ x, z ] = this.direction( [ Math.cos( radians ), Math.sin( radians ) ] );

		return Math.atan2( z, x );

	}

	degrees( value ) {

		return value + this.rotationY * 180 / Math.PI;

	}

}

/** One storey of the plan, standing where this parcel stands. */
function composeFloor( floor, frame ) {

	const { outline, roomEnvelope, ...rest } = floor;

	return {
		...rest,
		outline: frame.ring( outline ),
		...( roomEnvelope ? { roomEnvelope: composeEnvelope( roomEnvelope, frame ) } : {} )
	};

}

/** The rectangle interior partitions inside, and the lattice it was fitted on. */
function composeEnvelope( envelope, frame ) {

	return {
		...envelope,
		corners: frame.ring( envelope.corners ),
		origin: frame.point( envelope.origin ),
		axisU: frame.direction( envelope.axisU ),
		axisV: frame.direction( envelope.axisV ),
		grid: {
			...envelope.grid,
			origin: frame.point( envelope.grid.origin ),
			angle: frame.heading( envelope.grid.angle )
		}
	};

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
			...( artifact.rotationDeg === undefined ? {} : { rotationDeg: frame.degrees( artifact.rotationDeg ) } ),
			...( artifact.mastAssembly ? { mastAssembly: composeMast( artifact.mastAssembly, frame ) } : {} )
		} ) )
	};

}

/**
 * An antenna mast, standing on this parcel's roof.
 *
 * Its external attachments are where the city's rooftop cables are fitted, so a
 * point left in the plan's frame hangs a cable over the origin of the city
 * instead of over the building that offers it.
 */
function composeMast( mast, frame ) {

	const segment = ( { from, to } ) => ( { from: frame.point3( from ), to: frame.point3( to ) } );

	return {
		...mast,
		mast: segment( mast.mast ),
		arms: mast.arms.map( segment ),
		supports: mast.supports.map( segment ),
		cableAttachments: mast.cableAttachments.map( ( point ) => frame.point3( point ) ),
		cables: mast.cables.map( ( cable ) => ( { ...cable, path: cable.path.map( ( point ) => frame.point3( point ) ) } ) ),
		externalAttachments: mast.externalAttachments.map( ( attachment ) => ( {
			...attachment,
			position: frame.point3( attachment.position ),
			...( attachment.normal ? { normal: frame.direction3( attachment.normal ) } : {} )
		} ) )
	};

}

/**
 * A sign, a screen or a lamp mounted on one face, with whichever of its point
 * and its normal it publishes moved into this parcel's frame.
 */
function facing( field, frame ) {

	const moved = { ...field };

	if ( field.center ) moved.center = frame.point3( field.center );
	if ( field.position ) moved.position = frame.point3( field.position );
	if ( field.normal ) moved.normal = frame.direction( field.normal );

	return moved;

}
