import { signalStateAt } from '../../../../connections/src/index.ts';

/**
 * Traffic and pedestrian signals, read through the connections library's own
 * closed-form utility (../connections/CONTRACT.md) rather than re-derived
 * here: state at time t is the phase containing (t + offset) mod cycle, one
 * character per controlled link, G go / y clearing / r stop.
 */
export class Signals {

	constructor( networks ) {

		this.byId = new Map( networks.signals.map( ( signal ) => [ signal.id, signal ] ) );

	}

	/** @param ref { signalId, linkIndex } from a crossing or a lane turn. */
	state( ref, daySeconds ) {

		const signal = this.byId.get( ref?.signalId );

		if ( ! signal ) return 'G';

		return signalStateAt( signal, daySeconds )[ ref.linkIndex ] ?? 'G';

	}

	green( ref, daySeconds ) {

		return this.state( ref, daySeconds ) === 'G';

	}

}
