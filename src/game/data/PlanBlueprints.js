/**
 * The building plans this world stands on, each one's blueprint read once.
 *
 * A plan's blueprint is the biggest document a kit city carries, hundreds of
 * kilobytes of it, and two parts of the game want the same one: `BuildingSource`
 * composes every parcel's own blueprint from it, and the kit runtime reads the
 * plan's doors and openings out of it when it stands the plan. Both ask here,
 * so the city reads it once however many parcels and cells need it.
 */
export class PlanBlueprints {

	/**
	 * @param urls plan id -> where that plan's blueprint stands
	 * @param readJson reads one URL into a parsed document
	 * @param budget the depth of reads this city keeps in flight
	 */
	constructor( { urls = new Map(), readJson, budget } ) {

		this.urls = urls;
		this.readJson = readJson;
		this.budget = budget;
		/** plan id -> the read, so every caller waits on the same one */
		this.reading = new Map();

	}

	/** Whether this world publishes a blueprint for the plan at all. */
	has( planId ) {

		return this.urls.has( planId );

	}

	/** This plan's own blueprint, in the frame the plan was drawn in. */
	of( planId ) {

		let reading = this.reading.get( planId );

		if ( ! reading ) {

			const url = this.urls.get( planId );
			reading = this.budget.run( () => this.readJson( url ) )
				.catch( ( error ) => {

					// A failed read is not an answer, so the next caller asks again.
					this.reading.delete( planId );
					throw error;

				} );
			this.reading.set( planId, reading );

		}

		return reading;

	}

}
