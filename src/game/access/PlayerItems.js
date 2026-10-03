/**
 * What the player carries of their own, apart from the quest items a story
 * hands out: general items, each `{ id, kind, label, data, quantity }`, where
 * `kind` names what it is (`access-card` now; pen drives, headsets and drinks
 * later), `label` is what the inventory calls it and `data` is the kind's own
 * record. They are saved in the descriptor's `player.inventory` beside the
 * quest items, as `{ id, name: label, quantity, state: { kind, data } }`, and
 * taken back from it by kind.
 */

/** The kinds of item the player's own store holds; any other saved item stays the quests'. */
export const ITEM_KINDS = Object.freeze( [ 'access-card' ] );

export class PlayerItems {

	constructor() {

		this.items = new Map();

	}

	/** Adds an item; false when the player already carries one of that id, which keeps its first record. */
	add( item ) {

		if ( ! item?.id || ! item.kind || ! item.label ) throw new Error( 'an item needs an id, a kind and a label' );
		if ( this.items.has( item.id ) ) return false;
		this.items.set( item.id, { id: item.id, kind: item.kind, label: item.label, data: structuredClone( item.data ?? {} ), quantity: item.quantity ?? 1 } );
		return true;

	}

	/** Takes an item away; false when the player did not carry it. */
	remove( id ) {

		return this.items.delete( id );

	}

	has( id ) {

		return this.items.has( id );

	}

	get( id ) {

		return this.items.get( id ) ?? null;

	}

	/** Every item in the order it was taken. */
	list() {

		return [ ...this.items.values() ];

	}

	ofKind( kind ) {

		return this.list().filter( ( item ) => item.kind === kind );

	}

	get size() {

		return this.items.size;

	}

	/** The items as the save's inventory holds them. */
	serialize() {

		return this.list().map( ( item ) => ( {
			id: item.id, name: item.label, quantity: item.quantity,
			state: { kind: item.kind, data: structuredClone( item.data ) }
		} ) );

	}

	/**
	 * Takes back, from a saved inventory, the items of the kinds this store
	 * holds, and returns the rest (the quest items) untouched.
	 */
	restore( saved = [] ) {

		this.items.clear();
		const rest = [];
		for ( const entry of saved ) {

			const kind = entry?.state?.kind;
			if ( ! ITEM_KINDS.includes( kind ) ) {

				rest.push( entry );
				continue;

			}
			this.add( { id: entry.id, kind, label: entry.name, data: entry.state.data ?? {}, quantity: entry.quantity ?? 1 } );

		}
		return rest;

	}

}
