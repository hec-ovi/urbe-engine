/** Finite subtitle reveal. The transcript and accessible text always retain the complete line. */
export class SubtitleReveal {

	constructor( { node, owner, charactersPerSecond, onState = () => {} } ) {
		Object.assign( this, { node, owner, charactersPerSecond, onState } );
		this.text = '';
		this.frame = null;
	}

	set( text, { animate = false } = {} ) {
		this.cancel();
		this.text = text;
		this.characters = Array.from( text );
		this.shown = 0;
		this.progress = null;
		if ( ! animate || ! text || window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {
			this.node.data = text;
			return;
		}
		this.node.data = '';
		this.started = performance.now();
		this.drawn = - Infinity;
		this.active = true;
		this.onState( true );
		this.frame = requestAnimationFrame( now => this.#tick( now ) );
	}

	/** Optional voice progress (0..1), sampled only while this subtitle is revealing. */
	sync( progress ) {
		if ( this.active && typeof progress === 'function' ) this.progress = progress;
	}

	finish() {
		this.cancel();
		this.node.data = this.text;
	}

	cancel() {
		if ( this.frame !== null ) cancelAnimationFrame( this.frame );
		this.frame = null;
		this.active = false;
		this.progress = null;
		this.onState( false );
	}

	#tick( now ) {
		this.frame = null;
		if ( ! this.owner.isConnected || this.owner.closest( '[hidden]' ) ) { this.finish(); return; }
		if ( now - this.drawn >= 1000 / 30 ) {
			this.drawn = now;
			const spoken = this.progress?.();
			const count = Number.isFinite( spoken ) ? Math.floor( Math.max( 0, Math.min( 1, spoken ) ) * this.characters.length )
				: Math.floor( ( now - this.started ) * this.charactersPerSecond / 1000 );
			const shown = Math.max( this.shown, Math.min( this.characters.length, count ) );
			if ( shown !== this.shown ) {
				this.shown = shown;
				this.node.data = this.characters.slice( 0, shown ).join( '' );
			}
			if ( this.shown === this.characters.length ) { this.finish(); return; }
		}
		this.frame = requestAnimationFrame( time => this.#tick( time ) );
	}
}
