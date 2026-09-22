const DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];

/** Next authored opening in absolute world minutes; never rewinds the clock. */
export function nextQuestWindow( window, timeMin ) {

	if ( ! window?.days?.length || ! Number.isFinite( timeMin ) ) return null;
	const { startMin, endMin } = window;
	if ( ! Number.isFinite( startMin ) || ! Number.isFinite( endMin ) ) return null;
	const day = Math.floor( timeMin / 1440 );
	for ( let offset = -1; offset <= 7; offset ++ ) {

		const date = day + offset, weekday = ( date % 7 + 7 ) % 7;
		if ( ! window.days.includes( weekday ) ) continue;
		const start = date * 1440 + startMin;
		const end = date * 1440 + endMin + ( endMin <= startMin ? 1440 : 0 );
		if ( timeMin >= start && timeMin < end ) return null;
		if ( start <= timeMin ) continue;
		const hours = Math.floor( startMin / 60 ), minutes = startMin % 60;
		return { timeMin: start, label: DAYS[ weekday ] + ' ' + String( hours ).padStart( 2, '0' ) + ':' + String( minutes ).padStart( 2, '0' ),
			minutes: Math.ceil( start - timeMin ) };

	}
	return null;

}
