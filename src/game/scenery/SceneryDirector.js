import { assertPoseClips } from './PoseCatalog.js';
import { evaluate, unknownReferences } from './SceneConditions.js';
import { ScenePlaceResolver } from './ScenePlaceResolver.js';
import { SceneryBoundary } from './SceneryBoundary.js';
import { SceneryCompiler } from './SceneryCompiler.js';
import { SceneryError } from './SceneryError.js';
import { SceneryRenderer } from './SceneryRenderer.js';

/** Real seconds between lifecycle passes; `refresh()` asks for one at the next update. */
const LIFECYCLE_SECONDS = 0.5;
/** A staged scene stands within this distance of the player, and goes past the second. */
const STAGE_RADIUS = 120;
const RELEASE_RADIUS = 140;
const QUEST_ENDED = Object.freeze( { kind: 'questEnded' } );

/**
 * When each quest scene stands. A scene is dormant until its `activeWhen`
 * holds, then staged: its identities are taken from the quest cast, its place
 * resolved and its elements compiled; it retires when its `retireWhen` holds
 * (the questline's end unless the spec says otherwise). Transitions only go
 * forward and are saved, so a flag that toggles never makes a scene flicker
 * and a retired scene never comes back.
 *
 * A staged scene is drawn while the player is within reach of its frame and,
 * indoors, while its floor is shown. Investigation scenes stage through the
 * same lifecycle: a scene linked to a scenery scene stages and retires with
 * it; an unlinked one stands while any of its bound steps is active or done
 * and retires when its questline ends.
 *
 * A scene that cannot stage or draw is failed for the session with a warning;
 * the game plays on and the save keeps what it last knew of that scene.
 */
export class SceneryDirector {

	/**
	 * @param specs the scene specs (`quests/scenery.json` or the bundle's)
	 * @param session the QuestSession the scenes follow
	 * @param sim the simulation port, for `getNPC`
	 * @param world `{ buildings, doors, atlas, obstacles }` the places resolve against (ScenePlaceResolver)
	 * @param missionAssets `{ get(assetId) }`, the bundle's mission asset assemblies
	 * @param interiors `{ floorShown(parcelId, floor) }`, the interior stream
	 * @param overlay the investigation layer: `lifecycles()`, `stage(sceneId, link)`, `retire(sceneId)`
	 * @param renderer a SceneryRenderer, else one is built from `poser`,
	 * `materialFactory`, `physics`, `playerCollider`, `lighting` and `warmup`
	 * @param animation the Pro library every pose clip must be in
	 * @param saved the saved scenery states
	 */
	static create( options ) {

		return new SceneryDirector( options );

	}

	constructor( {
		specs = [], session, sim, world = {}, missionAssets = null, interiors = null, overlay = null,
		renderer = null, animation = null, saved = [], theme, boundary = new SceneryBoundary(), ...adapter
	} ) {

		boundary.input( 'scene-specs', specs );
		boundary.input( 'saved-scenery', saved );
		if ( specs.length && animation ) assertPoseClips( animation );
		this.boundary = boundary;
		this.session = session;
		this.sim = sim;
		this.interiors = interiors;
		this.overlay = overlay;
		this.resolver = new ScenePlaceResolver( world );
		this.compiler = new SceneryCompiler( { boundary, missionAssets, theme } );
		this.renderer = renderer ?? new SceneryRenderer( adapter );
		this.group = this.renderer.group;
		this.scenes = new Map();
		this.gates = [];
		this.foreign = [];
		this.elapsed = 0;
		this.dirty = true;

		for ( const spec of [ ...specs ].sort( ( left, right ) => left.sceneId.localeCompare( right.sceneId ) ) ) {

			if ( this.scenes.has( spec.sceneId ) ) throw new SceneryError( 'E_SCENERY_INPUT', `duplicate scene ${spec.sceneId}` );
			this.scenes.set( spec.sceneId, this.#scene( spec ) );

		}
		this.#gates();
		for ( const state of saved ) this.#restore( state );

	}

	/** Asks for a lifecycle pass at the next update, after a quest has moved. */
	refresh() {

		this.dirty = true;

	}

	/**
	 * @param timeMin the simulation minute a transition is recorded at
	 * @param feet the player's feet, which scenes stand around
	 * @param delta real seconds since the previous update
	 */
	update( { timeMin, feet }, delta = 0 ) {

		this.elapsed += delta;
		if ( this.dirty || this.elapsed >= LIFECYCLE_SECONDS ) {

			this.elapsed = 0;
			this.dirty = false;
			this.#lifecycle( timeMin );

		}
		this.#residency( feet );

	}

	isStaged( sceneId ) {

		const scene = this.scenes.get( sceneId );
		return Boolean( scene && scene.status === 'staged' && ! scene.failed );

	}

	/** One scene as it stands: its spec, status, resolution, staging request and assembly. */
	sceneFor( sceneId ) {

		const scene = this.scenes.get( sceneId );
		if ( ! scene ) return null;
		return {
			spec: scene.spec,
			status: scene.status,
			failed: scene.failed?.code ?? null,
			resolved: scene.resolved,
			request: scene.compiled?.request ?? null,
			assembly: scene.compiled?.assembly ?? null
		};

	}

	/** Where the scenes standing now are, for a companion to lead the player to. */
	stagedPlaces() {

		return [ ...this.scenes.values() ]
			.filter( ( scene ) => scene.status === 'staged' && ! scene.failed )
			.map( ( { spec, resolved } ) => ( { sceneId: spec.sceneId, questId: spec.questId, purpose: spec.purpose, place: { ...resolved.place } } ) );

	}

	serialize() {

		const states = [ ...this.scenes.values() ].map( ( scene ) => scene.kept ?? stateOf( scene ) );
		return this.boundary.output( 'saved-scenery', [ ...states, ...this.foreign ] );

	}

	#scene( spec ) {

		const scene = {
			spec, entry: null, unavailable: false, status: 'dormant', stagedAtMin: null, retiredAtMin: null,
			resolved: null, compiled: null, failed: null, kept: null, links: []
		};
		const ids = [ ...spec.actors.map( ( actor ) => actor.actorId ), ...spec.props.map( ( prop ) => prop.propId ) ];
		const repeated = ids.find( ( id, index ) => ids.indexOf( id ) !== index );
		if ( repeated ) throw new SceneryError( 'E_SCENERY_INPUT', `scene ${spec.sceneId} repeats element ${repeated}` );
		scene.entry = this.session.entries.find( ( entry ) => entry.definition.id === spec.questId ) ?? null;
		if ( ! scene.entry ) {

			if ( ! this.session.blocked?.some( ( entry ) => entry.id === spec.questId ) ) {

				throw new SceneryError( 'E_SCENERY_BINDING', `scene ${spec.sceneId} names unknown quest ${spec.questId}` );

			}
			scene.unavailable = true;
			return scene;

		}
		const definition = scene.entry.definition;
		const unknown = [
			...unknownReferences( spec.activeWhen, definition ),
			...unknownReferences( spec.retireWhen ?? QUEST_ENDED, definition ),
			...spec.actors.filter( ( actor ) => actor.identity.kind === 'cast' && ! definition.roles.some( ( role ) => role.roleId === actor.identity.roleId ) )
				.map( ( actor ) => `roleId ${actor.identity.roleId}` )
		];
		if ( unknown.length ) throw new SceneryError( 'E_SCENERY_BINDING', `scene ${spec.sceneId} names what quest ${spec.questId} lacks: ${unknown.join( ', ' )}` );
		return scene;

	}

	/** Investigation scenes: linked ones follow their scenery scene, the rest their own bound steps. */
	#gates() {

		for ( const gate of this.overlay?.lifecycles() ?? [] ) {

			if ( gate.scenerySceneId ) {

				const scene = this.scenes.get( gate.scenerySceneId );
				if ( ! scene || scene.spec.questId !== gate.questId ) {

					throw new SceneryError( 'E_SCENERY_BINDING', `investigation ${gate.sceneId} links to unknown scene ${gate.scenerySceneId} of quest ${gate.questId}` );

				}
				if ( scene.spec.investigationSceneId !== gate.sceneId ) {

					throw new SceneryError( 'E_SCENERY_BINDING', `investigation ${gate.sceneId} links scene ${gate.scenerySceneId}, which names ${scene.spec.investigationSceneId ?? 'no investigation'} back` );

				}
				scene.links.push( gate.sceneId );
				continue;

			}
			const entry = this.session.entries.find( ( candidate ) => candidate.definition.id === gate.questId ) ?? null;
			this.gates.push( {
				sceneId: gate.sceneId,
				entry,
				activeWhen: { any: gate.stepIds.flatMap( ( stepId ) => [ { kind: 'stepActive', stepId }, { kind: 'stepDone', stepId } ] ) },
				status: 'dormant',
				failed: null
			} );

		}
		for ( const scene of this.scenes.values() ) {

			const named = scene.spec.investigationSceneId;
			if ( named !== undefined && ! scene.links.includes( named ) ) {

				throw new SceneryError( 'E_SCENERY_BINDING', `scene ${scene.spec.sceneId} names investigation ${named}, which does not link it` );

			}

		}

	}

	#restore( state ) {

		const scene = this.scenes.get( state.sceneId );
		if ( ! scene ) {

			warn( state.sceneId, new SceneryError( 'E_SCENERY_STATE', `saved scene ${state.sceneId} has no spec` ) );
			this.foreign.push( structuredClone( state ) );
			return;

		}
		scene.status = state.status;
		scene.stagedAtMin = state.stagedAtMin ?? null;
		scene.retiredAtMin = state.retiredAtMin ?? null;
		if ( state.status !== 'staged' ) return;
		try {

			const resolved = this.resolver.resolve( scene.spec.place, scene.spec.seed, state.resolved.place );
			scene.compiled = this.compiler.compile( scene.spec, resolved, state.resolved.actors );
			scene.resolved = { place: resolved.place, actors: structuredClone( state.resolved.actors ) };
			this.#link( scene );

		} catch ( error ) {

			scene.kept = structuredClone( state );
			this.#fail( scene, new SceneryError( 'E_SCENERY_STATE', `saved scene ${state.sceneId} cannot stand again: ${error.message}` ) );

		}

	}

	#lifecycle( timeMin ) {

		const contexts = new Map();
		const context = ( entry ) => {

			if ( ! contexts.has( entry ) ) contexts.set( entry, { state: entry.runtime.serialize(), cast: entry.runtime.cast, sim: this.sim } );
			return contexts.get( entry );

		};
		for ( const scene of this.scenes.values() ) {

			if ( scene.failed || scene.unavailable || scene.status === 'retired' ) continue;
			const now = context( scene.entry );
			const retire = evaluate( scene.spec.retireWhen ?? QUEST_ENDED, now );
			if ( scene.status === 'dormant' && ! retire && evaluate( scene.spec.activeWhen, now ) ) this.#stage( scene, timeMin );
			else if ( retire ) this.#retire( scene, timeMin );

		}
		for ( const gate of this.gates ) {

			if ( gate.failed || ! gate.entry || gate.status === 'retired' ) continue;
			const now = context( gate.entry );
			if ( evaluate( QUEST_ENDED, now ) ) {

				gate.status = 'retired';
				this.overlay.retire( gate.sceneId );

			} else if ( gate.status === 'dormant' && evaluate( gate.activeWhen, now ) ) {

				gate.status = 'staged';
				this.#offer( gate.sceneId, null, ( error ) => { gate.failed = error; } );

			}

		}

	}

	#stage( scene, timeMin ) {

		try {

			const actors = this.#identities( scene );
			const resolved = this.resolver.resolve( scene.spec.place, scene.spec.seed );
			scene.compiled = this.compiler.compile( scene.spec, resolved, actors );
			scene.resolved = { place: resolved.place, actors };
			scene.status = 'staged';
			scene.stagedAtMin = timeMin;
			this.#link( scene );

		} catch ( error ) {

			scene.compiled = null;
			this.#fail( scene, error );

		}

	}

	#retire( scene, timeMin ) {

		scene.status = 'retired';
		scene.retiredAtMin = timeMin;
		scene.resolved = null;
		scene.compiled = null;
		this.renderer.unrealize( scene.spec.sceneId );
		for ( const sceneId of scene.links ) this.overlay.retire( sceneId );

	}

	/** The people a staged scene lays out: a cast corpse is the cast person, dead in the simulation. */
	#identities( scene ) {

		return scene.spec.actors.map( ( actor ) => {

			if ( actor.identity.kind === 'anonymous' ) {

				return { actorId: actor.actorId, gender: actor.identity.gender, appearanceSeed: actor.identity.appearanceSeed };

			}
			const npcId = scene.entry.runtime.cast[ actor.identity.roleId ];
			const npc = npcId ? this.sim.getNPC( npcId ) : null;
			if ( ! npc ) throw new SceneryError( 'E_SCENERY_IDENTITY', `scene ${scene.spec.sceneId} role ${actor.identity.roleId} is nobody` );
			if ( npc.flags?.dead !== true ) throw new SceneryError( 'E_SCENERY_IDENTITY', `scene ${scene.spec.sceneId} lays out ${npcId}, who is alive` );
			return { actorId: actor.actorId, npcId, gender: npc.gender, appearanceSeed: npc.appearanceSeed };

		} );

	}

	#link( scene ) {

		for ( const sceneId of scene.links ) {

			this.#offer( sceneId, { request: scene.compiled.request, visuals: this.renderer.visuals( scene.spec.sceneId ) } );

		}

	}

	/** Stages one investigation scene; a failure there is warned and never reaches the game. */
	#offer( sceneId, link, failed = () => {} ) {

		let staging;
		try {

			staging = this.overlay.stage( sceneId, link );

		} catch ( error ) {

			staging = Promise.reject( error );

		}
		Promise.resolve( staging ).catch( ( error ) => {

			failed( error );
			warn( sceneId, error );

		} );

	}

	#residency( feet ) {

		for ( const scene of this.scenes.values() ) {

			const sceneId = scene.spec.sceneId;
			const assembly = scene.status === 'staged' && ! scene.failed ? scene.compiled?.assembly : null;
			const held = this.renderer.isRealized( sceneId ) || this.renderer.isPending( sceneId );
			if ( ! assembly ) {

				if ( held ) this.renderer.unrealize( sceneId );
				continue;

			}
			const { frame, place } = assembly;
			const distance = Math.hypot( feet.x - frame.origin.x, feet.z - frame.origin.z );
			const shown = frame.kind === 'street' || this.interiors?.floorShown( place.parcelId, place.floor ) === true;
			const wanted = shown && distance <= ( held ? RELEASE_RADIUS : STAGE_RADIUS );
			if ( wanted && ! held ) {

				this.renderer.realize( assembly ).catch( ( error ) => this.#fail( scene, error ) );

			} else if ( ! wanted && held ) {

				this.renderer.unrealize( sceneId );

			}

		}

	}

	#fail( scene, error ) {

		scene.failed = error;
		this.renderer.unrealize( scene.spec.sceneId );
		warn( scene.spec.sceneId, error );

	}

}

function stateOf( scene ) {

	const state = { contractVersion: '1.0', sceneId: scene.spec.sceneId, status: scene.status };
	if ( scene.status === 'staged' ) return { ...state, stagedAtMin: scene.stagedAtMin, resolved: structuredClone( scene.resolved ) };
	if ( scene.status === 'retired' ) {

		return { ...state, ...( scene.stagedAtMin !== null ? { stagedAtMin: scene.stagedAtMin } : {} ), retiredAtMin: scene.retiredAtMin };

	}
	return state;

}

function warn( sceneId, error ) {

	console.warn( `scenery ${sceneId}: ${error?.code ?? 'error'} ${error?.message ?? error}` );

}
