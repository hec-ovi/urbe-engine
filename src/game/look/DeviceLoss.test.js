import { afterEach, expect, it, vi } from 'vitest';
import { RELOAD_CALM_MS, recoverDeviceLoss } from './DeviceLoss.js';

afterEach( () => vi.restoreAllMocks() );

function renderer() {

	const target = { setAnimationLoop: vi.fn(), reported: [] };
	target.onDeviceLost = function ( info ) { this.reported.push( info ); };
	return target;

}

/** A tab's sessionStorage: it outlives the reload, as the browser's does. */
function tab() {

	const items = new Map();
	return { getItem: ( key ) => items.get( key ) ?? null, setItem: ( key, value ) => items.set( key, String( value ) ) };

}

it( 'reports through the renderer, stops drawing, tells the player, saves and reloads once on a lost device', async () => {

	const order = [];
	const target = renderer();
	recoverDeviceLoss( target, {
		notify: ( { title } ) => order.push( `notify ${title}` ),
		save: async () => order.push( 'save' ),
		reload: () => order.push( 'reload' ),
		storage: tab(),
		nextInput: () => order.push( 'input' )
	} );
	await target.onDeviceLost( { api: 'WebGL', message: 'context lost' } );
	await target.onDeviceLost( { api: 'WebGL', message: 'again' } );
	expect( target.setAnimationLoop ).toHaveBeenCalledOnce();
	expect( target.setAnimationLoop ).toHaveBeenCalledWith( null );
	expect( order ).toEqual( [ 'notify Graphics reset', 'save', 'reload' ] );
	expect( target.reported ).toEqual( [ { api: 'WebGL', message: 'context lost' } ] );

} );

it( 'reloads when the save fails or there is nothing to save', async () => {

	const errors = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	const failing = renderer(), reload = vi.fn();
	recoverDeviceLoss( failing, { save: async () => { throw new Error( 'offline' ); }, reload, storage: tab() } );
	await failing.onDeviceLost();
	expect( reload ).toHaveBeenCalledOnce();
	expect( errors.mock.calls.some( ( [ message ] ) => message === 'could not save after the GPU reset' ) ).toBe( true );

	const preview = renderer(), again = vi.fn();
	recoverDeviceLoss( preview, { reload: again, storage: tab() } );
	await preview.onDeviceLost( { api: 'WebGPU', message: '' } );
	expect( again ).toHaveBeenCalledOnce();

} );

it( 'saves but waits for the player before reloading a reset that comes back soon after an automatic reload', async () => {

	const storage = tab(), reload = vi.fn(), save = vi.fn(), notify = vi.fn();
	let clock = 1_000_000, press;
	const now = () => clock;
	const nextInput = () => new Promise( ( resolve ) => { press = resolve; } );

	// The first reset reloads by itself; each page that comes back is a new one, with the tab's memory.
	const first = renderer();
	recoverDeviceLoss( first, { save, notify, reload, storage, now, nextInput } );
	await first.onDeviceLost();
	expect( reload ).toHaveBeenCalledOnce();

	clock += RELOAD_CALM_MS - 1;
	const second = renderer();
	recoverDeviceLoss( second, { save, notify, reload, storage, now, nextInput } );
	const settled = second.onDeviceLost();
	await vi.waitFor( () => expect( press ).toBeTypeOf( 'function' ) );
	expect( save ).toHaveBeenCalledTimes( 2 );
	expect( notify.mock.lastCall[ 0 ].text ).toMatch( /press any key/ );
	expect( reload ).toHaveBeenCalledOnce();
	press();
	await settled;
	expect( reload ).toHaveBeenCalledTimes( 2 );

	// Calm long enough after that, a reset reloads by itself again.
	clock += RELOAD_CALM_MS;
	const later = renderer();
	recoverDeviceLoss( later, { save, notify, reload, storage, now, nextInput: () => { throw new Error( 'asked the player' ); } } );
	await later.onDeviceLost();
	expect( reload ).toHaveBeenCalledTimes( 3 );

} );

it( 'reloads by itself when the tab keeps no memory or refuses it', async () => {

	const locked = { getItem: () => { throw new Error( 'SecurityError' ); }, setItem: () => { throw new Error( 'SecurityError' ); } };
	for ( const storage of [ null, locked ] ) {

		const target = renderer(), reload = vi.fn();
		recoverDeviceLoss( target, { reload, storage, nextInput: () => { throw new Error( 'asked the player' ); } } );
		await target.onDeviceLost();
		expect( reload ).toHaveBeenCalledOnce();

	}

} );
