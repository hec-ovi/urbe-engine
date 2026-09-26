// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp, playablePress } from './GameApp.js';
import { Input } from './player/Input.js';
import { PlayerController } from './player/PlayerController.js';
import { replyEvents, talkStream } from './talk/talk.test-fixtures.js';

describe( 'driving the player through its own paths', () => {

	it( 'takes E and R pressed under capture or queued by pressAction, and consumes the keys either way', () => {

		const input = new Input( document.createElement( 'canvas' ) );
		const app = Object.create( GameApp.prototype );
		app.pressedActions = new Set();
		const frame = () => [ [ 'interact', 'KeyE' ], [ 'secondary-interact', 'KeyR' ] ]
			.filter( ( [ action, code ] ) => playablePress( input, app.pressedActions, action, code ) )
			.map( ( [ action ] ) => action );

		input.pressed.add( 'KeyE' );
		expect( frame() ).toEqual( [] );
		expect( input.pressed.size ).toBe( 0 );

		input.locked = true;
		input.pressed.add( 'KeyE' );
		expect( frame() ).toEqual( [ 'interact' ] );

		input.locked = false;
		input.pressed.add( 'KeyE' );
		app.pressAction( 'secondary-interact' );
		expect( () => app.pressAction( 'jump' ) ).toThrow( 'unknown action: jump' );
		expect( frame() ).toEqual( [ 'secondary-interact' ] );
		expect( input.pressed.size ).toBe( 0 );
		expect( frame() ).toEqual( [] );
		input.dispose();

	} );

	it( 'stands the feet on a point with the crosshair on a target, and refuses while a ride carries the body', () => {

		const centre = new THREE.Vector3();
		const body = {
			position: centre, crouched: false, grounded: true, carried: false,
			get feet() { return new THREE.Vector3( centre.x, centre.y - 0.9, centre.z ); },
			get eye() { return new THREE.Vector3( centre.x, centre.y + 0.8, centre.z ); },
			teleport( point ) { if ( this.carried ) return false; centre.set( point.x, point.y + 0.9, point.z ); return true; },
			move() {}, setCrouched() {}
		};
		const input = new Input( document.createElement( 'canvas' ) );
		const app = Object.create( GameApp.prototype );
		app.body = body;
		app.controller = new PlayerController( { body, camera: new THREE.PerspectiveCamera(), input } );
		app.indoors = true;

		const target = new THREE.Vector3( 10, 1.5, 5 );
		expect( app.placePlayer( { x: 11.3, y: 0.2, z: 5 }, target ) ).toBe( true );
		expect( body.feet.distanceTo( new THREE.Vector3( 11.3, 0.2, 5 ) ) ).toBeCloseTo( 0, 9 );
		const toTarget = target.clone().sub( app.controller.eye ).normalize();
		expect( app.controller.look.dot( toTarget ) ).toBeCloseTo( 1, 6 );
		expect( app.indoors ).toBeUndefined();

		body.carried = true;
		expect( app.placePlayer( { x: 0, y: 0, z: 0 } ) ).toBe( false );
		expect( body.feet.x ).toBeCloseTo( 11.3 );
		input.dispose();

	} );

	it( 'says a typed line as the chat box does and settles once the reply shows', async () => {

		stubCanvas();
		const app = new GameApp( {} );
		app.clock = { timeMin: 1260 };
		app.quests = { snapshot: () => [] };
		app.animations = { playerDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn() };
		app.talk = { stream: vi.fn( () => talkStream( replyEvents( 'Mostly I watch ', 'the cranes.' ) ) ) };
		app.interactor = { conversation: { npcId: 'a301', instance: { name: { given: 'Hugo', family: 'Duarte' } }, behavior: null } };

		await app.sayLine( 'What do you do around here?' );
		expect( app.talk.stream ).toHaveBeenCalledWith( app.interactor.conversation, 'What do you do around here?', 1260, [], expect.any( Object ) );
		expect( [ ...app.view.dialog.transcript.children ].map( ( line ) => line.textContent ) ).toEqual( [
			'YouWhat do you do around here?', 'Hugo DuarteMostly I watch the cranes.'
		] );
		document.body.replaceChildren();

	} );

} );
