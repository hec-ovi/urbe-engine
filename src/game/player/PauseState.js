/**
 * Whether the player plays, has paused, or has the pointer free while the
 * world plays on. Holding the pointer is playing. The pointer lost on the
 * street is the player pausing (the game opens the settings for it), unless
 * the game let it go for a chat or a panel of its own: then the world plays
 * on until the player clicks back in, or asks for the settings.
 */
export class PauseState {

	/** The world holds for the player; true until the player first takes the pointer. */
	paused = true;
	/** The game let the pointer go itself, and taking it back failed or has not happened yet. */
	released = false;

	/** The game lets the pointer go for a chat or a panel of its own, while the player holds it. */
	release( locked ) {

		if ( locked ) this.released = true;

	}

	/**
	 * The browser reports the pointer lost: with nothing of the game's own
	 * open, the player paused, and true is returned (the host opens the
	 * settings, as Escape on the street does).
	 */
	lost( open ) {

		if ( open || this.released ) return false;
		this.paused = true;
		return true;

	}

	/** The browser reports the pointer taken: the player plays, and the next loss is theirs again. */
	held() {

		this.paused = this.released = false;

	}

	/** Once a frame: holding the pointer plays. */
	update( locked ) {

		if ( locked ) this.paused = false;

	}

	/**
	 * The player asks for the settings (Escape on the street). Holding the
	 * pointer, it must be let go, and true is returned: its loss pauses and
	 * opens them. With the pointer already free, the world holds now and the
	 * host opens them.
	 */
	ask( locked ) {

		if ( locked ) return true;
		this.paused = true;
		this.released = false;
		return false;

	}

	/** Whether the world holds still: paused, or a full panel is open. */
	holds( panel ) {

		return this.paused || Boolean( panel );

	}

	/** Whether the pointer is free on the street with nothing open, and a line should say how to take it back. */
	free( { locked, open } ) {

		return ! locked && ! open;

	}

}
