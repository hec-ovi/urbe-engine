/** How long the game waits for either server to say what it can take. */
const PROBE_MS = 5000;

/**
 * Whether the servers this page talks to can take the economy yet, asked
 * once at load: `saves` when the launcher says a save may carry the
 * `economy` field, `talk` when the talk route's loaded Quests build has the
 * transfer tools. Anything but a clear yes (an older server's 404 or 400,
 * the page fallback, broken JSON, no answer) is no, so a client never sends
 * a server a field it cannot take.
 */
export async function probe( fetcher = globalThis.fetch ) {

	if ( typeof fetcher !== 'function' ) return { saves: false, talk: false };
	const [ saves, talk ] = await Promise.all( [
		ask( fetcher, '/api/launcher', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { method: 'abilities' } )
		}, ( body ) => Array.isArray( body?.saveFields ) && body.saveFields.includes( 'economy' ) ),
		ask( fetcher, '/api/talk/abilities', { method: 'GET' }, ( body ) => Array.isArray( body?.abilities ) && body.abilities.includes( 'economy' ) )
	] );
	return { saves, talk };

}

async function ask( fetcher, url, options, yes ) {

	try {

		const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout( PROBE_MS ) : undefined;
		const response = await Reflect.apply( fetcher, globalThis, [ url, { ...options, ...( signal ? { signal } : {} ) } ] );
		if ( ! response?.ok ) return false;
		const body = await response.json();
		return yes( body ) === true;

	} catch {

		return false;

	}

}
