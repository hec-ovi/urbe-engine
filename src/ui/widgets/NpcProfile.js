const DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];

/**
 * Turns the simulation's instantiated NPC into what the chat header and
 * profile block show: { name, role, facts: [[key, value]], now, routine: [line] }.
 */
export function npcProfile( { instance, behavior } ) {

	if ( ! instance ) return { name: 'Someone passing by', role: '', facts: [], now: null, routine: [] };

	const facts = [
		[ 'home', `${instance.home.parcelId} · unit ${instance.home.unit}` ]
	];

	if ( instance.job ) {

		facts.push(
			[ 'works at', instance.job.parcelId ],
			[ 'role', words( instance.job.role ) ],
			[ 'shift', `${clock( instance.job.shift.startMin )}-${clock( instance.job.shift.endMin )} ${instance.job.shift.kind}` ]
		);

	}

	if ( instance.family?.length ) {

		facts.push( [ 'family', instance.family.map( ( m ) => `${m.name.given} (${m.relation})` ).join( ', ' ) ] );

	}

	return {
		name: `${instance.name.given} ${instance.name.family}`,
		role: words( instance.type ),
		facts,
		now: behavior
			? `${words( behavior.activity )} · ${behavior.mode} · ${place( behavior.place )}${behavior.interrupted ? '  (paused for you)' : ''}`
			: null,
		routine: ( instance.routine ?? [] ).map( ( entry ) =>
			`${days( entry.days )} ${clock( entry.startMin )}-${clock( entry.endMin )}  ${words( entry.activity )} @ ${place( entry.place )}`
		)
	};

}

function words( text ) {

	return String( text ).replace( /_/g, ' ' );

}

function clock( minutes ) {

	const m = ( ( minutes % 1440 ) + 1440 ) % 1440;

	return `${String( Math.floor( m / 60 ) ).padStart( 2, '0' )}:${String( m % 60 ).padStart( 2, '0' )}`;

}

function days( list ) {

	if ( ! list?.length || list.length === 7 ) return 'daily';

	return list.map( ( d ) => DAYS[ d ] ).join( '' );

}

function place( ref ) {

	return ref ? `${ref.kind} ${ref.id}` : 'nowhere';

}
