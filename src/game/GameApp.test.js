import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GameApp } from './GameApp.js';

describe( 'GameApp quest NPC control', () => {

	it( 'exposes only an explicit selected-cast control event with live clock and player position', () => {

		const app = Object.create( GameApp.prototype );
		app.clock = { timeMin: 725 };
		app.body = { feet: new THREE.Vector3( 4, 5, 6 ) };
		app.questGameplay = { control: vi.fn( ( request ) => ( { ok: true, ...request } ) ) };

		expect( app.questNpcControl( { kind: 'start-follow', npcId: 'cast-a' } ) ).toMatchObject( {
			ok: true, kind: 'start-follow', npcId: 'cast-a', timeMin: 725, playerPosition: { x: 4, y: 5, z: 6 }
		} );

	} );

} );
