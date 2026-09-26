/**
 * Whether the player plays, has paused, or has the pointer free while the
 * world plays on. Holding the pointer is playing. The pointer lost on the
 * street is the player pausing, unless the game let it go for a chat or a
 * panel of its own: then the world plays on until the player clicks back in,
 * or presses Escape to pause.
 */
export class PauseState {

	/** The pause menu is up; true until the player first takes the pointer. */
	paused = true;
	/** The game let the pointer go itself, and taking it back failed or has not happened yet. */
	released = false;

	/**
	 * The game lets the pointer go for a chat or a panel of its own. Only
	 * while the player holds it: what is opened from the pause menu goes
	 * back to the pause menu.
	 */
	release( locked ) {

		if ( locked ) this.released = true;

	}

	/** The browser reports the pointer lost: with nothing of the game's own open, the player paused. */
	lost( open ) {

		if ( ! open && ! this.released ) this.paused = true;

	}

	/** The browser reports the pointer taken: the player plays, and the next loss is theirs again. */
	held() {

		this.paused = this.released = false;

	}

	/** Once a frame: holding the pointer plays; Escape with the pointer free pauses. */
	update( { locked, escape = false } ) {

		if ( locked ) this.paused = false;
		else if ( escape ) {

			this.paused = true;
			this.released = false;

		}

	}

	/** Whether the world holds still: paused, or a full panel is open. */
	holds( panel ) {

		return this.paused || Boolean( panel );

	}

	/** Whether the world plays on with the pointer free, and a line should say how to take it back. */
	free( { locked, open } ) {

		return ! locked && ! open && ! this.paused;

	}

}
