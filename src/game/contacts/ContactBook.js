/**
 * The people whose number the player has: who gave it and the game minute
 * they did, in the order they gave it. The save carries `serialize()` as
 * `contacts` ([schema](schema/contacts.schema.json)), and a load hands it back
 * to `restore`.
 */
export class ContactBook {

	constructor() {

		this.entries = new Map();

	}

	/** Adds a person; somebody already in the book keeps the minute they first gave their number. */
	add( npcId, addedMin ) {

		if ( ! this.entries.has( npcId ) ) this.entries.set( npcId, { npcId, addedMin: Math.max( 0, addedMin ) } );
		return this.entries.get( npcId );

	}

	has( npcId ) {

		return this.entries.has( npcId );

	}

	get( npcId ) {

		return this.entries.get( npcId ) ?? null;

	}

	get size() {

		return this.entries.size;

	}

	/** Every contact in the order they were added. */
	list() {

		return [ ...this.entries.values() ];

	}

	serialize() {

		return this.list().map( ( { npcId, addedMin } ) => ( { npcId, addedMin } ) );

	}

	/** The book a save carried, in its order; a person listed twice keeps their first entry. */
	restore( saved = [] ) {

		this.entries.clear();
		for ( const { npcId, addedMin } of saved ) this.add( npcId, addedMin );
		return this;

	}

}
