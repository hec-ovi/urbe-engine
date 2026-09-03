import { describe, expect, it } from 'vitest';
import {
	pickSpawn, playableInteractionOwner, playableTransitPrompt, prepareInteriorStreaming, savedSpawn, transitStartHour
} from './GameApp.js';

describe( 'game spawn', () => {

	it( 'uses the authoritative height of the selected walk node', () => {

		const networks = { walk: { nodes: [
			{ id: 'near', x: 0, y: 8, z: 0, kind: 'corner' },
			{ id: 'far', x: 100, y: 8, z: 0, kind: 'corner' }
		] } };
		const atlas = { parcels: [ { access: { point: [ 0, 0 ] } } ] };
		const spawn = pickSpawn( networks, atlas );

		expect( spawn.point.y ).toBeCloseTo( 8.17 );
		expect( spawn.lookAt.y ).toBeCloseTo( 8.12 );

	} );

	it( 'restores the saved foot point and heading without deriving a new spawn', () => {

		const spawn = savedSpawn( { player: { position: { x: 14.5, y: 2.25, z: -8 }, heading: - 1.2 } } );
		expect( spawn.point.toArray() ).toEqual( [ 14.5, 2.25, - 8 ] );
		expect( spawn.heading ).toBe( - 1.2 );

	} );

} );

describe( 'streamed floor preparation', () => {

	it( 'attaches a floor-only warmup without compiling the complete city', () => {

		const stream = { warmup: null };
		const renderer = {};
		const scene = {};
		const camera = {};
		const mrt = { emissive: true };
		const warmup = prepareInteriorStreaming( stream, renderer, scene, camera, mrt );

		expect( stream.warmup ).toBe( warmup );
		expect( warmup.renderer ).toBe( renderer );
		expect( warmup.scene ).toBe( scene );
		expect( warmup.camera ).toBe( camera );
		expect( warmup.mrt ).toBe( mrt );

	} );

} );

describe( 'playable transit integration', () => {

	it( 'restores the exact active timetable clock including a day rollover', () => {

		const journey = {
			valid: true,
			state: { status: 'aboard', clock: { dayOffset: 86400, lastDaySeconds: 125 } }
		};

		expect( transitStartHour( journey, 21 ) ).toBe( 86525 / 3600 );
		expect( transitStartHour( { ...journey, valid: false }, 21 ) ).toBe( 21 );
		expect( transitStartHour( {
			valid: true, state: { status: 'waiting', clock: { dayOffset: 0, lastDaySeconds: 125 } }
		}, 21 ) ).toBe( 21 );

	} );

	it( 'gives aimed world targets priority while waiting and the ride priority while aboard', () => {

		expect( playableTransitPrompt( 'E  open door', {
			aboard: false, prompt: 'E  board Bus B1'
		} ) ).toBe( 'E  open door' );
		expect( playableTransitPrompt( null, {
			aboard: false, prompt: 'E  board Bus B1'
		} ) ).toBe( 'E  board Bus B1' );
		expect( playableTransitPrompt( 'E  talk', {
			aboard: true, prompt: 'E  leave bus B1 at stop-b'
		} ) ).toBe( 'E  leave bus B1 at stop-b' );
		expect( playableInteractionOwner( { conversation: {}, target: {} }, { aboard: true } ) ).toBe( 'conversation' );
		expect( playableInteractionOwner( { conversation: null, target: {} }, { aboard: false } ) ).toBe( 'world' );
		expect( playableInteractionOwner( { conversation: null, target: {} }, { aboard: true } ) ).toBe( 'transit' );
		expect( playableInteractionOwner( { conversation: null, target: null }, { aboard: false } ) ).toBe( 'transit' );

	} );

} );
