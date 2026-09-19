import { PlanFrame } from './kit/index.js';

/**
 * The city the links pass reads: what each parcel really stands.
 *
 * Connections cuts every link end on the parcel's own footprint face and hangs
 * it under the roof it is told. An ordinary parcel stands a shared plan, whose
 * facade is inset from the Atlas massing, whose roof is Exterior's rather than
 * a floor count times a pitch, and which covers its neighbour's lot when a
 * block's variation merged the two. So the pass runs on an Atlas whose standing
 * parcels carry the ring their building stands on, and a lot with nothing on it
 * is reported as such: it takes no link and obstructs none.
 *
 * A parcel left out keeps its Atlas massing, which is what a building nobody
 * has drawn yet is planned against.
 */
export class StandingBuildings {

	constructor() {

		/** parcel id -> { footprint, roof, stands } */
		this.standing = new Map();

	}

	/** A kit parcel: its plan's massing, in the frame the parcel stands in. */
	kit( parcelId, plan, frame ) {

		this.place( parcelId, new PlanFrame( frame ).ring( plan.bounds.footprint ), plan.roof.elevation );

	}

	/** A building whose own blueprint already stands in world metres. */
	place( parcelId, footprint, roof ) {

		this.standing.set( parcelId, { footprint, roof } );

	}

	/** A lot with no building on it: a merged lot, or one whose building failed. */
	empty( parcelId ) {

		this.standing.set( parcelId, { footprint: null, roof: 0 } );

	}

	/** The Atlas the pass reads, with standing rings in place of the massing. */
	atlas( atlas ) {

		return {
			...atlas,
			parcels: atlas.parcels.map( ( parcel ) => {

				const footprint = this.standing.get( parcel.id )?.footprint;

				return footprint ? { ...parcel, footprint } : parcel;

			} )
		};

	}

	/** `params.buildings`: the roof each end hangs under, per ../../../connections/CONTRACT.md. */
	get roofs() {

		return Object.fromEntries( [ ...this.standing ]
			.map( ( [ id, { footprint, roof } ] ) => [ id, { roof, stands: footprint !== null } ] ) );

	}

}
