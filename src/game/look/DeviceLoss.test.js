import { afterEach, expect, it, vi } from 'vitest';
import { recoverDeviceLoss } from './DeviceLoss.js';

afterEach( () => vi.restoreAllMocks() );

function renderer() {

	const target = { setAnimationLoop: vi.fn(), reported: [] };
	target.onDeviceLost = function ( info ) { this.reported.push( info ); };
	return target;

}

it( 'reports through the renderer, stops drawing, tells the player, saves and reloads once on a lost device', async () => {

	const order = [];
	const target = renderer();
	recoverDeviceLoss( target, {
		notify: () => order.push( 'notify' ),
		save: async () => order.push( 'save' ),
		reload: () => order.push( 'reload' )
	} );
	await target.onDeviceLost( { api: 'WebGL', message: 'context lost' } );
	await target.onDeviceLost( { api: 'WebGL', message: 'again' } );
	expect( target.setAnimationLoop ).toHaveBeenCalledOnce();
	expect( target.setAnimationLoop ).toHaveBeenCalledWith( null );
	expect( order ).toEqual( [ 'notify', 'save', 'reload' ] );
	expect( target.reported ).toEqual( [ { api: 'WebGL', message: 'context lost' } ] );

} );

it( 'reloads when the save fails or there is nothing to save', async () => {

	const errors = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	const failing = renderer(), reload = vi.fn();
	recoverDeviceLoss( failing, { save: async () => { throw new Error( 'offline' ); }, reload } );
	await failing.onDeviceLost();
	expect( reload ).toHaveBeenCalledOnce();
	expect( errors.mock.calls.some( ( [ message ] ) => message === 'could not save after the GPU reset' ) ).toBe( true );

	const preview = renderer(), again = vi.fn();
	recoverDeviceLoss( preview, { reload: again } );
	await preview.onDeviceLost( { api: 'WebGPU', message: '' } );
	expect( again ).toHaveBeenCalledOnce();

} );
