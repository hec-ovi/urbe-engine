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
import { SceneryCompiler } from '../scenery/SceneryCompiler.js';
import { assets, courier, crimeScene, frame } from '../scenery/scenery.test-fixtures.js';

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
			within: ( feet, radius ) => [ ...members.values() ].filter( ( member ) => member.position.distanceTo( feet ) < radius ),
			memberForNpc: ( npcId ) => [ ...members.values() ].find( ( member ) => member.npcId === npcId ) ?? null
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

	it( 'clicks a chat action by its label and reports what the person offers, the companion under way and the person as continuity holds them', async () => {

		const { game } = playing();
		const probe = new AutomationProbe( game );
		await probe.converse();
		const bar = { place: { kind: 'parcel', id: 'p9' }, name: 'the bar', relation: 'haunt' };
		game.playerPlaces = [ { kind: 'parcel', id: 'p1' } ];
		game.companion = {
			active: null,
			places: { positions: new Map( [ [ 'parcel:p9', [ 40, 0.2, 5 ] ] ] ) },
			offers: vi.fn( () => [
				{ offerId: 'follow', kind: 'follow', label: 'Come with me', available: true },
				{ offerId: 'lead:parcel:p9', kind: 'lead', label: 'Show me the bar', available: false, reason: 'no_time', destination: bar }
			] )
		};
		game.npcContinuity = { companion: null, actor: ( npcId ) => npcId === 'a301' ? { position: [ 10, 0.2, 5 ], mode: 'conversation', visible: true } : null };
		expect( probe.offers() ).toEqual( [
			{ offerId: 'follow', kind: 'follow', label: 'Come with me', available: true, reason: null, destination: null, distance: null },
			{ offerId: 'lead:parcel:p9', kind: 'lead', label: 'Show me the bar', available: false, reason: 'no_time', destination: { name: 'the bar', relation: 'haunt' }, distance: 30 }
		] );
		expect( game.companion.offers ).toHaveBeenCalledWith( { npcId: 'a301', timeMin: 1260, playerPlaces: game.playerPlaces } );

		const chosen = [];
		game.view.dialog.onAction = ( id ) => chosen.push( id );
		game.view.dialog.setActions( [ { id: 'follow', label: 'Come with me' } ] );
		expect( probe.state().chat.actions ).toEqual( [ { id: 'follow', label: 'Come with me' } ] );
		expect( await probe.act( 'follow' ) ).toMatchObject( { clicked: true, conversation: { npcId: 'a301' } } );
		expect( ( await probe.act( 'lead:parcel:p9' ) ).clicked ).toBe( false );
		expect( chosen ).toEqual( [ 'follow' ] );

		expect( probe.companion() ).toBeNull();
		game.companion.active = { npcId: 'a301', kind: 'lead', phase: 'walking', destination: bar };
		game.npcContinuity.companion = { npcId: 'a301', mode: 'leading', phase: 'waiting', position: [ 13, 0.2, 9 ] };
		game.body.feet.set( 10, 0.2, 5 );
		expect( probe.companion() ).toEqual( {
			npcId: 'a301', kind: 'lead', phase: 'walking', mode: 'leading', walk: 'waiting', distance: 5, position: [ 13, 0.2, 9 ],
			destination: { name: 'the bar', relation: 'haunt', distance: 27.3 }
		} );
		expect( probe.person( 'a301' ) ).toEqual( { npcId: 'a301', id: 'p1', mode: 'conversation', visible: true, position: [ 10, 0.2, 5 ], distance: 0 } );
		expect( probe.person( 'a999' ) ).toBeNull();

	} );

	it( 'stands the player on the pavement a set distance from a person, and walks them behind a leader on its own path until the talk opens', async () => {

		const { game } = playing();
		const probe = new AutomationProbe( game );
		const leader = { x: 10 };
		game.npcContinuity = {
			// A crossing 16 m away, and a sidewalk running away from the person from 10 m out.
			routes: {
				edges: new Map( [
					[ 'road', { id: 'road', kind: 'crossing', length: 4, from: [ 26, 0, 3 ], to: [ 26, 0, 7 ] } ],
					[ 'kerb', { id: 'kerb', kind: 'sidewalk', length: 30, from: [ 10, 0, 15 ], to: [ 10, 0, 45 ] } ]
				] ),
				pointAt: ( edge, along ) => ( { x: edge.from[ 0 ], y: 0, z: edge.from[ 2 ] + ( edge.to[ 2 ] - edge.from[ 2 ] ) * along / edge.length } )
			},
			actor: () => ( { position: [ leader.x, 0.2, 5 ] } ),
			get companion() { return { npcId: 'a301', mode: 'leading', phase: 'walking', position: [ leader.x, 0.2, 5 ] }; }
		};
		game.companion = { active: { npcId: 'a301', kind: 'lead', phase: 'walking' }, places: { positions: new Map() } };
		// The sidewalk runs down the seam of two ground cuboids at x = 10: a ray right on it meets neither.
		const cast = game.physics.world.castRay;
		game.physics.world.castRay = ( ray, ...rest ) => ray.origin.x === 10 ? null : cast( ray, ...rest );

		expect( await probe.standAway( 'a301', { min: 12, max: 20 } ) ).toEqual( { placed: true, distance: 16 } );
		const [ stood, aimed ] = game.placePlayer.mock.lastCall;
		expect( stood ).toEqual( { x: 10, y: expect.closeTo( 0.25 ), z: 21 } );
		expect( aimed ).toEqual( { x: 10, y: 1.5, z: 5 } );
		expect( await probe.standAway( 'a301', { min: 50, max: 60 } ) ).toEqual( { placed: false, distance: null } );

		// Each frame the leader walks half a metre on; at x = 20 it has arrived and its talk opens.
		game.body.feet.set( 8.5, 0.25, 5 );
		game.placePlayer.mockClear();
		const placed = [];
		game.placePlayer.mockImplementation( ( feet, target ) => {

			placed.push( { feet: feet.x - leader.x, target: target.x - leader.x } );
			game.body.feet.set( feet.x, feet.y, feet.z );
			return true;

		} );
		vi.stubGlobal( 'requestAnimationFrame', ( callback ) => setTimeout( () => {

			leader.x = Math.min( 20, leader.x + 0.5 );
			if ( leader.x === 20 ) game.interactor.conversation = { person: null, npcId: 'a301', controlled: true, instance: { name: { given: 'Hugo', family: 'Duarte' } } };
			callback();

		}, 0 ) );
		const trailed = await probe.trail( 'a301' );
		expect( trailed.conversation ).toMatchObject( { npcId: 'a301', name: 'Hugo Duarte' } );
		expect( trailed.samples[ 0 ] ).toMatchObject( { ms: expect.any( Number ), npcId: 'a301', kind: 'lead', mode: 'leading' } );
		expect( placed.length ).toBeGreaterThan( 2 );
		// On the leader's path, 2.5 m behind it, or where it started while its path is shorter.
		for ( const move of placed ) expect( move ).toEqual( { feet: expect.toSatisfy( ( back ) => back >= - 2.5 && back <= - 2 ), target: 0 } );
		expect( placed.at( - 1 ).feet ).toBe( - 2.5 );
		expect( game.body.feet.z ).toBe( 5 );
		expect( 20 - game.body.feet.x ).toBeLessThanOrEqual( 4 );

	} );

	it( 'lists the quest scenes, and stands the player at the edge of a staged one inside once its floor is solid, aimed at its first element', async () => {

		const { game } = playing();
		const staging = new SceneryCompiler( { missionAssets: assets } ).compile( crimeScene(), frame, courier );
		const drawn = new Set();
		let asked = 0;
		game.scenery = {
			serialize: () => [ 'courier-found', 'wake', 'old-scene' ].map( ( sceneId ) => ( { sceneId } ) ),
			sceneFor: ( sceneId ) => ( {
				'courier-found': { spec: crimeScene(), status: 'staged', failed: null, resolved: { place: staging.assembly.place, actors: courier }, request: staging.request, assembly: staging.assembly },
				wake: { spec: crimeScene( { sceneId: 'wake', purpose: 'wake' } ), status: 'dormant', failed: 'E_SCENERY_NO_FIT', resolved: null, request: null, assembly: null }
			} )[ sceneId ] ?? null,
			renderer: {
				// The scene stands a few frames after the player comes near.
				isRealized: ( sceneId ) => sceneId === 'courier-found' && drawn.size > 0 && ++ asked > 3,
				visuals: () => ( { focus: ( entityId ) => drawn.has( entityId ) ? { position: new THREE.Vector3(), visible: true } : null } )
			}
		};
		game.companion = { places: { positions: new Map( [ [ 'parcel:p47', [ 10, 0.2, 12 ] ] ] ) } };
		// The flat's floor, 2.4 m up over the frame, is solid once the player has stood at the door.
		let solid = false;
		game.physics.world.castRay = ( { origin, dir }, length ) => {

			const floor = solid && Math.abs( origin.x - 10 ) <= 4 && Math.abs( origin.z - 20 ) <= 3.5 ? 2.4 : 0.2;
			const drop = origin.y - floor;
			return dir.y === - 1 && drop >= 0 && drop <= length ? { timeOfImpact: drop } : null;

		};
		game.placePlayer.mockImplementation( ( feet ) => {

			game.body.feet.set( feet.x, feet.y, feet.z );
			solid = true;
			for ( const entityId of [ 'courier', 'pool' ] ) drawn.add( entityId );
			return true;

		} );
		const probe = new AutomationProbe( game );

		expect( probe.scenes() ).toEqual( [
			{
				sceneId: 'courier-found', questId: 'quest-missing-courier', purpose: 'crime-scene', status: 'staged', failed: null,
				place: { parcelId: 'p47', floor: 0, roomId: 'f0-r1' }, frame: { kind: 'interior', origin: [ 10, 2.4, 20 ], width: 8, depth: 7 },
				elements: [ 'courier', 'drive', 'pool' ], standing: false
			},
			{ sceneId: 'wake', questId: 'quest-missing-courier', purpose: 'wake', status: 'dormant', failed: 'E_SCENERY_NO_FIT', place: null, frame: null, elements: [], standing: false }
		] );

		const visit = await probe.visitScene( 'courier-found' );
		expect( visit ).toMatchObject( { placed: true, standing: true, shown: [ 'courier', 'pool' ], target: null } );
		const [ [ door ], [ edge, aim ] ] = game.placePlayer.mock.calls;
		expect( door ).toEqual( { x: 10, y: expect.closeTo( 0.25 ), z: 12 } );
		// The door entry of the frame, 0.4 m in from its edge, on the flat's floor, aimed over the body.
		expect( edge ).toEqual( { x: 10, y: expect.closeTo( 2.45 ), z: expect.closeTo( 16.9 ) } );
		const body = staging.assembly.entities[ 0 ].transform.position;
		expect( aim ).toEqual( { x: body.x, y: body.y + 0.3, z: body.z } );

		expect( await probe.visitScene( 'wake' ) ).toMatchObject( { placed: false, standing: false, shown: [] } );
		await expect( probe.visitScene( 'ghost' ) ).rejects.toThrow( 'no scene ghost' );

	} );

} );
