// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { AutomationProbe } from './AutomationProbe.js';
import { ChatPanel } from '../../ui/widgets/ChatPanel.js';
import { CROWD_MODELS } from '../agents/CharacterCatalog.js';
import { look } from '../agents/Appearance.js';
import { HeroCharacter } from '../agents/HeroCharacter.js';
import { animation, rig } from '../agents/HeroCharacter.test-fixtures.js';
import { ActorLighting } from '../light/ActorLighting.js';

const SEED = 3207466384;

/**
 * A playing game as far as the probe reads it: one walker on ground at 0.2 m,
 * with no ground past `edge` on x; E opens a talk that shows them on a real
 * focused rig, the chat's leave button ends it, and a line gets an answer.
 */
function playing( { reachable = true, edge = Infinity } = {} ) {

	const walker = {
		id: 'p1', crowdId: 'c|edge|we319|0|630', npcId: null, type: 'street', gender: 'male',
		variant: 0, appearanceSeed: SEED, look: look( SEED ), heading: Math.PI / 2,
		position: new THREE.Vector3( 10, 0.2, 5 )
	};
	const members = new Map( [ [ walker.id, walker ] ] );
	const dialog = new ChatPanel( { onSend: () => {}, onClose: () => { game.interactor.conversation = null; } } );
	// The room lighting wears its own copy of each dressed material, as in the game.
	const hero = new HeroCharacter( {
		animation: animation(), lighting: new ActorLighting( { spots: [], strips: [] }, () => [] ),
		loadModel: () => ( { scene: rig( 'body', { eyebrows: true } ), hairs: [ { scene: rig( 'hair' ) } ] } )
	} );
	const game = {
		stats: { backend: 'webgl', tier: 'low', drawCalls: 380, frameMs: 20 },
		input: { locked: false },
		body: { feet: new THREE.Vector3(), collider: {} },
		physics: {
			rapier: { Ray: class { constructor( origin, dir ) { Object.assign( this, { origin, dir } ); } } },
			world: {
				castRay: ( { origin, dir }, length ) => dir.y === - 1 && origin.x <= edge && origin.y - 0.2 <= length ? { timeOfImpact: origin.y - 0.2 } : null
			}
		},
		controller: { yaw: 0, pitch: 0 },
		clock: { label: 'Mon 21:00', timeMin: 1260 },
		crowd: {
			members,
			within: ( feet, radius ) => [ ...members.values() ].filter( ( member ) => member.position.distanceTo( feet ) < radius )
		},
		interactor: { target: null, conversation: null },
		hero,
		view: { dialog },
		placePlayer: vi.fn( ( feet ) => {

			game.body.feet.set( feet.x, feet.y, feet.z );
			if ( reachable ) game.interactor.target = { kind: 'npc', person: walker };
			return true;

		} ),
		pressAction: vi.fn( () => {

			if ( game.interactor.target?.person !== walker ) return;
			walker.npcId = 'a301';
			game.interactor.conversation = {
				person: walker, npcId: 'a301', controlled: true, instance: { name: { given: 'Hugo', family: 'Duarte' }, type: 'retiree' }
			};
			hero.show( walker );

		} ),
		sayLine: vi.fn( async ( text ) => {

			dialog.addMessage( { from: 'player', name: 'You', text } );
			dialog.addMessage( { from: 'npc', name: 'Hugo Duarte', text: 'Mostly I watch the cranes.' } );

		} )
	};

	return { game, walker };

}

beforeEach( () => {

	vi.stubGlobal( 'requestAnimationFrame', ( callback ) => setTimeout( callback, 0 ) );

} );

describe( 'automation probe', () => {

	it( 'holds pointer capture, stands in front of the nearest walker aimed at the chest, and talks through E', async () => {

		const { game } = playing();
		const probe = new AutomationProbe( game );
		expect( game.input.locked ).toBe( true );

		const [ person ] = probe.people();
		expect( person ).toMatchObject( { id: 'p1', npcId: null, look: { seed: SEED, body: 'regular-male', hairStyle: CROWD_MODELS[ 0 ].hair } } );
		expect( person.look.hair ).toMatch( /^#[0-9a-f]{6}$/ );

		const conversation = await probe.converse();
		expect( conversation ).toEqual( { npcId: 'a301', name: 'Hugo Duarte', type: 'retiree', controlled: true, person: 'p1' } );
		const [ feet, chest ] = game.placePlayer.mock.calls[ 0 ];
		expect( feet.x ).toBeCloseTo( 11.3 );
		expect( feet.y ).toBeCloseTo( 0.25 );
		expect( feet.z ).toBeCloseTo( 5 );
		expect( chest ).toEqual( { x: 10, y: 1.5, z: 5 } );
		expect( game.pressAction ).toHaveBeenCalledWith( 'interact' );
		expect( probe.state() ).toMatchObject( { backend: 'webgl', fps: 50, crowd: 1, conversation: { npcId: 'a301' }, target: { kind: 'npc', person: 'p1' } } );

	} );

	it( 'reports the crowd look and the focused body in one shape, a tint a mesh does not wear as null, and the person after the talk', async () => {

		const { game } = playing();
		const probe = new AutomationProbe( game );
		await probe.converse( 'p1' );
		const { crowd, hero } = await probe.appearance();
		const { seed, ...worn } = crowd;
		expect( seed ).toBe( SEED );
		expect( worn ).toMatchObject( { body: 'regular-male', hairStyle: CROWD_MODELS[ 0 ].hair, eyebrows: worn.hair } );
		expect( worn.hair ).toMatch( /^#[0-9a-f]{6}$/ );
		expect( hero ).toEqual( worn );

		// Eyebrows left in the pack's own material wear no tint, whatever the uniforms hold.
		game.hero.active.root.getObjectByName( 'Eyebrows' ).material = new THREE.MeshStandardMaterial();
		expect( ( await probe.appearance() ).hero ).toMatchObject( { hair: worn.hair, eyebrows: null } );

		// The chat's own leave button ends it; the resident rig still shows the person.
		expect( await probe.leave() ).toEqual( { conversation: null } );
		expect( await probe.appearance() ).toBeNull();
		expect( ( await probe.appearance( { id: 'p1' } ) ).crowd ).toEqual( crowd );
		expect( await probe.appearance( { id: 'p9' } ) ).toBeNull();

	} );

	it( 'stands beside a person whose front has no ground, and never places the player where nobody can stand', async () => {

		const doorway = playing( { edge: 11.2 } );
		await new AutomationProbe( doorway.game ).converse( 'p1' );
		const [ feet ] = doorway.game.placePlayer.mock.calls[ 0 ];
		expect( feet.x ).toBeLessThan( 11.2 );
		expect( Math.hypot( feet.x - 10, feet.z - 5 ) ).toBeCloseTo( 1.3 );

		const nowhere = playing( { edge: 0 } );
		const probe = new AutomationProbe( nowhere.game );
		expect( await probe.approach( 'p1' ) ).toMatchObject( { placed: false, target: null } );
		expect( await probe.converse( 'p1' ) ).toBeNull();
		expect( nowhere.game.placePlayer ).not.toHaveBeenCalled();

	} );

	it( 'gives up on a person E never reaches, and times out a focused body that never shows', async () => {

		const { game } = playing( { reachable: false } );
		const probe = new AutomationProbe( game );
		expect( await probe.converse( 'p1', { attempts: 2 } ) ).toBeNull();
		expect( game.placePlayer ).toHaveBeenCalledTimes( 2 );
		expect( game.pressAction ).not.toHaveBeenCalled();
		await expect( probe.approach( 'p9' ) ).rejects.toThrow( 'no crowd member p9' );

		const shown = playing();
		const waiting = new AutomationProbe( shown.game );
		await waiting.converse();
		shown.game.hero.active.root.visible = false;
		expect( ( await waiting.appearance( { timeoutMs: 0 } ) ).hero ).toBeNull();

	} );

	it( 'says a line through the game and returns what the chat shows', async () => {

		const { game } = playing();
		const probe = new AutomationProbe( game );
		await probe.converse();
		const said = await probe.say( 'What do you do around here?' );
		expect( game.sayLine ).toHaveBeenCalledWith( 'What do you do around here?' );
		expect( said ).toMatchObject( {
			reply: 'Mostly I watch the cranes.', status: '', error: false,
			added: [ { from: 'player', name: 'You', text: 'What do you do around here?' }, { from: 'npc', name: 'Hugo Duarte', text: 'Mostly I watch the cranes.' } ]
		} );

		game.sayLine.mockImplementationOnce( async () => game.view.dialog.setStatus( 'The reply could not be reached.', { error: true, retry: true } ) );
		expect( await probe.say( 'Hello?' ) ).toMatchObject( { reply: null, added: [], error: true, status: 'The reply could not be reached.' } );

	} );

	it( 'waits for the game\'s voice to start a line, fail one or find Voice away, and shows which chat line is voiced', async () => {

		const { game } = playing();
		const report = { enabled: true, status: 'unknown', queued: 1, requested: 0, started: 0, played: 0, bytes: 0, cached: 0, failed: 0, error: null };
		game.voice = { report: () => ( { ...report } ) };
		const probe = new AutomationProbe( game );
		setTimeout( () => Object.assign( report, { status: 'ok', requested: 1, started: 1, bytes: 48044 } ), 5 );
		expect( await probe.voice( { started: 1 } ) ).toMatchObject( { status: 'ok', started: 1, played: 0, bytes: 48044 } );
		setTimeout( () => Object.assign( report, { played: 1 } ), 5 );
		expect( await probe.voice( { played: 1 } ) ).toMatchObject( { started: 1, played: 1 } );
		setTimeout( () => Object.assign( report, { failed: 1, error: 'voice 502' } ), 5 );
		expect( await probe.voice( { started: 2 } ) ).toMatchObject( { started: 1, failed: 1 } );
		report.status = 'unreachable';
		expect( await probe.voice( { started: 3 } ) ).toMatchObject( { status: 'unreachable' } );
		expect( await probe.voice( { started: 3, timeoutMs: 0 } ) ).toMatchObject( { started: 1 } );
		expect( await new AutomationProbe( playing().game ).voice() ).toBeNull();

		await probe.converse();
		await probe.say( 'Hello?' );
		game.view.dialog.setSpeaking( game.view.dialog.transcript.lastElementChild, 'playing' );
		expect( probe.state().chat.lines.map( ( line ) => line.speaking ) ).toEqual( [ null, 'playing' ] );

	} );

	it( 'reports follow and lead as not driven yet', () => {

		const probe = new AutomationProbe( playing().game );
		expect( probe.follow() ).toEqual( { supported: false, reason: 'follow is not driven yet' } );
		expect( probe.lead() ).toEqual( { supported: false, reason: 'lead is not driven yet' } );

	} );

} );
