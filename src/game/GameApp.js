import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { MaterialResolver } from '../building/MaterialResolver.js';
import { TextureSource } from '../building/TextureSource.js';
import { PbrMaterialFactory } from '../building/PbrMaterialFactory.js';
import { TalkClient } from './talk/TalkClient.js';
import { NpcVoice } from './voice/NpcVoice.js';
import { stripCues } from '../../../quests/dist/runtime.js';
import { findPath } from '../../../interior/dist/nav.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestGameplay, questGameplayWorld } from './quests/QuestGameplay.js';
import { QuestActions } from './quests/QuestActions.js';
import { MissionItemAssets } from './quests/MissionItemAssets.js';
import { InvestigationGameplay } from './investigation/index.js';
import { SceneryDirector } from './scenery/index.js';
import { ObjectiveRouter } from './routes/ObjectiveRouter.js';
import { ObjectiveGuide } from './routes/ObjectiveGuide.js';
import { GamePersistence, mergeInventory, mergeProgress, uniqueLocations } from './persistence/index.js';
import { groundAnchors } from './agents/Anchors.js';
import { GameView } from '../ui/views/GameView.js';
import { GameConfig } from './data/GameConfig.js';
import { LoadProgress } from './LoadProgress.js';
import { WorldSource } from './data/WorldSource.js';
import { Signals } from './data/Signals.js';
import { SIDEWALK_HEIGHT } from './ground/GroundBuilder.js';
import { GroundScene } from './ground/GroundScene.js';
import { SafetyGround } from './ground/SafetyGround.js';
import { HydrologyHost } from './hydro/index.js';
import { BuildingsLoader } from './city/BuildingsLoader.js';
import { doorFrames } from './city/DoorGeometry.js';
import { ShellScene } from './ShellScene.js';
import { Links } from './links/Links.js';
import { Transit } from './transit/Transit.js';
import { StationAccess } from './transit/StationAccess.js';
import { TransitJourney } from './transit/TransitJourney.js';
import {
	TransitGameplay, transitErrorMessage, transitServiceLabel, transitStatusLabel
} from './transit/TransitGameplay.js';
import { InteriorStream } from './city/InteriorStream.js';
import { InteriorModules } from './city/InteriorModules.js';
import { InteriorProps } from './city/InteriorProps.js';
import { Elevators } from './city/Elevators.js';
import { Neon } from './city/Neon.js';
import { StreetLamps } from './city/StreetLamps.js';
import { Dressing } from './props/Dressing.js';
import { DressingObstacles } from './DressingObstacles.js';
import { StreetMarkings } from './city/StreetMarkings.js';
import { LitWindows } from './city/LitWindows.js';
import { RoomView } from './city/RoomView.js';
import { Venues } from './city/Venues.js';
import { CityLights } from './light/CityLights.js';
import { NightSwitch } from './light/NightSwitch.js';
import { NightLook } from './look/NightLook.js';
import { LOOK } from './look/LookSettings.js';
import { RoomLights } from './light/RoomLights.js';
import { ActorLighting } from './light/ActorLighting.js';
import { Haze } from './light/Haze.js';
import { HitchLog } from './debug/HitchLog.js';
import { RenderWork } from './debug/RenderWork.js';
import { FrameReports } from './debug/FrameReports.js';
import { Warmup } from './look/Warmup.js';
import { Physics, WorldColliders, DoorColliders, PlayerBody, BODY_RADIUS, ImpactWorld } from './physics/index.js';
import { FrameBudget } from '../app/FrameBudget.js';
import { Input } from './player/Input.js';
import { PlayerController } from './player/PlayerController.js';
import { Interactor } from './player/Interactor.js';
import { CharacterAssets } from './agents/CharacterAssets.js';
import { HeroCharacter } from './agents/HeroCharacter.js';
import { GameplayAnimationDirector } from './GameplayAnimationDirector.js';
import { Crowd } from './agents/Crowd.js';
import { WalkRoutes } from './agents/WalkRoutes.js';
import { NpcContinuity } from './agents/NpcContinuity.js';
import { InteriorRoutes } from './agents/InteriorRoutes.js';
import { CompanionGameplay } from './companion/CompanionGameplay.js';
import { CarModels } from './agents/CarModels.js';
import { Traffic } from './agents/Traffic.js';
import { SimBridge } from './sim/SimBridge.js';
import { GameClock } from './time/GameClock.js';
import { stopsFor } from './time/DayCycle.js';
import { Locator } from './world/Locator.js';
import { Bookmarks } from './world/Bookmarks.js';
import { mapModel, blockWorld } from './world/MapModel.js';

const _push = new THREE.Vector3();
const THEME = 'cyberpunk';
/** Named steps one load runs through, the counter's own first units. */
const LOAD_STEPS = 15;
/** Past this a room is behind opaque walls and haze, so it is not drawn. */
const ROOM_VISIBLE_RADIUS = 32;
const NPC_VISIBLE_RADIUS = 115;
/** Air scattering is wide and weak indoors, tight and small on the street. */
const INDOOR_HAZE = { spread: 0.55, cap: 3 };
const OUTDOOR_HAZE = { spread: 0.28, cap: 2.4 };
/** The HUD panels and the key that opens each, as the tab bar labels them. */
const PANEL_KEYS = [
	[ 'KeyJ', 'QUESTS' ], [ 'KeyM', 'MAP' ], [ 'KeyI', 'INVENTORY' ],
	[ 'KeyX', 'CODEX' ], [ 'KeyO', 'SETTINGS' ], [ 'Slash', 'CONTROLS' ]
];
const BINDINGS = [
	{ action: 'walk', keys: [ 'W', 'A', 'S', 'D' ] },
	{ action: 'jump', keys: [ 'Space' ] },
	{ action: 'crouch', keys: [ 'C' ] },
	{ action: 'sprint', keys: [ 'Shift' ] },
	{ action: 'running speed: normal / double / quadruple', keys: [ '1', '2', '4' ] },
	{ action: 'hold zoom', keys: [ 'Right mouse' ] },
	{ action: 'interact, board, leave transit, take, inspect, listen, steal, work, deliver', keys: [ 'E' ] },
	{ action: 'read quest document', keys: [ 'R' ] },
	{ action: 'quests', keys: [ 'J' ] },
	{ action: 'map', keys: [ 'M' ] },
	{ action: 'inventory', keys: [ 'I' ] },
	{ action: 'codex', keys: [ 'X' ] },
	{ action: 'settings', keys: [ 'O' ] },
	{ action: 'controls', keys: [ '?' ] },
	{ action: 'leave', keys: [ 'N' ] },
	{ action: 'pause, close a panel', keys: [ 'Esc' ] }
];

/** Standing still: this close to one spot for this long. */
const STILL_RADIUS = 0.1;
const STILL_SECONDS = 1;
/** How often the HUD asks the runtime again, so a closed venue opens on the line. */
const OBJECTIVE_INTERVAL = 4;
/**
 * A reply that sends nothing for this long is given up. It outlasts the talk
 * server's default model timeout (LLM_TIMEOUT_MS, 60 s), so a stalled model
 * reports its own error first.
 */
const REPLY_IDLE_MS = 90000;
const REPLY_FAILED = 'The reply could not be reached. Retry, or use a story reply below.';
const REPLY_REFUSED = 'The dialogue service refused this line because the game sent a request it does not accept. Retry would not help.';
/** A passer-by without identity only brushes the player off, and the chat says so. */
const PASSER_BY = { greeting: 'Sorry, I can\'t stop.', note: 'This passer-by has no time to chat.' };

/** The camera's depth range, which is also how far the world streams. */
const NEAR_PLANE = LOOK.near;
const FAR_PLANE = LOOK.far;

/**
 * One playable run of the city: mode=game. Loads the assembled world, builds
 * the night scene, puts a physical body on a sidewalk and hands it the mouse.
 * Everything it shows is generated data; nothing here invents a city.
 */
export class GameApp {

	constructor( config, {
		navigate = ( path ) => window.location.assign( path ),
		lineObserver = null
	} = {} ) {

		this.config = config;
		this.navigate = navigate;
		/**
		 * Hears every NPC line the chat shows: `said({ conversation, line, text })`
		 * for a whole line, or for each sentence of a streamed reply as it
		 * completes, with `line` its chat element; `silenced()` once what it
		 * heard stops mattering; optionally `upcoming({ conversation, texts })`
		 * for the replies the player's choices would bring. See #observe.
		 * Without one, the game speaks the lines itself (NpcVoice).
		 */
		this.lineObserver = lineObserver;
		/** The game's own NPC voice once the world is loaded, or null while a caller observes the lines. */
		this.voice = null;
		/** The observer heard a line it has not been silenced for since. */
		this.lineHeard = false;
		/** The questline the player is following; null means the main story. */
		this.followedQuestId = null;
		this.followedStepId = null;
		this.objectiveTimer = 0;
		/** Actions pressAction queued for the next tick. */
		this.pressedActions = new Set();
		/** The quest places the player stood in at the latest tick. */
		this.playerPlaces = [];
		/** The conversation the chat shows, or null. */
		this.conversationShown = null;
		/** The chat's action row: offer id to the label the player says. */
		this.dialogueActions = new Map();
		/** A leader's arrival while it opens its conversation, or null. */
		this.arriving = null;
		this.talk = new TalkClient( config.outBase );
		this.view = new GameView( {
			onResume: () => this.input?.requestLock(),
			onCloseDialog: () => {
				this.#closeConversation();
				if ( this.view.summary.element.hidden ) this.input?.requestLock();
			},
			onSummaryClose: () => this.input?.requestLock(),
			onSummaryOpen: () => { this.input?.exitLock(); this.view.setPaused( false ); },
			onSend: ( text ) => this.#say( text ),
			onOpen: ( name ) => {

				this.input?.exitLock();
				if ( name === 'QUESTS' ) this.#refreshQuestState();

			},
			onQuestTrack: ( questId, stepId ) => this.#followQuest( questId, stepId ),
			onQuestWait: ( questId, stepId ) => this.#waitForQuest( questId, stepId ),
			onDialogueChoice: choice => this.#chooseDialogue( choice ),
			onDialogueTopic: topic => this.#selectDialogue( topic ),
			onDialogueAction: id => this.#dialogueAction( id ),
			onDialogueRetry: () => this.#say( this.failedDialogueLine, { retry: true } ),
			onDialogueJournal: () => { this.#closeConversation(); this.view.open( 'QUESTS' ); },
			onClose: () => this.input?.requestLock(),
			onLeave: () => this.#leave(),
			onSettingChange: ( change ) => this.#setting( change ),
			onTransitSelect: ( service ) => this.#selectTransit( service ),
			onTransitCancel: () => this.#cancelTransitSelection()
		} );
		this.view.mount( document.body );
		this.stats = {
			frameMs: 16.7, gpuMs: 0, drawCalls: 0, triangles: 0,
			crowd: 0, cars: 0, interiors: 0, lights: 0,
			backend: '-', tier: '-', width: 0, height: 0,
			materials: 0, unresolved: 0, unknownVariants: 0, hitches: 0, worstMs: 0
		};

	}

	async start() {

		try {

			await this.#run();

		} catch ( error ) {

			console.error( error );
			this.view.fail( String( error?.stack ?? error?.message ?? error ) );

		}

	}

	async #run() {

		const config = this.config;
		const progress = this.progress = new LoadProgress(
			( text ) => this.view.step( text ), { log: import.meta.env.DEV }
		);
		progress.plan( LOAD_STEPS ).step( 'reading the world' );
		// Every lump of work the load or the city does is named here, and one
		// budget paces all of it: unpaced while there is no frame to protect,
		// a few milliseconds a frame once the city is drawn.
		this.hitches = new HitchLog();
		const slice = new FrameBudget( { paced: false } );
		// What a first frame needs that the world's own documents do not decide
		// starts here and is awaited where it is used: the renderer, the material
		// theme, the physics engine, the characters and the cars all fetch while
		// the city is being read.
		const source = new WorldSource( config );
		const reading = progress.timed( 'world documents', source.load() );
		const rendering = progress.timed( 'renderer', RendererFactory.create( config.backend ) );
		const resolver = new MaterialResolver();
		const theme = progress.timed( 'material theme', resolver.loadTheme( THEME ) );
		const starting = progress.timed( 'physics', Physics.create() );
		const cars = progress.timed( 'cars', CarModels.load( config.maxCars ) );
		const {
			atlas, connections, nativeStreets, rooftopSpans, buildings, unbuilt, npcTypes, questlines, investigations, scenery,
			mechanicTargetBindings, missionAssetRequests, missionItemBindings, game, shellCatalog, kit,
			interiorModules, interiorProps, loadBuildings
		} = await reading;
		const spawn = game ? savedSpawn( game ) : pickSpawn( connections.networks, atlas, unbuilt.length ? buildings : undefined );
		const spatial = Boolean( shellCatalog );
		const transitRoutes = connections.networks.transit.routes;
		this.transitJourney = new TransitJourney( {
			atlas, routes: transitRoutes, ...( game?.transitJourney ? { state: game.transitJourney } : {} )
		} );
		this.persistence = game ? new GamePersistence( { game, gameId: config.gameId } ) : null;
		// What people remember of talking with the player is the save's: the
		// dialogue server takes it back beside the load, or before the first
		// talk or save that finds it has not.
		const remembering = game && this.talk.restoreMemory( game.dialogueMemory ?? [] )
			.catch( ( error ) => console.warn( 'dialogue memory not restored yet:', error.message ) );
		const stationAccess = new StationAccess( atlas );
		this.locator = new Locator( atlas, transitRoutes, stationAccess.entrances, {
			buildingFootprints: occupiedBuildingFootprints( shellCatalog, buildings )
		} );
		this.clock = new GameClock( {
			startHour: transitStartHour(
				this.transitJourney,
				game?.npcState ? game.npcState.timeMin / 60 : config.startHour
			),
			scale: config.timeScale
		} );

		progress.step( 'starting the renderer' );
		this.renderer = await rendering;
		// After init, because that is when the WebGPU-to-WebGL2 fallback has
		// already happened and the tier is a choice about cost, not backend.
		const backend = RendererFactory.actualBackend( this.renderer );
		this.stats.backend = backend;
		this.look = NightLook.begin( this.renderer, {
			quality: config.quality, backend, exposure: config.exposure,
			bloom: ! config.off.has( 'bloom' ), haze: ! config.off.has( 'haze' )
		} );
		this.tier = this.look.tier;
		this.lighting = this.look.lighting;
		this.exposure = this.look.exposure;
		document.body.prepend( this.renderer.domElement );

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( LOOK.fov, window.innerWidth / window.innerHeight, NEAR_PLANE, FAR_PLANE );
		// The crowd's own files need the backend and nothing else. Its bake is
		// seconds of vertex work, so it runs under the load's budget beside the
		// rest of the load and counts its parts on the loading view.
		const baking = progress.pass( 'baking the crowd' );
		const characters = progress.timed( 'characters', CharacterAssets.load( config.maxCrowd, backend === 'webgpu', {
			slice, onProgress: ( done, total ) => baking.at( done, total )
		} ) );

		progress.step( 'resolving materials' );
		await theme;
		this.resolver = resolver;
		const factory = new PbrMaterialFactory( resolver, this.tier, new TextureSource().detect( this.renderer ) );
		this.missionItems = new MissionItemAssets( {
			requests: missionAssetRequests,
			bindings: missionItemBindings,
			mechanicBindings: mechanicTargetBindings,
			materialCatalog: resolver.missionCatalog( THEME )
		} );
		this.rooms = new RoomLights( factory, this.tier );
		this.physics = await starting;
		this.colliders = new WorldColliders( this.physics, { hitches: this.hitches } );

		progress.step( 'laying the ground' );
		this.nativeStreets = nativeStreets;
		const ground = this.groundStream = new GroundScene( atlas, factory, nativeStreets,
			{ anisotropy: this.tier.textureAnisotropy ?? 8 }, { catalog: shellCatalog, buildings } );
		this.scene.add( ground.group );
		const laying = progress.timed( 'ground', ground.update( spawn.point, { radius: FAR_PLANE, collisionRadius: 256, collision: this.colliders } ) );
		const water = progress.timed( 'water', HydrologyHost.install( { blueprint: atlas, factory, scene: this.scene } ) );

		progress.step( `loading ${buildings.size} buildings` );
		if ( spatial ) this.shellScene = new ShellScene( {
			atlas, catalog: shellCatalog, factory, buildings, loadBuildings, kit, slice, hitches: this.hitches,
			physics: this.physics, colliders: this.colliders,
			interiors: ! config.off.has( 'interiors' ), haze: this.tier.haze ? OUTDOOR_HAZE : null
		} );
		const standing = progress.timed( 'building plans and shells',
			spatial ? this.shellScene.stream.load( spawn.point ) : new BuildingsLoader( factory ).load( buildings ) );
		// The street's lamps and dressing and the room catalogs belong to the
		// city, not to any cell of it, so they are read beside the building
		// plans instead of after them. Each of these is its own set of files.
		const lamps = new StreetLamps( atlas, factory, connections.networks.walk ).build();
		// What stands solid on the street: dressing keeps clear of it, and a
		// quest scene on the sidewalk stands around it and the dressing both.
		const obstacles = [ ...DressingObstacles.fromPosts( lamps.posts ), ...DressingObstacles.fromFeatures( nativeStreets?.manifest.features ?? [] ) ];
		const dressing = progress.timed( 'street props', new Dressing( atlas, connections.networks.walk, factory, {
			replacedModuleOwnerIds: nativeStreets?.manifest.ground.replacements.moduleOwnerIds ?? [],
			obstacles
		} ).stream() );
		// The room modules and the furniture are the city's, not any building's:
		// loaded once, drawn once per surface however many floors are standing.
		this.interiorModules = interiorModules
			? new InteriorModules( { catalog: interiorModules.document, baseUrl: interiorModules.baseUrl, factory, roomLights: this.rooms } )
			: null;
		this.interiorProps = interiorProps
			? new InteriorProps( { catalog: interiorProps.document, baseUrl: interiorProps.baseUrl, roomLights: this.rooms } )
			: null;
		const [ city ] = await Promise.all( [ standing, laying, progress.timed( 'room catalogs', this.interiorModules?.ready ) ] );
		this.hydrology = await water;
		this.scene.add( city.group );

		this.elevators = new Elevators( factory );
		this.stream = new InteriorStream( {
			modules: this.interiorModules, props: this.interiorProps, roomLights: this.rooms, elevators: this.elevators,
			haze: this.tier.haze ? INDOOR_HAZE : null, hitches: this.hitches
		} );
		if ( this.interiorModules && ! config.off.has( 'interiors' ) ) this.stream.register( buildings, city.centers );
		this.scene.add( this.stream.group );

		progress.step( 'hanging the neon' );
		const neon = spatial ? { group: new THREE.Group(), glows: [] } : new Neon( atlas, buildings, factory ).build();
		const links = new Links( connections, factory, rooftopSpans, { hosts: roofElevations( shellCatalog, buildings ) } ).build();
		const props = this.propsStream = await dressing;
		await props.update( spawn.point, { radius: FAR_PLANE, collisionRadius: 256, collision: this.colliders } );
		this.transit = new Transit( { atlas, networks: connections.networks, factory } );
		this.windowRooms = new LitWindows( atlas, buildings, factory );
		this.scene.add(
			neon.group,
			lamps.group,
			links.group,
			props.group,
			this.transit.group,
			await StreetMarkings.build( atlas, connections.networks, factory, resolver, config.laneMode, Boolean( nativeStreets ) ),
			this.windowRooms.build( { enabled: ! spatial && ! config.off.has( 'interiors' ) } )
		);

		progress.step( 'lighting the street' );
		// Tens of thousands of fixtures stand in a streamed city (every window's
		// room lights among them), so the list is built by concatenation and
		// refilled in place: a spread of that many arguments overflows the stack.
		const stableFixtures = ( this.shellScene?.pinnedGlows ?? neon.glows ).concat( lamps.glows, this.transit.glows );
		const fixtures = stableFixtures.concat( this.shellScene?.streamedGlows ?? [] );
		this.lights = new CityLights( fixtures, this.lighting.capacity, { streamed: Boolean( spatial ) } );
		if ( this.shellScene ) this.shellScene.onFixturesChanged = () => this.hitches.time( 'fixtures', () => {

			fixtures.length = 0;
			for ( const fixture of stableFixtures ) fixtures.push( fixture );
			for ( const fixture of this.shellScene.streamedGlows ) fixtures.push( fixture );
			this.lights.setFixtures( fixtures );

		} );
		this.scene.add( this.lights.group );
		this.roomView = new RoomView( this.stream.rooms, ROOM_VISIBLE_RADIUS );
		// Entrance fixtures and prompts identify buildings with playable interiors.
		this.venues = new Venues( { atlas, buildings, doors: city.entrances, fixtures, factory, signs: this.shellScene?.signs ?? null } );
		this.scene.add( this.venues.build( city.entrances ) );
		this.#hangHaze( spatial ? [ ...lamps.glows, ...this.transit.glows ] : fixtures );

		progress.step( 'raising the sky' );
		this.look.raise( this.scene, {
			hour: config.lightingHour,
			fog: config.off.has( 'fog' ) ? { density: 0, indoorDensity: 0 } : { density: config.fog },
			probe: ! config.off.has( 'probe' ),
			hitches: this.hitches
		} );
		this.sky = this.look.sky;
		this.fog = this.look.fog;
		this.probe = this.look.probe;
		// Emitting surfaces share the scene's fixed night setting.
		this.night = new NightSwitch( this.lights )
			.addGroup( neon.group ).addGroup( lamps.group ).addGroup( city.group ).addGroup( this.transit.group ).addGroup( props.group );
		if ( this.shellScene ) this.shellScene.night = this.night;
		this.probe?.exclude( this.stream.group, props.group, this.transit.group );
		if ( this.hydrology.group ) this.probe?.exclude( this.hydrology.group );

		progress.step( 'building the physics world' );
		this.safetyGround = new SafetyGround( {
			atlas, buildings, groups: [ ground.group, city.group, links.group, this.transit.group ],
			physics: this.physics, factory, camera: this.camera
		} );
		this.scene.add( this.safetyGround.mesh );
		this.doorColliders = new DoorColliders( this.physics, city.doors );
		this.impactWorld = new ImpactWorld( this.physics );
		await this.colliders.addStaticsAsync( city.shellColliders, { release: true } );
		city.shellColliders.clear();
		await this.colliders.addStaticsAsync( [ [ 'building links', links.colliderGeometry ] ], { release: true } );
		await this.colliders.addStaticsAsync( this.transit.colliders );
		await this.colliders.addPostsAsync( lamps.posts );
		// A floor's modules are cuboids and become solid at once; its furniture
		// keeps the exact triangles the street props use and cooks across frames.
		this.stream.onColliderBand = ( id, { boxes, positions } ) => {

			if ( boxes.length ) this.colliders.addBoxes( `interior:${id}`, boxes );
			return positions.length ? this.colliders.addBand( `interior:${id}/props`, positions ) : true;

		};
		this.stream.onDropBand = ( id ) => {

			this.colliders.dropBand( `interior:${id}` );
			this.colliders.dropBand( `interior:${id}/props` );

		};

		progress.step( 'waking the population' );
		this.sim = SimBridge.create(
			atlas,
			connections,
			buildings,
			{ streetDensity: config.streetDensity },
			npcTypes,
			game?.npcState?.simulation ?? null
		);
		this.quests = QuestSession.create(
			questlines,
			this.sim,
			this.clock.timeMin,
			game ? [ ...game.quests, ...game.sideJobs ] : [],
			{ world: atlas, types: npcTypes }
		);
		this.savedInventory = game?.player.inventory ?? [];
		this.questItemIds = questlines.flatMap( ( questline ) => questline.items.map( ( item ) => item.itemId ) );
		this.#refreshInventory();
		this.view.quests.setQuests( this.quests.view( this.clock.timeMin ) );
		this.signals = new Signals( connections.networks );
		const routes = new WalkRoutes( connections.networks );
		const crowdPlaces = placesOf( city.entrances, buildings );
		const continuityPlaces = npcContinuityPlaces( atlas, city.entrances, buildings, transitRoutes );
		this.npcContinuity = new NpcContinuity( {
			simulation: this.sim,
			routes,
			places: continuityPlaces,
			interiorRoutes: new InteriorRoutes( buildings, { findPath } )
		} );
		if ( game?.npcState?.continuity ) {

			this.npcContinuity.restore( game.npcState.continuity );
			// A save can be made while a choice is answered. The modal itself
			// does not survive reload, so do not restore an orphan conversation.
			if ( this.npcContinuity.conversation ) this.npcContinuity.endConversation( {
				timeMin: this.clock.timeMin, hold: this.quests.holdsCast( this.npcContinuity.conversation.npcId )
			} );

		}

		progress.step( 'loading characters' );
		const assets = await characters;
		const actorLighting = new ActorLighting( this.rooms, () => this.stream.rooms );
		this.scene.add( assets.group );
		this.probe?.exclude( assets.group );
		this.crowd = new Crowd( {
			assets, routes, sim: this.sim, signals: this.signals,
			places: crowdPlaces,
			capacity: config.maxCrowd,
			spawnRadius: config.crowdRadius,
			stress: config.stress,
			continuity: this.npcContinuity,
			lighting: actorLighting,
			// Walkers keep out of the bodies a street scene stands.
			blockers: () => this.scenery?.blockers() ?? []
		} );
		this.hero = await HeroCharacter.create( {
			animation: assets.animation,
			warmup: null,
			textureSize: this.tier.textureMaxSize,
			lighting: actorLighting
		} );
		this.scene.add( this.hero.group );
		this.animations = new GameplayAnimationDirector( {
			catalog: assets.animationCatalog,
			animation: assets.animation,
			crowd: this.crowd,
			hero: this.hero
		} );
		if ( ! this.lineObserver ) {

			this.lineObserver = this.voice = NpcVoice.forGame( {
				dialog: this.view.dialog, npcTypes, quests: this.quests, animations: this.animations, enabled: config.voice, target: window
			} );

		}

		progress.step( 'loading traffic' );
		const carModels = await cars;
		this.scene.add( carModels.group );
		this.traffic = new Traffic( {
			networks: connections.networks, models: carModels,
			signals: this.signals, capacity: config.maxCars,
			spawnRadius: config.carRadius,
			seed: atlas.meta.seed
		} );

		progress.step( 'stepping outside' );
		this.body = new PlayerBody( this.physics, spawn.point );
		this.input = new Input( this.renderer.domElement );
		this.controller = new PlayerController( { body: this.body, camera: this.camera, input: this.input } );
		if ( spawn.heading === undefined ) this.controller.lookAt( spawn.lookAt );
		else this.controller.yaw = spawn.heading;
		this.transitGameplay = new TransitGameplay( {
			atlas,
			routes: transitRoutes,
			...( game?.transitJourney ? { state: game.transitJourney } : {} ),
			journey: this.transitJourney,
			locator: this.locator,
			controller: this.controller
		} );
		if ( this.transitGameplay.restoreRejected ) console.warn( 'transit journey: saved trip is no longer valid' );
		this.currentLocation = this.locator.location( spawn.point.x, spawn.point.z );
		this.discoveredLocations = new Map(
			( game?.discoveredLocations ?? [ this.currentLocation ] ).map( ( location ) => [ location.id, location ] )
		);
		this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
		this.bookmarks = new Bookmarks( { fixtures, rooms: () => this.stream.rooms, networks: connections.networks } );
		this.questGameplay = new QuestGameplay( {
			session: this.quests,
			world: questGameplayWorld( atlas, city.entrances ),
			crowd: this.crowd,
			physics: this.physics,
			playerCollider: this.body.collider,
			materialFactory: factory,
			missionItems: this.missionItems,
			continuity: this.npcContinuity,
			animations: this.animations
		} );
		const savedTransitQuest = game && Object.hasOwn( game, 'questTransit' ) ? game.questTransit : undefined;
		const transitState = this.transitJourney.state;
		const activeJourney = transitState.status === 'aboard'
			? { tripId: transitState.tripId, routeId: transitState.routeId }
			: null;
		const transitQuest = savedTransitQuest === undefined
			? restoredTransitQuest( this.transitJourney, transitRoutes, this.clock.timeMin, this.body.feet )
			: null;
		const restoreRequested = Boolean( savedTransitQuest || transitQuest );
		const restored = savedTransitQuest
			? this.questGameplay.restoreTransitState( {
				timeMin: this.clock.timeMin,
				position: { x: this.body.feet.x, y: this.body.feet.y, z: this.body.feet.z },
				state: savedTransitQuest,
				journey: activeJourney
			} )
			: transitQuest ? this.questGameplay.restoreTransit( transitQuest ) : false;
		if ( restoreRequested && ! restored ) {

			console.warn( 'transit quest: active ride does not match an available quest step' );

		}
		this.scene.add( this.questGameplay.group );
		this.probe?.exclude( this.questGameplay.group );
		this.companion = new CompanionGameplay( {
			continuity: this.npcContinuity, sim: this.sim, routes, places: continuityPlaces, atlas,
			quests: this.questGameplay, scenes: () => companionScenes( this.scenery.stagedPlaces(), this.companion.places ), crowd: this.crowd
		} );
		// After the continuity and with no conversation open: the escort first,
		// then the companion, which lets go a follower neither of them owns.
		if ( game?.npcState ) {

			this.questGameplay.restoreEscort( { timeMin: this.clock.timeMin, state: game.npcState.questEscort ?? null } );
			this.companion.restore( { timeMin: this.clock.timeMin, state: game.npcState.companion ?? null } );

		}
		this.investigations = await InvestigationGameplay.create( {
			requests: investigations,
			session: this.quests,
			materialFactory: factory,
			physics: this.physics,
			playerCollider: this.body.collider,
			animation: assets.animation,
			saved: game?.investigations ?? []
		} );
		this.scene.add( this.investigations.group );
		this.probe?.exclude( this.investigations.group );
		// What the quests leave standing, while they call for it; it also
		// decides when each investigation scene stands.
		this.scenery = questScenery( {
			specs: scenery, game, session: this.quests, sim: this.sim, investigations: this.investigations,
			world: { buildings, doors: city.entrances, atlas, obstacles: [ ...obstacles, ...DressingObstacles.fromPlacements( props.placements ) ] },
			missionAssets: { get: ( assetId ) => this.missionItems.asset( assetId ) },
			interiors: this.stream, animation: assets.animation, theme: THEME, poser: this.hero.poser, lighting: actorLighting,
			materialFactory: factory, physics: this.physics, playerCollider: this.body.collider
		} );
		this.scene.add( this.scenery.group );
		this.probe?.exclude( this.scenery.group );
		this.objectiveGuide = new ObjectiveGuide( new ObjectiveRouter( stationAccess.walk( connections.networks.walk ), {
			places: routePlaces( city.entrances )
		} ) );
		this.#refreshCurrentObjective();

		// Construct the scene pass before a WebGPU probe bake so its final
		// material programs can be warmed against that render context.
		progress.step( 'warming the renderer' );
		this.look.compose( this.camera );
		this.floorWarmup = prepareInteriorStreaming(
			this.stream, this.renderer, this.scene, this.camera, this.look.pipeline.mrt, this.look.pipeline.renderTarget
		);
		if ( this.shellScene ) this.shellScene.warmup = this.floorWarmup;
		// A focused character's model and a scene the quests stand are prepared
		// through the same queue when they are asked for, not on the frame that
		// first draws them.
		this.hero.warmup = this.floorWarmup;
		this.scenery.renderer.warmup = this.floorWarmup;
		this.investigations.renderer.warmup = this.floorWarmup;
		// The city is about to be drawn, so admitting a cell from here on gives
		// the frame its turn instead of holding it.
		slice.pace();
		// Every pass counts into the load's own tally, and warms the programs it
		// is the first to need: one the ground already built costs the street
		// props nothing, and the city pass ends up with what neither had.
		const preparing = ( what ) => ( group, options ) => {

			const pass = progress.pass( `preparing ${what}` );

			return this.floorWarmup.warmAll( group, { ...options, onProgress: ( done, total ) => pass.at( done, total ) } );

		};
		if ( this.groundStream ) await this.groundStream.update( spawn.point, { prepare: preparing( 'the ground' ) } );
		await this.propsStream.update( spawn.point, { prepare: preparing( 'street props' ) } );
		const surfaces = progress.pass( 'preparing city surfaces' );
		await this.floorWarmup.warmAll( this.scene, { onProgress: ( done, total ) => surfaces.at( done, total ) } );
		// The shapes a conversation or a fall puts on the street, read and
		// built now so neither ever uploads or links.
		const heroes = progress.pass( 'preparing the characters' );
		await this.hero.prepare( ( done, total ) => heroes.at( done, total ) );

		this.interactor = new Interactor( {
			crowd: this.crowd, doors: city.doors, sim: this.sim,
			controller: this.controller, elevators: this.elevators, quests: this.questGameplay,
			investigations: this.investigations,
			continuity: this.npcContinuity,
			animations: this.animations,
			doorColliders: this.doorColliders
		} );
		this.interactor.onConversation = ( conversation ) => this.presentConversation( conversation );

		this.input.onLockChange = ( locked ) => {

			this.controller.frozen = ! locked;

		};

		const map = mapModel( atlas, connections.networks );
		this.view.minimap.setMap( map );
		this.view.minimap.setVenues( this.venues.marks );
		this.view.map.setWorld( blockWorld( atlas, connections.networks ) );
		this.view.map.setVenues( this.venues.marks );
		this.#updateObjectiveRoute( 0, true );
		this.view.settings.setValues( {
			quality: this.tier.name, fog: config.fog, exposure: config.exposure, crowd: config.maxCrowd,
			voice: this.voice?.enabled ? 'on' : 'off', voiceVolume: this.voice?.volume ?? 1
		} );
		this.view.controls.setBindings( BINDINGS );
		this.view.readout.setAbout( [
			config.blueprintUrl,
			`${config.outBase}/ (${buildings.size} built${unbuilt.length ? `, ${unbuilt.length} unbuilt` : ''})`,
			`/materials/${THEME}`,
			'/models/quaternius'
		] );
		// The first frame is a whole tick, run here under the loading view: what
		// the first update of the crowd, the lights, the rooms and the streams
		// brings to the renderer is built now. The probe then renders the city
		// six times into its resident environment, its graphs and faces each
		// counted, and a last pass pins whatever program that frame was the
		// first to ask for.
		progress.step( 'preparing the first frame' );
		this.playStartedAt = performance.now();
		this.tick( 0 );
		if ( this.probe ) {

			const probing = progress.pass( 'preparing the probe' );
			await this.probe.prepare( this.floorWarmup, ( done, total ) => probing.at( done, total ) );
			const baking = progress.pass( 'baking the environment' );
			await this.probe.bakeAsync( spawn.point, { slice, onProgress: ( done, total ) => baking.at( done, total ) } );

		}
		const pinning = progress.pass( 'pinning the programs' );
		await this.floorWarmup.warmAll( this.scene, { onProgress: ( done, total ) => pinning.at( done, total ) } );
		await remembering;
		this.hitches.notes.length = 0;
		this.view.setPaused( true );
		this.view.ready();
		progress.finish();
		// A new game opens on its story's prologue; Begin or Escape hands over the mouse.
		const prologue = this.persistence?.unplayed ? this.quests.prologue() : null;
		if ( prologue ) this.view.summary.show( { kind: 'prologue', ...prologue } );

		this.renderer.domElement.addEventListener( 'click', () => {
			if ( ! playableModalOpen( this.view, this.interactor ) ) this.input.requestLock();
		} );
		window.addEventListener( 'resize', () => this.#resize() );

		if ( import.meta.env.DEV ) window.__game = this;
		if ( import.meta.hot ) this.frameReports = new FrameReports(
			report => import.meta.hot.send( 'urbe:performance', report ),
			() => ( {
				game: config.gameId ?? null,
				stats: { ...this.stats, pointerLocked: Boolean( document.pointerLockElement ), hidden: document.hidden, loadingFloors: this.stream.loading },
				memory: { ...this.renderer.info.memory },
				position: this.body.feet.toArray()
			} )
		);

		this.baseTriangles = city.triangles + links.triangles + ( this.hydrology.summary?.triangles ?? 0 );
		// From here every program and map the renderer builds is the frame's own.
		this.work = new RenderWork( this.renderer.info );
		this.last = performance.now();
		this.renderer.setAnimationLoop( () => this.#frame() );
		// A driver's hands on a read-only preview, installed once the city plays.
		if ( config.automation ) {

			const { AutomationProbe } = await import( './debug/AutomationProbe.js' );
			this.automation = new AutomationProbe( this );

		}

	}

	/**
	 * Shows or closes the typed conversation owned by the current interaction.
	 * A person who agreed to come along goes on saying so as the chat closes;
	 * every other close silences what was said.
	 */
	presentConversation( conversation ) {

		const leaving = this.conversationShown;
		this.conversationShown = conversation;
		this.#interrupt( { silence: Boolean( conversation ) || ! this.#comingAlong( leaving ) } );
		this.failedDialogueLine = null;
		this.activeDialogue = null;
		const speaker = conversation && speakerOf( conversation );
		this.view.dialog.show( speaker );
		this.view.avatar.setVisible( Boolean( conversation ) );

		if ( ! conversation ) {

			if ( this.pendingDialogueEnding ) this.view.summary.show( this.pendingDialogueEnding );
			this.pendingDialogueEnding = null;
			return;

		}
		if ( ! conversation.instance ) this.view.dialog.setFreeChat( false, PASSER_BY.note );
		const topics = this.quests.dialoguesFor( conversation.npcId, this.clock.timeMin );
		const preferred = topics.find( topic => topic.questlineId === this.followedQuestId ) ?? topics[ 0 ];
		const arrival = this.arriving?.npcId === conversation.npcId ? this.arriving : null;
		if ( preferred ) this.#selectDialogue( { questId: preferred.questlineId, stepId: preferred.stepId } );
		// A person who has led the player here talks about the place.
		else if ( arrival ) this.#say( arrival.ask, { arrival } );
		else {

			const recap = this.quests.conversationRecap( conversation.npcId );
			this.view.dialog.setStory( recap ? { title: recap.title, objective: 'Previous conversation' } : null );
			this.#npcSays( conversation, recap?.reply ?? ( conversation.instance ? 'What can I do for you?' : PASSER_BY.greeting ) );
			if ( recap ) {

				this.view.dialog.setStatus( 'Your current lead is in the journal.' );
				this.view.dialog.setChoices( [ ...recap.questions,
					{ id: 'remember-agreement', text: 'Remind me what we agreed.' }
				].map( choice => ( { text: choice.text,
					value: { recap: true, questId: recap.questId, stepId: recap.stepId, choiceId: choice.id }
				} ) ), true );
				this.#observe( 'upcoming', { conversation, texts: recap.questions.map( question => question.reply ) } );

			}

		}
		this.#showActions( conversation );

		// The chat takes the mouse: the input wants focus and the panel a click.
		this.view.avatar.setAvatar( { name: speaker.name, bar: 1 } );
		this.input.exitLock();

	}

	#frame() {

		const now = performance.now();
		// What the renderer built for itself last frame, before the gap that
		// carried it is printed: a link and an upload are blocking work the
		// world never asked for and could not otherwise name.
		const built = this.work.since();
		if ( built ) this.hitches.note( built );
		this.frameReports?.frame( now, now - this.last, this.hitches.notes );
		this.hitches.frame( now - this.last );
		this.tick( Math.min( 0.05, ( now - this.last ) / 1000 ) );
		this.last = now;
		this.#measure( performance.now() - now );

	}

	/**
	 * One step of the world: clock, physics, agents, interaction, render. The
	 * animation loop calls this with real elapsed time; anything that needs to
	 * drive the game without a display can call it directly.
	 */
	tick( delta ) {

		this.controller.frozen = ! this.input.locked || playableModalOpen( this.view, this.interactor );
		this.clock.advance( delta );
		this.hydrology.update( Math.max( 0, ( performance.now() - this.playStartedAt ) / 1000 ) );

		const day = this.sky.day;
		this.night.set( day.lampsOn );
		this.exposure.setDaylight( stopsFor( day.state ) );
		this.view.clock.setState( day.state );
		let transitFrame = this.transitGameplay.aboard
			? this.transitGameplay.update( { daySeconds: this.clock.daySeconds } )
			: null;

		this.hitches.time( 'physics/player', () => {

			this.physics.step( delta );

			// Out of anyone the crowd walked into last frame before the camera is
			// placed, so the correction never shows up as a jolt a frame later.
			this.body.push( _push.copy( this.crowd.pushback( this.body.feet, BODY_RADIUS ) ).add( this.traffic.pushback( this.body.feet, BODY_RADIUS ) ) );
			this.controller.update( delta );

		} );
		for ( const impact of this.impactWorld.drain() ) this.#ragdoll( impact );

		const feet = this.body.feet;
		this.safetyGround.update( this.camera );
		this.shellScene?.stream.update( feet );
		this.groundStream?.update( feet ).catch( error => console.error( 'ground streaming', error ) );
		this.propsStream?.update( feet ).catch( error => console.error( 'prop streaming', error ) );

		this.hitches.time( 'interior stream', () => {

			if ( this.stream.update( feet ) ) this.roomView.setRooms( this.stream.rooms );

		} );

		this.lights.update( this.camera.position, delta );
		const playerPlaces = this.playerPlaces = questPlayerPlaces( this.locator, feet, this.standing?.parcelId ?? null );
		const room = this.standing;
		const playerPosition = feet.toArray();
		this.hitches.time( 'follow', () => this.npcContinuity.updateFollow( {
			timeMin: this.clock.timeMin,
			deltaSeconds: delta,
			playerPosition,
			...( room ? { playerPlace: { kind: 'parcel', id: room.parcelId, floor: room.floor } } : {} )
		} ) );
		this.updateCompanion( playerPosition, playerPlaces );
		this.hitches.time( 'crowd', () => {

			const actors = this.npcContinuity.updateVisible( {
				timeMin: this.clock.timeMin,
				playerPosition,
				maxDistance: NPC_VISIBLE_RADIUS
			} );
			this.crowd.syncActors( actors, feet );
			this.animations.update( actors, delta );
			this.crowd.update( delta, feet, this.clock );

		} );
		this.hitches.time( 'scenery', () => this.scenery.update( { timeMin: this.clock.timeMin, feet }, delta ) );
		this.hero.update( delta );
		this.hitches.time( 'traffic', () => this.traffic.update( delta, feet, this.clock.daySeconds ) );
		this.impactWorld.sync( {
			people: [ ...this.crowd.members.values() ],
			vehicles: this.traffic.cars
		} );
		this.transit.update( feet, this.clock.daySeconds );
		this.elevators.update( delta, this.body );
		this.venues.update( delta, feet, this.clock.timeMin, this.sim, this.lights );
		this.hitches.time( 'relight', () => this.#relight( feet, delta ) );

		const worldPrompt = this.interactor.update( delta, {
			timeMin: this.clock.timeMin,
			playerPlaces,
			feet: { x: feet.x, y: feet.y, z: feet.z },
			eye: { x: this.controller.eye.x, y: this.controller.eye.y, z: this.controller.eye.z },
			look: { x: this.controller.look.x, y: this.controller.look.y, z: this.controller.look.z }
		} );
		for ( const result of this.questGameplay.drainMechanicResults() ) this.#questActionResult( result );
		if ( ! transitFrame ) transitFrame = this.transitGameplay.update( {
			daySeconds: this.clock.daySeconds,
			interactionBlocked: Boolean( worldPrompt || this.interactor.conversation )
		} );
		const prompt = playableTransitPrompt( worldPrompt, transitFrame );
		this.view.transit.ride( transitStatusLabel( transitFrame.status ) );
		if ( transitFrame.result?.ok && ( transitFrame.aboard || transitFrame.result.autoDisembarked ) ) {

			this.#transitQuestEvent( { action: 'update', result: transitFrame.result } );

		}
		if ( transitFrame.result?.autoDisembarked ) this.#persistTransitState();
		this.view.prompt.update( this.input.locked ? prompt : null );

		const interact = playablePress( this.input, this.pressedActions, 'interact', 'KeyE' );
		const secondary = playablePress( this.input, this.pressedActions, 'secondary-interact', 'KeyR' );
		if ( interact && ! playableModalOpen( this.view, this.interactor ) ) {

			const owner = playableInteractionOwner( this.interactor, transitFrame );
			if ( owner === 'conversation' ) this.#closeConversation();
			else if ( owner === 'world' ) this.#questActionResult( this.interactor.activate( this.clock ) );
			else this.#transitAction( this.transitGameplay.activate(), playerPlaces );

		}
		if ( secondary && ! playableModalOpen( this.view, this.interactor ) && ! transitFrame.aboard ) {

			this.#questActionResult( this.interactor.activate( this.clock, 'secondary-interact' ) );

		}

		// A panel or the chat owns the keyboard while it is up; the game's own
		// keys only fire on the street.
		const free = ! playableModalOpen( this.view, this.interactor );

		if ( free ) {

			for ( const [ code, panel ] of PANEL_KEYS ) if ( this.input.consume( code ) ) this.view.toggle( panel );
			if ( this.input.consume( 'KeyN' ) || ( this.input.consume( 'Escape' ) && this.input.locked ) ) this.input.exitLock();

		}

		this.view.setPaused( ! this.input.locked && free );
		this.#updateObjectiveRoute( delta );
		// The clock opens and closes places while the player stands still, so
		// the objective line is asked again on its own cadence.
		this.objectiveTimer += delta;
		if ( this.objectiveTimer >= OBJECTIVE_INTERVAL ) this.#refreshCurrentObjective();
		this.view.minimap.update( feet, this.controller.yaw );
		if ( this.view.panels.current === 'MAP' ) this.view.map.setPlayer( feet, this.controller.yaw );
		this.hitches.time( 'location HUD', () => {

			const district = this.locator.district( feet.x, feet.z );
			this.currentLocation = this.locator.location( feet.x, feet.z, this.standing?.parcelId ?? null );
			this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
			this.view.clock.update( this.clock.label, district );
			this.view.readout.update( feet, district, this.locator.parcel( feet.x, feet.z, this.standing?.parcelId ?? null ) );

		} );

		this.hitches.time( 'render', () => this.look.render() );
		this.input.endFrame();

	}

	/**
	 * One pass over everything that decides where light comes from this frame:
	 * which rooms hold a light slot, what colour the air around the player is,
	 * whether the probe needs rebaking, and which exposure the camera is on.
	 */
	/** Whether the feet have stayed within a hand's width for the last second. */
	#still( feet, delta ) {

		if ( ! this.rest ) this.rest = { at: feet.clone(), seconds: 0 };

		if ( this.rest.at.distanceTo( feet ) > STILL_RADIUS ) {

			this.rest.at.copy( feet );
			this.rest.seconds = 0;

		} else this.rest.seconds += delta;

		return this.rest.seconds >= STILL_SECONDS;

	}

	/**
	 * Typed chat is optional. It never substitutes for an explicit quest reply.
	 * The reply streams into one NPC line that shows with its first text; a
	 * reply that fails, goes quiet or is overtaken leaves no part of it behind.
	 * The request carries the place the person has led the player to and,
	 * for the player's own words, what the person may propose: agreeing in a
	 * whole reply to come along, they are held to the companion's rules and,
	 * agreed, set off as the chat closes.
	 * @param options.retry the line goes again without showing again
	 * @param options.arrival a leader's arrival: `text` is its unseen question,
	 *   nothing is proposed, and its own line stands in for a reply that fails
	 */
	async #say( text, { retry = false, arrival = null } = {} ) {
		const conversation = this.interactor?.conversation;
		if ( ! conversation?.instance || this.dialoguePending || ! text?.trim() ) return;
		const turn = this.#playerSays( retry || arrival ? null : text );
		const current = () => this.interactor.conversation === conversation && turn === this.dialogueTurn;
		const controller = this.dialogueAbort = new AbortController();
		this.dialoguePending = true;
		let quiet = 0;
		const listen = () => {
			clearTimeout( quiet );
			quiet = setTimeout( () => controller.abort( new Error( `no reply for ${REPLY_IDLE_MS / 1000} s` ) ), REPLY_IDLE_MS );
		};
		this.view.dialog.setSending( true );
		this.view.dialog.setStatus( 'Waiting for a reply… Your story choices remain available.' );
		this.animations.playerDialogueTurn( conversation );
		let reply = null, done = false, whole = null, offer = null;
		try {
			listen();
			const context = { signal: controller.signal, ...this.#talkContext( conversation, ! arrival ) };
			for await ( const event of this.talk.stream( conversation, text, this.clock.timeMin, this.quests.snapshot(), context ) ) {
				if ( ! current() ) return;
				listen();
				if ( event.type === 'delta' && reply ) reply.append( event.text );
				else if ( event.type === 'delta' ) {
					this.view.dialog.setStatus( '' );
					reply = this.#npcSays( conversation, event.text, { streaming: true } );
				} else if ( event.type === 'sentence' ) reply?.hear( event.text );
				else if ( event.type === 'offer' ) offer ??= event;
				else if ( event.type === 'done' ) whole = event.reply;
			}
			if ( ! current() ) return;
			if ( ! reply ) throw new Error( 'the reply ended without a word' );
			reply.finish();
			done = true;
			this.failedDialogueLine = null;
		} catch ( error ) {
			if ( ! current() ) return;
			console.warn( 'talk:', error.message );
			this.#silence();
			this.animations.completeDialogueTurn( conversation );
			const refused = error.status === 400;
			this.failedDialogueLine = refused || arrival ? null : text;
			if ( arrival ) {
				this.view.dialog.setStatus( '' );
				this.#npcSays( conversation, arrival.line );
			} else this.view.dialog.setStatus( refused ? REPLY_REFUSED : REPLY_FAILED, { error: true, retry: ! refused } );
		} finally {
			clearTimeout( quiet );
			if ( ! done ) reply?.discard();
			if ( turn === this.dialogueTurn ) {
				this.dialoguePending = false;
				this.dialogueAbort = null;
				this.view.dialog.setSending( false );
			}
		}
		if ( done && offer ) this.#takeOffer( conversation, offer, whole );
	}

	/** What the talk request adds for this person: the place they have led the player to and, when `proposing`, the companion offers they may make. */
	#talkContext( { npcId }, proposing ) {
		const offers = proposing ? this.companion.talkOffers( this.#offers( npcId ) ) : null;
		const guide = this.companion.guide( npcId );
		return { ...( offers ? { offers } : {} ), ...( guide ? { guide } : {} ) };
	}

	/**
	 * The person agreed in their reply to follow or to lead the way. The typed
	 * request is the player's consent, so an offer the rules allow is taken:
	 * the chat closes on the reply and they set off. Otherwise they say why not.
	 */
	#takeOffer( conversation, { kind, placeId }, reply ) {
		const result = this.companion.acceptFromTool( {
			npcId: conversation.npcId, kind, ...( placeId ? { placeId } : {} ), timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces
		} );
		if ( result.ok ) this.#sendAlong( conversation, reply );
		else this.#npcSays( conversation, result.line );
	}

	/** The player takes the turn and their line, if any, shows. Returns the new turn. */
	#playerSays( text ) {
		const turn = this.#interrupt();
		if ( text ) this.view.dialog.addMessage( { from: 'player', name: 'You', text } );
		return turn;
	}

	/**
	 * Whatever the person was saying lapses: a typed reply still arriving is
	 * given up and leaves no line, and unless `silence` is false the observer
	 * is silenced. Starts a new dialogue turn and returns it.
	 */
	#interrupt( { silence = true } = {} ) {
		if ( this.dialoguePending ) {
			this.dialogueAbort.abort();
			this.dialogueAbort = null;
			this.dialoguePending = false;
			this.view.dialog.setSending( false );
			this.view.dialog.setStatus( '' );
		}
		if ( silence ) this.#silence();
		return this.dialogueTurn = ( this.dialogueTurn ?? 0 ) + 1;
	}

	/** The observer forgets what it heard; with nothing heard there is nothing to silence. */
	#silence() {
		if ( ! this.lineHeard ) return;
		this.lineHeard = false;
		this.#observe( 'silenced' );
	}

	/**
	 * Tells the line observer, synchronously, when it listens for `event`. It
	 * follows the conversation and never steers it: what it throws or rejects
	 * with is logged, and quest state, saving and the reply go on.
	 */
	#observe( event, detail ) {
		const hear = this.lineObserver?.[ event ];
		if ( ! hear ) return;
		const log = ( error ) => console.error( `line observer ${event}:`, error );
		try {
			hear.call( this.lineObserver, detail )?.catch?.( log );
		} catch ( error ) {
			log( error );
		}
	}

	/**
	 * Every NPC line enters the chat here: it shows without its inline cues,
	 * the person takes the speaking turn and the line observer hears the raw
	 * text, cues and all. A whole line is heard at once. `{ streaming: true }`
	 * opens the line with its first text and returns it to grow: `append(text)`,
	 * `hear(sentence)` as each sentence completes, then `finish()`, or
	 * `discard()` for a reply that never completed.
	 */
	#npcSays( conversation, text, { streaming = false } = {} ) {
		const speaker = { from: 'npc', name: speakerOf( conversation ).name };
		const heard = ( line, words ) => {
			this.lineHeard = true;
			this.#observe( 'said', { conversation, line, text: words } );
		};
		this.animations.npcDialogueTurn( conversation );
		if ( ! streaming ) {
			heard( this.view.dialog.addMessage( { ...speaker, text: stripCues( text ) } ), text );
			return null;
		}
		const message = this.view.dialog.beginMessage( speaker );
		let spoken = '';
		const append = ( piece ) => message.update( stripCues( spoken += piece ) );
		append( text );
		return { append, hear: ( sentence ) => heard( message.line, sentence ), finish: message.finish, discard: message.discard };
	}

	/** What the player may ask of this person now, available or not: the companion's offers. */
	#offers( npcId ) {
		return this.companion.offers( { npcId, timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces } );
	}

	/** The chat's action row: every offer for a person with an identity, whose refusal they say in words. */
	#showActions( conversation ) {
		const offers = conversation.instance ? this.#offers( conversation.npcId ) : [];
		this.dialogueActions = new Map( offers.map( ( offer ) => [ offer.offerId, offer.label ] ) );
		this.view.dialog.setActions( offers.map( ( offer ) => ( { id: offer.offerId, label: offer.label } ) ) );
	}

	/**
	 * The player asks the person along, to lead the way or to go: the ask
	 * shows as the player's line and the person answers by the companion's
	 * rules. Agreed, the chat closes on their answer and they set off.
	 */
	#dialogueAction( id ) {
		const conversation = this.interactor?.conversation;
		const label = this.dialogueActions.get( id );
		if ( ! conversation?.npcId || ! label ) return;
		const result = this.companion.accept( { npcId: conversation.npcId, offerId: id, timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces } );
		this.#playerSays( label );
		this.#npcSays( conversation, result.line );
		if ( result.ok ) this.#sendAlong( conversation, result.line );
		else this.#showActions( conversation );
	}

	/** Whether this conversation's person agreed to come along and waits for it to close. */
	#comingAlong( conversation ) {
		return Boolean( conversation?.npcId && this.companion.accepted( conversation.npcId ) );
	}

	/** Ends the open conversation; a person who agreed to come along stays where they stand for the companion to take. */
	#closeConversation( reason = 'player-left' ) {
		const conversation = this.interactor?.conversation;
		if ( conversation ) this.interactor.close( this.clock, reason, { keep: this.#comingAlong( conversation ) } );
	}

	/** The chat closes on what the person said, which a toast keeps, and control returns to the player. */
	#sendAlong( conversation, line ) {
		this.#closeConversation();
		this.view.toast.show( { title: speakerOf( conversation ).name, text: stripCues( line ) } );
		this.input?.requestLock();
	}

	/**
	 * The companion's frame, right after the continuity follows the player
	 * (tick runs it): the arrival waits while the player has anything open,
	 * and what the companion reports shows: words on the way, a refusal, the
	 * arrival and a notice when it ends.
	 */
	updateCompanion( playerPosition, playerPlaces ) {
		const signals = this.hitches.time( 'companion', () => this.companion.update( {
			timeMin: this.clock.timeMin, playerPosition, playerPlaces, busy: playableModalOpen( this.view, this.interactor )
		} ) );
		for ( const signal of signals ) {
			if ( signal.kind === 'arrival' ) this.#arrival( signal );
			else if ( signal.kind === 'line' || signal.kind === 'refused' ) this.#companionSays( signal.npcId, signal.line );
			else if ( signal.kind === 'ended' && signal.notice ) this.view.toast.show( { title: 'Companion', text: signal.notice } );
		}
	}

	/**
	 * A leader has brought the player to its place: the conversation opens and
	 * the person talks about it. A conversation already open with them takes
	 * the place with its next turn; without a body to talk to, the person says
	 * their arrival line on the street.
	 */
	#arrival( signal ) {
		if ( this.interactor.conversation ) return;
		this.arriving = signal;
		const conversation = this.interactor.talkTo( signal.npcId, this.clock );
		this.arriving = null;
		if ( ! conversation ) this.#companionSays( signal.npcId, signal.line );
	}

	/**
	 * What the companion says outside a conversation: a toast under their name,
	 * heard by the line observer with no chat line. Nothing is said over a
	 * conversation the player is having.
	 */
	#companionSays( npcId, text ) {
		if ( this.interactor.conversation ) return;
		const npc = this.sim.getNPC( npcId );
		const name = this.questGameplay.characterName( npcId );
		const instance = name ? { ...npc, name } : npc;
		this.view.toast.show( { title: TalkClient.nameOf( instance ), text: stripCues( text ) } );
		this.lineHeard = true;
		this.#observe( 'said', { conversation: { npcId, instance }, line: null, text } );
	}

	#selectDialogue( { questId, stepId } ) {
		const conversation = this.interactor?.conversation;
		if ( ! conversation?.npcId ) return;
		const topics = this.quests.dialoguesFor( conversation.npcId, this.clock.timeMin );
		const dialogue = topics.find( topic => topic.questlineId === questId && topic.stepId === stepId );
		if ( ! dialogue ) {
			this.activeDialogue = null;
			this.view.dialog.setChoices( [] );
			this.view.dialog.setStatus( 'That conversation is no longer available. Check your journal.' );
			return;
		}
		const changed = this.activeDialogue?.questlineId !== questId || this.activeDialogue?.stepId !== stepId;
		this.activeDialogue = dialogue;
		this.view.dialog.setStory( { title: dialogue.title, objective: dialogue.objective } );
		this.view.dialog.setTopics( topics.map( topic => ( {
			key: topic.questlineId + '/' + topic.stepId, title: topic.title,
			value: { questId: topic.questlineId, stepId: topic.stepId }
		} ) ), questId + '/' + stepId );
		if ( changed ) {
			this.#interrupt();
			this.#npcSays( conversation, dialogue.opening );
		}
		const unavailable = ! dialogue.availability.available;
		this.view.dialog.setChoices( dialogue.choices.map( choice => ( {
			text: choice.text, disabled: unavailable,
			value: { questId, stepId, choiceId: choice.id }
		} ) ), changed );
		// A new topic has just taken the turn from any typed reply, so rendering
		// its replies ahead never competes with the dialogue model.
		if ( changed && ! unavailable ) this.#observe( 'upcoming', { conversation, texts: dialogue.choices.map( choice => choice.reply ) } );
		this.view.dialog.setStatus( unavailable ? QuestActions.unavailableMessage( dialogue.availability.reason ) : '' );
	}

	#chooseDialogue( { questId, stepId, choiceId, recap = false } ) {
		const conversation = this.interactor?.conversation;
		if ( recap && conversation?.npcId ) {

			const memory = this.quests.conversationRecap( conversation.npcId );
			if ( memory?.questId !== questId || memory.stepId !== stepId ) return;
			const question = choiceId === 'remember-agreement'
				? { text: 'Remind me what we agreed.', reply: memory.reply }
				: memory.questions.find( choice => choice.id === choiceId );
			if ( ! question ) return;
			this.#playerSays( question.text );
			this.#npcSays( conversation, question.reply );
			return;

		}
		if ( ! conversation?.npcId || this.activeDialogue?.questlineId !== questId || this.activeDialogue?.stepId !== stepId ) return;
		const choice = this.activeDialogue.choices.find( choice => choice.id === choiceId );
		if ( ! choice ) return;
		const result = this.quests.chooseDialogue( questId, stepId, conversation.npcId, choiceId, this.clock.timeMin );
		if ( ! result.accepted ) {
			const message = result.availability && ! result.availability.available
				? QuestActions.unavailableMessage( result.availability.reason )
				: 'That reply is no longer available. Check your journal and try the current topic.';
			this.view.dialog.setStatus( message, { error: true } );
			return;
		}
		// A story decision also settles a free-chat line that failed.
		this.failedDialogueLine = null;
		this.view.dialog.setStatus( '' );
		this.#playerSays( choice.text );
		this.#npcSays( conversation, result.reply );
		if ( ! result.change ) return;
		this.activeDialogue = null;
		this.followedQuestId = questId;
		this.followedStepId = null;
		this.view.dialog.setChoices( [] );
		this.#refreshQuestState();
		const ending = result.change.ending;
		const next = this.questGameplay.objective( this.clock.timeMin, questId );
		this.view.dialog.setStory( { title: result.change.definition.title, objective: ending ? 'Decision recorded' : 'Lead recorded', journal: ! ending } );
		const remaining = this.quests.dialoguesFor( conversation.npcId, this.clock.timeMin );
		this.view.dialog.setTopics( remaining.map( topic => ( {
			key: topic.questlineId + '/' + topic.stepId, title: topic.title,
			value: { questId: topic.questlineId, stepId: topic.stepId }
		} ) ) );
		this.view.dialog.setStatus( ending ? 'Decision recorded. End the conversation to see the outcome.'
			: next ? 'Journal updated: ' + next.text : 'Journal updated.' );
		if ( ending ) {
			this.pendingDialogueEnding = { title: ending.title, text: ending.epilogue, outcome: 'done' };
		}
		else this.view.toast.show( { title: result.change.definition.title, text: 'New lead added to your journal.' } );
		if ( this.persistence ) this.#saveCurrent().catch( error => {
			console.error( error );
			this.view.dialog.setStatus( 'Your choice was accepted, but saving failed. ' + error.message, { error: true } );
		} );
	}

	/** Stepping into a building's rooms is arriving there for the story; the street in between is not a place. */
	#arrive( parcelId ) {

		if ( parcelId === this.parcelStanding ) return;

		this.parcelStanding = parcelId;
		if ( ! parcelId ) return;
		const ids = this.questGameplay.places( this.clock.timeMin )
			.filter( ( place ) => place.kind === 'goto' && place.place?.kind === 'parcel' && place.place.id === parcelId )
			.map( ( place ) => place.questId );
		this.#routeQuestEvent( { kind: 'arrivedAt', parcelId }, ids );

	}

	/**
	 * One player event goes to one questline: the one the player is following
	 * when it wants the event, else the first that does, main story first. The
	 * same person plays a part in several stories, so a fan-out would finish
	 * jobs the player never took.
	 */
	#routeQuestEvent( event, questIds ) {

		const chosen = this.#chosenQuest( questIds );
		if ( ! chosen ) return false;
		const moved = this.quests.advanceFor( chosen, event, this.clock.timeMin );
		if ( moved.length === 0 ) return false;

		for ( const { definition, completed, ending } of moved ) {

			for ( const step of completed ) this.view.toast.show( { title: definition.title, text: step.narrative.description } );
			if ( ending ) this.view.summary.show( { title: ending.title, text: ending.epilogue, outcome: 'done' } );

		}

		this.#refreshQuestState();
		return true;

	}

	#chosenQuest( questIds ) {

		if ( questIds.includes( this.followedQuestId ) ) return this.followedQuestId;
		return questIds[ 0 ] ?? null;

	}

	/** The quest log's pick becomes the objective the HUD, the map and the route follow. */
	#followQuest( questId, stepId = null ) {

		this.followedQuestId = questId ?? null;
		this.followedStepId = stepId;
		this.#refreshCurrentObjective();
		this.#updateObjectiveRoute( 0, true );

	}

	#waitForQuest( questId, stepId ) {

		if ( this.interactor?.conversation || this.transitGameplay?.aboard || this.npcContinuity?.companion ) {
			this.view.toast.show( { title: 'Cannot wait yet', text: 'Finish the conversation, the ride or the walk with your company first.' } );
			return;
		}
		const step = this.quests.view( this.clock.timeMin ).find( quest => quest.id === questId )?.steps.find( step => step.stepId === stepId );
		if ( step?.availability.reason !== 'outside_window' || ! step.wait || step.wait.timeMin <= this.clock.timeMin ) return;
		this.clock.seconds = step.wait.timeMin * 60;
		this.followedQuestId = questId;
		this.followedStepId = stepId;
		if ( this.crowd ) this.crowd.timer = 10;
		this.#refreshQuestState();
		this.view.toast.show( { title: 'Waited until ' + step.wait.label, text: 'The world clock has advanced. Your quest progress is unchanged.' } );
		if ( this.persistence ) this.#saveCurrent().catch( error => {
			console.error( error );
			this.view.toast.show( { title: 'Save failed', text: error.message } );
		} );

	}

	/** A QuestActions result updates every player-facing and persisted projection of that runtime state. */
	#questActionResult( result ) {

		if ( ! result ) return;
		if ( ! result.ok ) {

			this.view.toast.show( { title: 'Objective', text: result.message } );
			return;

		}

		if ( result.readText ) this.view.toast.show( { title: result.message, text: result.readText } );

		for ( const completed of result.completed ) {

			for ( const text of completed.presentation.steps ) {

				this.view.toast.show( { title: completed.presentation.title, text } );

			}
			const ending = completed.presentation.ending;
			if ( ending ) this.view.summary.show( ending );

		}

		if ( ! result.progressed ) return;
		this.#refreshQuestState();
		if ( this.persistence ) this.#saveCurrent().catch( ( error ) => {

			console.error( error );
			this.view.toast.show( { title: 'Save failed', text: error.message } );

		} );

	}

	#transitAction( action, playerPlaces = null ) {

		if ( ! action ) return;
		if ( action.action === 'choose-destination' ) {

			this.view.transit.choose( action.destinations.map( destination => ( {
				id: destination.destinationId, label: `${destination.stationName} · ${destination.lineId}`, value: destination
			} ) ), 'destination' );
			this.input.exitLock();
			return;

		}
		if ( action.action === 'choose' ) {

			this.view.transit.choose( action.services.map( ( service ) => ( {
				id: `${service.tripId}:${service.stopIndex}`,
				label: transitServiceLabel( service ),
				value: service
			} ) ) );
			this.input.exitLock();
			return;

		}

		if ( ! action.result.ok ) {

			this.view.toast.show( { title: 'Transit', text: transitErrorMessage( action.result.error ) } );
			return;

		}

		this.view.transit.close();
		if ( action.action !== 'station-travel' ) this.#transitQuestEvent( action, playerPlaces );
		this.#persistTransitState();

	}

	#persistTransitState() {

		if ( ! this.persistence ) return;
		this.#saveCurrent().catch( ( error ) => {

			console.error( error );
			this.view.toast.show( { title: 'Save failed', text: error.message } );

		} );

	}

	/** Turns one measured vehicle contact into the matching full-body rig. */
	#ragdoll( impact ) {

		let person = this.crowd.member( impact.personId );
		if ( ! person ) return;
		if ( this.interactor?.conversation?.person === person ) this.#closeConversation( 'physics' );
		person = this.crowd.beginRagdoll( impact.personId );
		if ( ! person ) return;
		this.animations.physicsInterrupt( person );
		this.hero.fall( person, this.physics, { point: impact.point, impulse: impact.impulse } )
			.then( ( accepted ) => {

				if ( accepted ) {

					const result = this.questGameplay.fatalImpact( impact, person.npcId, this.clock.timeMin );
					if ( result ) this.#questActionResult( result );
					return;

				}
				this.crowd.cancelRagdoll( impact.personId );
				this.animations.physicsResume( person );
				this.impactWorld.release( impact.personId );

			} )
			.catch( ( error ) => {

				console.warn( 'ragdoll:', error.message );
				this.crowd.cancelRagdoll( impact.personId );
				this.animations.physicsResume( person );
				this.impactWorld.release( impact.personId );

			} );

	}

	#selectTransit( service ) {

		const feet = this.body.feet;
		const places = questPlayerPlaces( this.locator, feet, this.standing?.parcelId ?? null );
		const action = service?.destinationId ? this.transitGameplay?.selectDestination( service ) : this.transitGameplay?.board( service );
		this.#transitAction( action, places );
		this.input?.requestLock();

	}

	#transitQuestEvent( action, playerPlaces = null ) {

		if ( ! this.questGameplay || ! this.body ) return;
		const feet = this.body.feet;
		const places = playerPlaces ?? questPlayerPlaces( this.locator, feet, this.standing?.parcelId ?? null );
		const result = this.questGameplay.transitEvent( action, {
			timeMin: this.clock.timeMin,
			playerPlaces: places,
			position: [ feet.x, feet.y, feet.z ]
		} );
		if ( result ) this.#questActionResult( result );

	}

	#cancelTransitSelection() {

		this.transitGameplay?.cancelSelection();
		this.input?.requestLock();

	}

	/** A quest has moved: the scenery, journal, objective, inventory and route follow at once. */
	#refreshQuestState() {

		this.scenery.refresh( this.clock.timeMin );
		this.view.quests.setQuests( this.quests.view( this.clock.timeMin ) );
		this.#refreshCurrentObjective();
		this.#refreshInventory();
		this.#updateObjectiveRoute( 0, true );

	}

	/** The objective's parcel is marked on the maps and named on the HUD, with the walk there while a route stands. */
	#refreshCurrentObjective() {

		this.objectiveTimer = 0;
		if ( this.view.panels.current === 'QUESTS' ) {

			const quests = this.quests.view( this.clock.timeMin ), signature = JSON.stringify( quests );
			if ( signature !== this.journalSignature ) {
				this.journalSignature = signature;
				this.view.quests.setQuests( quests );
			}

		}
		const objective = this.questGameplay.objective( this.clock.timeMin, this.followedQuestId, this.followedStepId );
		if ( objective?.stepId !== this.followedStepId ) this.followedStepId = null;
		this.view.quests.setTrackedQuest( objective?.questId ?? null, this.followedStepId );
		if ( this.activeDialogue && this.interactor?.conversation ) {

			const current = this.quests.dialoguesFor( this.interactor.conversation.npcId, this.clock.timeMin )
				.find( topic => topic.questlineId === this.activeDialogue.questlineId && topic.stepId === this.activeDialogue.stepId );
			if ( ! current || JSON.stringify( current.availability ) !== JSON.stringify( this.activeDialogue.availability ) ) {
				this.#selectDialogue( { questId: this.activeDialogue.questlineId, stepId: this.activeDialogue.stepId } );
			}

		}
		const parcelId = objective?.place?.kind === 'parcel' ? objective.place.id : null;

		if ( this.venues.setObjective( parcelId ? { parcelId, name: objective.venue } : null ) ) {

			this.view.minimap.setVenues( this.venues.marks );
			this.view.map.setVenues( this.venues.marks );

		}

		this.view.setObjective( currentObjectiveView( objective, this.quests, {
			venues: this.venues, route: this.objectiveGuide?.route ?? null, timeMin: this.clock.timeMin,
			local: localObjectivePlace( objective, {
				locator: this.locator, crowd: this.crowd, session: this.quests,
				feet: this.body?.feet, roomParcelId: this.standing?.parcelId ?? null
			} )
		} ) );

	}

	#updateObjectiveRoute( deltaSeconds, force = false ) {

		if ( ! this.objectiveGuide || ! this.questGameplay || ! this.body ) return;
		const feet = this.body.feet;
		const objective = this.questGameplay.objective( this.clock.timeMin, this.followedQuestId, this.followedStepId );
		const local = localObjectivePlace( objective, {
			locator: this.locator, crowd: this.crowd, session: this.quests,
			feet, roomParcelId: this.standing?.parcelId ?? null
		} );
		// Once inside the actual venue, the marked person is the destination;
		// an outdoor route back to the doorstep sends the player away again.
		const destination = local ? null : objective?.guidance?.destination ?? null;
		let route = null;

		try {

			const result = this.objectiveGuide.update( {
				deltaSeconds,
				from: [ feet.x, feet.y, feet.z ],
				destination,
				...( force ? { force: true } : {} )
			} );
			if ( ! result.changed ) return;
			route = result.route ? {
				path: result.route.path3.map( ( point ) => [ point[ 0 ], point[ 2 ] ] ),
				label: objective.text
			} : null;

		} catch ( error ) {

			console.warn( 'objective route:', error.message );

		}

		this.view.minimap.setRoute( route );
		this.view.map.setRoute( route );
		this.#refreshCurrentObjective();

	}

	/** Saves a catalog game before returning to the launcher; direct previews stay session-only. */
	async #leave() {

		this.input?.exitLock();
		if ( ! this.persistence || ! this.body || ! this.controller || ! this.quests ) {

			this.navigate( '/' );
			return;

		}

		try {

			await this.#saveCurrent();
			this.navigate( '/' );

		} catch ( error ) {

			console.error( error );
			this.view.fail( `could not save: ${error.message}` );

		}

	}

	/**
	 * Saves the game as it stands. What people remember of talking with the
	 * player is read from the dialogue server first; when it cannot be read,
	 * or the server cannot take the loaded save's memory yet, the save keeps
	 * the memory it holds.
	 */
	async #saveCurrent() {

		const dialogueMemory = await this.#dialogueMemory();
		const feet = this.body.feet;
		this.currentLocation = this.locator.location( feet.x, feet.z, this.standing?.parcelId ?? null );
		this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
		const progress = mergeProgress( this.persistence.game, this.quests.persistenceView( this.clock.timeMin ) );

		return this.persistence.save( {
			position: { x: feet.x, y: feet.y, z: feet.z },
			heading: this.controller.yaw,
			inventory: this.#inventory(),
			quests: progress.quests,
			sideJobs: progress.sideJobs,
			currentLocation: this.currentLocation,
			discoveredLocations: uniqueLocations( [ ...this.discoveredLocations.values() ] ),
			transitJourney: this.transitGameplay.state,
			questTransit: this.questGameplay.serializeTransit(),
			investigations: this.investigations.serialize(),
			scenery: this.scenery.serialize(),
			npcState: {
				timeMin: this.clock.timeMin,
				simulation: this.sim.serialize(),
				continuity: this.npcContinuity.serialize(),
				questEscort: this.questGameplay.serializeEscort(),
				companion: this.companion.serialize()
			},
			...( dialogueMemory ? { dialogueMemory } : {} ),
			elapsedSeconds: Math.max( 0, ( performance.now() - this.playStartedAt ) / 1000 )
		} );

	}

	/** What people remember for a save, or null while the server cannot give it. */
	#dialogueMemory() {

		return this.talk.memory().catch( ( error ) => {

			console.warn( 'dialogue memory not saved:', error.message );
			return null;

		} );

	}

	/** Explicit quest control event. It never derives following from dialogue or quest step kind. */
	questNpcControl( event ) {

		const result = this.questGameplay.control( {
			...event,
			timeMin: this.clock.timeMin,
			playerPosition: {
				x: this.body.feet.x,
				y: this.body.feet.y,
				z: this.body.feet.z
			}
		} );
		if ( result.ok && this.persistence ) this.#saveCurrent().catch( ( error ) => {

			console.error( error );
			this.view.toast.show( { title: 'Save failed', text: error.message } );

		} );
		return result;

	}

	#inventory() {

		return mergeInventory( this.savedInventory, this.quests.inventoryView(), this.questItemIds );

	}

	#refreshInventory() {

		this.view.inventory.setItems( this.#inventory().map( ( item ) => ( {
			id: item.id,
			name: item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name,
			kind: item.state.kind ?? '',
			description: item.state.description ?? '',
			place: item.state.place ?? 'quest inventory'
		} ) ) );

	}

	#setting( { key, value } ) {

		if ( key === 'fog' ) this.fog.density.value = value;
		else if ( key === 'exposure' ) this.exposure.base = value;
		else if ( key === 'crowd' ) this.crowd.capacity = value;
		else if ( key === 'voice' ) this.voice?.setEnabled( value === 'on' );
		else if ( key === 'voiceVolume' ) this.voice?.setVolume( value );
		else if ( key === 'quality' ) {

			const query = new URLSearchParams( window.location.search );
			query.set( 'quality', value );
			window.location.search = query.toString();

		}

	}

	#relight( feet, delta ) {

		const visible = this.roomView.update( feet, delta );
		const room = this.#inside( visible, feet );

		this.standing = room;
		this.#arrive( room ? this.locator.refs( feet.x, feet.z, room.parcelId ).find( ( place ) => place.kind === 'parcel' )?.id ?? null : null );

		// Crossing the threshold is what changes everything around the camera;
		// walking from one room to the next does not, and rebaking on that
		// would put six cube renders in every other frame.
		const crossed = Boolean( room ) !== this.indoors;
		this.indoors = Boolean( room );

		this.rooms.update( visible, feet, delta );
		this.fog.update( room ? roomAir( room ) : this.lights.airColor( this.camera.position ), Boolean( room ), delta );
		this.probe?.update( feet, this.#still( feet, delta ) );
		this.exposure.enter( room ? 'interior' : 'exterior' );
		this.exposure.update( delta );

	}

	/**
	 * The published room the player is standing in, tested against its own
	 * outline: from the pavement a shop's floor can be a couple of metres away
	 * and the eye is still on the street. The room held last frame is tried
	 * first, because it is nearly always still the answer, and because a test
	 * that flickers would rebake the environment probe every other frame.
	 */
	#inside( visible, feet ) {

		if ( this.standing?.holds( feet ) && this.standing.visible ) return this.standing;

		for ( const room of visible ) {

			if ( room.holds( feet ) ) return room;

		}

		return null;

	}

	/**
	 * The air around every street fixture, as one merged glow mesh. The air
	 * inside a building belongs to the floor band it fills, so the stream hangs
	 * that one as it loads.
	 */
	#hangHaze( fixtures ) {

		if ( ! this.tier.haze ) return;

		const street = Haze.build( fixtures, OUTDOOR_HAZE );

		if ( street ) this.scene.add( street );

	}

	#measure( frameMs ) {

		const info = this.renderer.info;
		this.stats.frameMs = this.stats.frameMs * 0.9 + frameMs * 0.1;
		this.stats.drawCalls = info.render.drawCalls;
		this.stats.triangles = info.render.triangles || this.baseTriangles;
		// GPU time is a WebGPU query; on WebGL2 the queries stay closed and the HUD says so.
		this.stats.gpuMs = this.stats.backend === 'webgpu' ? ( info.render.timestamp ?? 0 ) + ( info.compute.timestamp ?? 0 ) : null;
		this.stats.crowd = this.crowd.count;
		this.stats.cars = this.traffic.count;
		this.stats.interiors = this.stream.liveInteriors;
		this.stats.bands = this.colliders.liveBands;
		this.stats.lights = this.lights.count;
		this.stats.tier = this.tier.name;
		this.stats.width = this.renderer.domElement.width;
		this.stats.height = this.renderer.domElement.height;
		this.stats.hitches = this.hitches.count;
		this.stats.worstMs = this.hitches.worst;
		this.#materials();
		this.view.stats.update( this.stats );

		if ( this.stats.backend !== 'webgpu' ) return;
		this.renderer.resolveTimestampsAsync?.( 'render' ).catch( () => {} );
		this.renderer.resolveTimestampsAsync?.( 'compute' ).catch( () => {} );

	}

	/**
	 * The resolution count, and the keys behind it the first time one fails.
	 * A key the database cannot answer renders magenta and is named here; it
	 * never takes the load down, because a world can name a brand whose assets
	 * are not on this machine (../materials/CONTRACT.md).
	 *
	 * A variant name the entry does not publish is quieter than that: the
	 * surface draws the canonical look and nothing about the frame says so, so
	 * it is named here too, for the release that renamed it.
	 */
	#materials() {

		const { resolved, unresolved, unknownVariants } = this.resolver.counts;

		this.stats.materials = resolved;

		if ( unresolved > this.stats.unresolved ) {

			this.stats.unresolved = unresolved;
			console.warn( `unresolved material keys: ${this.resolver.report().unresolved.join( ', ' )}` );

		}

		if ( unknownVariants > this.stats.unknownVariants ) {

			this.stats.unknownVariants = unknownVariants;
			console.warn( `material variants the catalog does not publish: ${this.resolver.report().unknownVariants.join( ', ' )}` );

		}

	}

	/**
	 * Puts the camera on one of the tuning poses and holds it there. The
	 * acceptance bands are only meaningful re-shot from the same place, so this
	 * is what the measuring harness drives.
	 */
	bookmark( name ) {

		const pose = this.bookmarks.pose( name );

		if ( ! pose ) return false;

		this.controller.yaw = pose.yaw;
		this.controller.pitch = pose.pitch;

		return this.placePlayer( pose.point );

	}

	/**
	 * Stands the player's feet at `feet` and, given a `target` point, aims the
	 * crosshair at it. False while a ride carries the body.
	 */
	placePlayer( feet, target = null ) {

		if ( ! this.body.teleport( feet ) ) return false;

		if ( target ) {

			const eye = this.body.eye;
			this.controller.lookAt( target );
			this.controller.pitch = Math.atan2( target.y - eye.y, Math.hypot( target.x - eye.x, target.z - eye.z ) );

		}
		this.controller.update( 0 );
		// The probe rebakes itself on the next step, once the rooms around the
		// camera have taken their light slots and are worth reflecting.
		this.indoors = undefined;

		return true;

	}

	/** Presses E (`interact`) or R (`secondary-interact`) on the next tick, through the key's own owners. */
	pressAction( action = 'interact' ) {

		if ( action !== 'interact' && action !== 'secondary-interact' ) throw new Error( `unknown action: ${action}` );
		this.pressedActions.add( action );

	}

	/** Sends one typed line in the open conversation, as the chat box does; settles once its reply or failure shows. */
	sayLine( text ) {

		return this.#say( text );

	}

	#resize() {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );

	}

	static configFromUrl() {

		return GameConfig.fromUrl();

	}

}

/** Keeps streamed floor compilation off the first frame that can draw it. */
export function prepareInteriorStreaming( stream, renderer, scene, camera, mrt, renderTarget = null ) {

	const warmup = new Warmup( renderer, scene, camera, mrt, renderTarget );
	stream.warmup = warmup;

	return warmup;

}

/**
 * The light filling a room's air: its own fixtures' flux spread over its own
 * surfaces, which is the mean illuminance in it, and their colour. Same shape
 * as the street's, so the fog reads one or the other without knowing which.
 */
function roomAir( room ) {

	return { color: room.color, lux: room.flux / Math.max( 1, room.area ) };

}

/**
 * How high each building this world stands reaches, for the things hung
 * between them. A world with a shell catalog publishes every parcel's massing
 * there, whether or not that parcel is loaded right now; one without a catalog
 * knows only the buildings it has read.
 */
function roofElevations( shellCatalog, buildings ) {

	return new Map( shellCatalog
		? shellCatalog.buildings.map( ( record ) => [ record.id, record.roof.elevation ] )
		: [ ...buildings ].map( ( [ id, source ] ) => [ id, source.blueprint.bounds.height ] ) );

}

/** Where an objective route ends: on the doorstep of the parcel it points at. */
function routePlaces( doors ) {

	return doors.map( ( door ) => ( { parcelId: door.parcelId, door: door.outside.toArray() } ) );

}

/** Where a building's on-duty staff stand: just inside its entrance. */
function placesOf( doors, buildings ) {

	return new Map( doors.map( ( door ) => [ door.parcelId, {
		inside: door.inside.clone(),
		heading: Math.atan2( door.normal.x, door.normal.z ),
		anchors: groundAnchors( buildings.get( door.parcelId )?.npc, door.inside.y, buildings.get( door.parcelId )?.interior )
	} ] ) );

}

/**
 * The quest scenery a game stands: its scene specs over the quest session,
 * with the save's scene states and the investigations as the overlay whose
 * scenes it stages. The other options go to SceneryDirector as they are.
 */
export function questScenery( { game, investigations, ...options } ) {

	return SceneryDirector.create( { ...options, overlay: investigations, saved: game?.scenery ?? [] } );

}

/**
 * Staged scenes as places a companion may lead to: each scene's parcel, named
 * as the companion names it, with what stands there. Scenes that share a
 * parcel are one place with all their notes.
 * @param staged the director's `stagedPlaces()`
 * @param places the companion's places, for `name(place)`
 */
export function companionScenes( staged, places ) {

	const scenes = new Map();
	for ( const { place: { parcelId }, notes } of staged ) {

		const known = scenes.get( parcelId );
		if ( known ) {

			known.notes.push( ...notes );
			continue;

		}
		const place = { kind: 'parcel', id: parcelId };
		const name = places.name( place );
		if ( name ) scenes.set( parcelId, { place, name, relation: 'scene', notes: [ ...notes ] } );

	}
	return [ ...scenes.values() ];

}

/** Every scheduled parcel position in the controller's validated JSON shape. */
export function npcContinuityPlaces( atlas, doors, buildings, transitRoutes = [] ) {

	const doorByParcel = new Map( doors.map( ( door ) => [ door.parcelId, door ] ) );
	const parcels = atlas.parcels.map( ( parcel ) => {

		const door = doorByParcel.get( parcel.id );
		const position = door
			? door.inside.toArray()
			: [ parcel.access.point[ 0 ], SIDEWALK_HEIGHT, parcel.access.point[ 1 ] ];
		const anchors = door
			? Object.values( groundAnchors( buildings.get( parcel.id )?.npc, door.inside.y, buildings.get( parcel.id )?.interior ) )
				.flat()
				.map( ( anchor ) => ( { id: anchor.id, position: anchor.position.toArray(), heading: anchor.heading } ) )
			: [];
		return {
			kind: 'parcel', id: parcel.id, position,
			heading: door ? Math.atan2( door.normal.x, door.normal.z ) : 0,
			anchors
		};

	} );
	const routeLevels = new Map();
	for ( const route of transitRoutes ) for ( const stop of route.stops ) {

		if ( ! routeLevels.has( stop.stopId ) ) routeLevels.set( stop.stopId, stop.y );

	}
	const stops = new Map();
	for ( const stop of atlas.transit?.busStops ?? [] ) stops.set( stop.id, {
		kind: 'stop', id: stop.id,
		position: [ stop.position[ 0 ], routeLevels.get( stop.id ) ?? 0, stop.position[ 1 ] ]
	} );
	for ( const station of [
		...( atlas.transit?.trainStations ?? [] ), ...( atlas.transit?.subwayStations ?? [] )
	] ) stops.set( station.id, {
		kind: 'stop', id: station.id,
		position: [ station.position[ 0 ], station.level, station.position[ 1 ] ]
	} );
	return [ ...parcels, ...stops.values() ];

}

/**
 * Start on a sidewalk in the middle of things, looking down the street rather
 * than at a wall: the walk node nearest the built centre, aimed at the corner
 * furthest from it.
 */
export function pickSpawn( networks, atlas, buildings ) {

	const centre = atlas.parcels.reduce(
		( acc, p ) => [ acc[ 0 ] + p.access.point[ 0 ] / atlas.parcels.length, acc[ 1 ] + p.access.point[ 1 ] / atlas.parcels.length ],
		[ 0, 0 ]
	);
	// A partial/review world retains Atlas land for its empty lots. Start at an
	// actual open building, using its authored door after any kit transform,
	// rather than letting those unbuilt parcels choose a deserted street.
	const entrances = [ ...( buildings?.values() ?? [] ) ]
		.filter( building => building.hasInterior )
		.flatMap( building => doorFrames( building.blueprint ).filter( door => door.floor === 0 && door.role === 'main' ) )
		.sort( ( a, b ) => Math.hypot( a.center.x - centre[ 0 ], a.center.z - centre[ 1 ] )
			- Math.hypot( b.center.x - centre[ 0 ], b.center.z - centre[ 1 ] ) || a.parcelId.localeCompare( b.parcelId ) );
	if ( entrances.length ) {

		const door = entrances[ 0 ];
		// Start where the entrance and its facade are visible, rather than
		// filling the first frame with the closed door at arm's length.
		const outward = door.outside.clone().sub( door.center ).normalize();
		const approach = networks.walk.nodes.filter( node => {

			if ( ! [ 'sidewalk', 'corner' ].includes( node.kind ) ) return false;
			const x = node.x - door.center.x, z = node.z - door.center.z;
			const distance = Math.hypot( x, z );
			return distance >= 4 && distance <= 24 && x * outward.x + z * outward.z > 1;

		} ).sort( ( a, b ) => Math.hypot( a.x - door.center.x, a.z - door.center.z )
			- Math.hypot( b.x - door.center.x, b.z - door.center.z ) )[ 0 ];
		const point = approach ? new THREE.Vector3( approach.x, approach.y, approach.z )
			: door.outside.clone().addScaledVector( outward, 6 );
		point.y = Math.max( point.y, SIDEWALK_HEIGHT ) + 0.05;
		return { point, lookAt: door.center.clone() };

	}

	const candidates = networks.walk.nodes.filter( ( n ) => n.kind === 'sidewalk' || n.kind === 'corner' );
	const pool = candidates.length ? candidates : networks.walk.nodes;

	let best = pool[ 0 ];
	let bestDistance = Infinity;

	for ( const node of pool ) {

		const distance = Math.hypot( node.x - centre[ 0 ], node.z - centre[ 1 ] );

		if ( distance < bestDistance ) {

			bestDistance = distance;
			best = node;

		}

	}

	let target = best;
	let far = 0;

	for ( const node of pool ) {

		const distance = Math.hypot( node.x - best.x, node.z - best.z );

		if ( distance > far ) {

			far = distance;
			target = node;

		}

	}

	return {
		point: new THREE.Vector3( best.x, best.y + SIDEWALK_HEIGHT + 0.05, best.z ),
		lookAt: new THREE.Vector3( target.x, target.y + SIDEWALK_HEIGHT, target.z )
	};

}

/** A persisted position is a foot point, in the same coordinates PlayerBody expects. */
export function savedSpawn( game ) {

	const { position, heading } = game.player;
	return { point: new THREE.Vector3( position.x, position.y, position.z ), heading };

}

/** Restores the world clock used by a valid active timetable journey. */
export function transitStartHour( journey, fallback ) {

	const state = journey?.state;
	if ( ! journey?.valid || state?.status !== 'aboard' || state.clock.lastDaySeconds === null ) return fallback;
	return ( state.clock.dayOffset + state.clock.lastDaySeconds ) / 3600;

}

/** Exact quest place identities at the player's current world point. */
export function questPlayerPlaces( locator, feet, roomParcelId = null ) {

	const places = locator.refs( feet.x, feet.z, roomParcelId );
	const transit = questTransitPlace( locator.transitPlace( feet.x, feet.y, feet.z ) );
	return transit && ! places.some( ( place ) => place.kind === transit.kind && place.id === transit.id )
		? [ ...places, transit ]
		: places;

}

/** Rebuilds the exact quest ride input from a validated active journey. */
export function restoredTransitQuest( journey, routes, timeMin, position ) {

	const state = journey?.state;
	if ( ! journey?.valid || state?.status !== 'aboard' ) return null;
	const route = routes.find( ( candidate ) => candidate.id === state.routeId );
	const stop = route?.stops?.[ state.boardedStopIndex ];
	if ( ! stop ) return null;
	return {
		timeMin,
		origin: { kind: route.kind === 'bus' ? 'stop' : 'station', id: stop.stopId },
		position: { x: position.x, y: position.y, z: position.z },
		tripId: state.tripId,
		routeId: state.routeId
	};

}

function questTransitPlace( place ) {

	if ( ! place ) return null;
	return { kind: place.kind === 'bus-stop' ? 'stop' : 'station', id: place.id };

}

/** Existing aimed world interactions win E while waiting; an active ride owns E. */
export function playableTransitPrompt( worldPrompt, transitFrame ) {

	if ( transitFrame?.aboard ) return transitFrame.prompt ?? null;
	return worldPrompt ?? transitFrame?.prompt ?? null;

}

/**
 * Whether `action` fires this frame: its key `code` pressed under pointer
 * capture, or pressAction queued it since the last tick. Takes both either way.
 */
export function playablePress( input, queued, action, code ) {

	const key = input.consume( code ) && input.locked;
	return queued.delete( action ) || key;

}

export function playableInteractionOwner( interactor, transitFrame ) {

	if ( interactor?.conversation ) return 'conversation';
	if ( ! transitFrame?.aboard && interactor?.target ) return 'world';
	return 'transit';

}

/**
 * Current quest projection for the persistent objective widget.
 * @param active the active objective, or null
 * @param venues what the city calls each parcel
 * @param route the objective route standing now, or null
 */
export function currentObjectiveView( active, session, { venues = null, route = null, timeMin = 0, local = null } = {} ) {

	if ( active ) return { title: active.title, objective: active.text,
		state: active.availability?.available === false ? 'unavailable' : 'active',
		...( active.availability?.available === false ? { note: QuestActions.unavailableMessage( active.availability.reason, active.window ) } : {} ),
		place: objectivePlace( active, venues, route, local ) };
	const completed = [ ...( session?.view( timeMin ) ?? [] ) ].reverse().find( ( quest ) => quest.state === 'done' );
	if ( ! completed ) return null;
	const lastStep = [ ...completed.steps ].reverse().find( ( step ) => step.done );
	return {
		title: completed.title,
		objective: lastStep?.text ?? completed.text,
		state: 'done',
		place: null
	};

}

/**
 * The venue line under the objective: the questline's name for the place, else
 * the city's, the walk there, and the hour it opens while it is closed.
 */
function objectivePlace( active, venues, route, local ) {

	if ( active.place?.kind !== 'parcel' ) return null;
	const venue = active.venue ?? venues?.nameOf( active.place.id ) ?? null;
	const name = local ? [ venue, local.label ].filter( Boolean ).join( ' · ' ) : venue;
	if ( ! name ) return null;
	const routed = route?.destination.kind === 'parcel' && route.destination.id === active.place.id;
	const closed = active.availability.reason === 'outside_window' && active.window;
	return {
		name,
		...( local ? { distanceMeters: local.distanceMeters } : routed ? { distanceMeters: Math.round( route.distanceMeters ) } : {} ),
		...( closed ? { window: { label: active.window.label, startMin: active.window.startMin, endMin: active.window.endMin } } : {} )
	};

}

/** Ground occupation comes from the building that was published, including
 * merged kit buildings, rather than the older Atlas subdivision beneath it.
 */
export function occupiedBuildingFootprints( shellCatalog, buildings = new Map() ) {

	if ( shellCatalog ) return shellCatalog.buildings.flatMap( ( building ) => {

		const ground = building.bands.find( ( band ) => band.bottom <= 0 && band.top > 0 );
		return ground ? [ { parcelId: building.id, outline: ground.outline, ...( ground.holes ? { holes: ground.holes } : {} ) } ] : [];

	} );
	return [ ...buildings ].flatMap( ( [ parcelId, source ] ) => {

		const ground = source.blueprint?.floors?.find( ( floor ) => floor.index === 0 );
		return ground ? [ { parcelId, outline: ground.outline, ...( ground.holes ? { holes: ground.holes } : {} ) } ] : [];

	} );

}

/** Live in-venue guidance follows the actual cast body, never a street route. */
export function localObjectivePlace( active, { locator, crowd, session, feet, roomParcelId = null } ) {

	if ( active?.place?.kind !== 'parcel' || ! feet || ! locator ) return null;
	const parcelId = roomParcelId
		? locator.refs( feet.x, feet.z, roomParcelId ).find( ( place ) => place.kind === 'parcel' )?.id
		: locator.occupiedParcelId?.( feet.x, feet.z );
	if ( parcelId !== active.place.id ) return null;
	const members = ( active.actorIds ?? [] ).map( ( npcId ) => crowd?.memberForNpc( npcId ) )
		.filter( ( member ) => member && ! member.fallen && ! member.retiring && member.parcelId === parcelId )
		.sort( ( left, right ) => feet.distanceToSquared( left.position ) - feet.distanceToSquared( right.position ) );
	const member = members[ 0 ];
	if ( ! member ) return { label: 'Inside', distanceMeters: 0 };
	const name = session?.characterName( member.npcId ) ?? member.instance?.name;
	const person = name ? `${name.given} ${name.family}` : 'Marked person';
	const level = Math.abs( member.position.y ) < 1 ? 'Ground floor'
		: member.position.y - feet.y > 2 ? 'Upstairs' : feet.y - member.position.y > 2 ? 'Downstairs' : 'On this floor';
	return { label: `Inside · ${person} · ${level}`, distanceMeters: Math.round( feet.distanceTo( member.position ) ) };

}

/** How the chat names the person in a conversation; a passer-by has no identity. */
function speakerOf( { instance } ) {

	if ( ! instance ) return { name: 'Someone passing by', role: '' };
	return { name: TalkClient.nameOf( instance ), role: ( instance.type ?? '' ).replace( /^quest[ _]/i, '' ).replace( /_/g, ' ' ) };

}

/** A modal owns both pointer capture and game actions until it closes. */
export function playableModalOpen( view, interactor ) {

	return Boolean( interactor?.conversation || view.panels.current || view.transit.open || ! view.summary.element.hidden );

}
