import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { MaterialResolver } from '../building/MaterialResolver.js';
import { TextureSource } from '../building/TextureSource.js';
import { PbrMaterialFactory } from '../building/PbrMaterialFactory.js';
import { DETAIL_BINDING, SurfaceDetail } from './surface-detail/SurfaceDetail.js';
import { wearExterior } from './surface-detail/Weathering.js';
import { TalkClient } from './talk/TalkClient.js';
import { RecentEvents } from './talk/RecentEvents.js';
import { NpcVoice } from './voice/NpcVoice.js';
import { dispositionOf, peopleKnown, StreetNames, stripCues } from '../../../quests/dist/runtime.js';
import { describeLook } from './agents/avatar/Describe.js';
import { castNames, homesOf } from './sim/Homes.js';
import { buildingFacts } from './talk/BuildingFacts.js';
import { recipeFor } from './agents/Appearance.js';
import { findPath } from '../../../interior/dist/nav.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestGameplay, questGameplayWorld } from './quests/QuestGameplay.js';
import { QuestActions } from './quests/QuestActions.js';
import { MissionItemAssets } from './quests/MissionItemAssets.js';
import { Acquaintances, codexEntries, contactCards, inventoryCards } from './ScreenRecords.js';
import { ContactBook } from './contacts/ContactBook.js';
import { answerOf, contactLines, givesNumber } from './contacts/Calls.js';
import { PhoneCalls } from './contacts/PhoneCalls.js';
import { InvestigationGameplay } from './investigation/index.js';
import { ScenePlaceResolver, SceneryDirector } from './scenery/index.js';
import { ObjectiveRouter } from './routes/ObjectiveRouter.js';
import { ObjectiveGuide } from './routes/ObjectiveGuide.js';
import { GamePersistence, mergeInventory, mergeProgress, uniqueLocations } from './persistence/index.js';
import { buildingAnchors, groundAnchors } from './agents/Anchors.js';
import { Passage } from './agents/Passage.js';
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
import { ApartmentDoors } from './city/ApartmentDoors.js';
import { ShellScene } from './ShellScene.js';
import { Links } from './links/Links.js';
import { Transit } from './transit/Transit.js';
import { StationAccess } from './transit/StationAccess.js';
import { TransitJourney } from './transit/TransitJourney.js';
import {
	TransitGameplay, transitErrorMessage, transitServiceLabel, transitStatusLabel
} from './transit/TransitGameplay.js';
import { InteriorStream } from './city/InteriorStream.js';
import { InteriorModules, placedModules } from './city/InteriorModules.js';
import { InteriorProps, placedProps } from './city/InteriorProps.js';
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
import { frameYield } from '../app/FrameYield.js';
import { Input } from './player/Input.js';
import { PlayerController } from './player/PlayerController.js';
import { Interactor } from './player/Interactor.js';
import { PauseState } from './player/PauseState.js';
import { CharacterAssets } from './agents/CharacterAssets.js';
import { HeroCharacter } from './agents/HeroCharacter.js';
import { GameplayAnimationDirector } from './GameplayAnimationDirector.js';
import { Crowd } from './agents/Crowd.js';
import { WalkRoutes } from './agents/WalkRoutes.js';
import { WalkSurface } from './agents/WalkSurface.js';
import { NpcContinuity } from './agents/NpcContinuity.js';
import { circulationOf, InteriorRoutes } from './agents/InteriorRoutes.js';
import { CompanionGameplay } from './companion/CompanionGameplay.js';
import { CarModels } from './agents/CarModels.js';
import { Traffic } from './agents/Traffic.js';
import { SimBridge } from './sim/SimBridge.js';
import { recoverDeviceLoss } from './look/DeviceLoss.js';
import { SpawnVisibility } from './agents/SpawnVisibility.js';
import { interiorOccupancy } from './city/InteriorOccupancy.js';
import { storyStartMinute } from './time/StoryStart.js';
import { GameClock } from './time/GameClock.js';
import { stopsFor } from './time/DayCycle.js';
import { Locator } from './world/Locator.js';
import { Bookmarks } from './world/Bookmarks.js';
import { mapModel, blockWorld } from './world/MapModel.js';
import { Snapshots } from './portraits/Snapshots.js';
import { Portraits } from './portraits/Portraits.js';
import { BuildingShots } from './portraits/BuildingShots.js';

const _push = new THREE.Vector3();
const THEME = 'cyberpunk';
/** Named steps one load runs through, the counter's own first units. */
const LOAD_STEPS = 15;
/** Past this a room is behind opaque walls and haze, so it is not drawn. */
const ROOM_VISIBLE_RADIUS = 32;
const NPC_VISIBLE_RADIUS = 115;
/**
 * How near the player's eye a person stands to wear their whole recipe
 * (HeroCharacter.near), the companion from further off, and how much further
 * one already wearing it keeps it, so nobody flickers at the edge.
 */
const CLOSE_REACH = 6;
const COMPANION_REACH = 15;
const CLOSE_SLACK = 1.5;
/** Air scattering is wide and weak indoors, tight and small on the street. */
const INDOOR_HAZE = { spread: 0.55, cap: 3 };
const OUTDOOR_HAZE = { spread: 0.28, cap: 2.4 };
/** The HUD panels and the key that opens each, as the dock labels them. */
const PANEL_KEYS = [
	[ 'KeyJ', 'QUESTS' ], [ 'KeyM', 'MAP' ], [ 'KeyI', 'INVENTORY' ],
	[ 'KeyX', 'CODEX' ], [ 'KeyP', 'CONTACTS' ], [ 'KeyO', 'SETTINGS' ], [ 'Slash', 'CONTROLS' ]
];
const BINDINGS = [
	{ keys: [ 'PgUp', 'PgDn' ], category: 'Interaction', action: 'Select lift floor; E to travel', description: 'In a lift, pick the floor; E takes you there.' },
	{ category: 'Movement', action: 'walk', keys: [ 'W', 'A', 'S', 'D' ], description: 'Walk the streets and the floors of a building; two keys together walk on the diagonal.' },
	{ category: 'Movement', action: 'jump', keys: [ 'Space' ], description: 'Hop a kerb or a low step.' },
	{ category: 'Movement', action: 'crouch', keys: [ 'C' ], description: 'Lower your view while it is held.' },
	{ category: 'Movement', action: 'sprint', keys: [ 'Shift' ], description: 'Run while it is held.' },
	{ category: 'Movement', action: 'running speed: normal / double / quadruple', keys: [ '1', '2', '4' ], description: 'How fast you run, for long walks across the city.' },
	{ category: 'Movement', action: 'hold zoom', keys: [ 'Right mouse' ], description: 'Look closer while the button is held.' },
	{ category: 'Interaction', action: 'interact, board, leave transit, take, inspect, listen, steal, work, deliver', keys: [ 'E' ], description: 'Talk to the person in front of you, open a door, board or leave a ride, or do what the prompt names.' },
	{ category: 'Interaction', action: 'read quest document', keys: [ 'R' ], description: 'Read a document a story hands you.' },
	{ category: 'Interface', action: 'journal', keys: [ 'J' ], description: 'Your stories, the one you follow and where it goes next.' },
	{ category: 'Interface', action: 'map', keys: [ 'M' ], description: 'The city, where you stand and the way to your objective.' },
	{ category: 'Interface', action: 'inventory', keys: [ 'I' ], description: 'What you carry, and the stories it belongs to.' },
	{ category: 'Interface', action: 'codex', keys: [ 'X' ], description: 'The things, people and places you have come across.' },
	{ category: 'Interface', action: 'contacts', keys: [ 'P' ], description: 'The people who gave you their number; call one from here.' },
	{ category: 'Interface', action: 'settings', keys: [ 'O' ], description: 'Picture, crowd, voices and the developer readouts.' },
	{ category: 'Interface', action: 'controls', keys: [ '?' ], description: 'This reference.' },
	{ category: 'Interface', action: 'pause menu', keys: [ 'Esc', 'N' ], description: 'Hold the city still and open the menu.' },
	{ category: 'Interface', action: 'close the chat or a panel', keys: [ 'Esc' ], description: 'Back to the street, or to the menu a panel was opened from.' }
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
/** People this near a person in the street are with them: they can see each other. */
const PRESENT_REACH = 20;
/** A person asked to sit down takes a free seat of their building within this many metres. */
const SEAT_REACH = 15;
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
		/** The people the player has talked to, for the codex. */
		this.acquaintances = new Acquaintances();
		/** The people who gave the player their number, which the save keeps. */
		this.contacts = new ContactBook();
		/** What people say when asked for their number or called. */
		this.contactLines = contactLines();
		/** The chat's action row: offer id to the label the player says. */
		this.dialogueActions = new Map();
		/** A leader's arrival while it opens its conversation, or null. */
		this.arriving = null;
		/** Whether the player plays, has paused, or has the pointer free while the world plays on. */
		this.pauseState = new PauseState();
		this.talk = new TalkClient( config.outBase );
		this.view = new GameView( {
			onResume: () => this.input?.requestLock(),
			onSave: () => this.#saveFromPause(),
			onCloseDialog: () => {
				this.#closeConversation();
				if ( this.view.summary.element.hidden ) this.input?.requestLock();
			},
			// A click on the card takes the pointer back; Escape leaves it free, where the game stood.
			onSummaryClose: ( { pointer } ) => { if ( pointer && ! playableModalOpen( this.view, this.interactor ) ) this.input?.requestLock(); },
			onSummaryOpen: () => { this.#release(); this.view.setPaused( false ); },
			onSend: ( text ) => this.#say( text ),
			onOpen: ( name ) => {

				this.#release();
				if ( name === 'QUESTS' ) this.#refreshQuestState();
				if ( name === 'CODEX' ) this.#refreshCodex();
				if ( name === 'CONTACTS' ) this.#refreshContacts();
				if ( name === 'MAP' ) this.#refreshMapLocation();

			},
			onQuestTrack: ( questId, stepId ) => this.#followQuest( questId, stepId ),
			onQuestWait: ( questId, stepId ) => this.#waitForQuest( questId, stepId ),
			onDialogueChoice: choice => this.#chooseDialogue( choice ),
			onDialogueTopic: topic => this.#selectDialogue( topic ),
			onDialogueAction: id => this.#dialogueAction( id ),
			onDialogueRetry: () => this.#say( this.failedDialogueLine, { retry: true } ),
			onDialogueJournal: () => { this.#closeConversation(); this.view.open( 'QUESTS' ); },
			onDialogueVoice: ( on ) => this.#setting( { key: 'voice', value: on ? 'on' : 'off' } ),
			// A panel opened from the pause menu goes back to it.
			onClose: () => { if ( ! this.pauseState.paused ) this.input?.requestLock(); },
			onLeave: () => this.#leave(),
			onSettingChange: ( change ) => this.#setting( change ),
			onCall: ( npcId ) => this.#call( npcId ),
			onHangUp: () => {

				this.phone.hangUp();
				this.input?.requestLock();

			},
			onRedial: () => { if ( this.phone.npcId ) this.#call( this.phone.npcId ); },
			onCallClose: () => this.phone.drop(),
			onTransitSelect: ( service ) => this.#selectTransit( service ),
			onTransitCancel: () => this.#cancelTransitSelection()
		} );
		this.view.mount( document.body );
		/** The player's phone: the call ringing, talked on or just over, on the call screen. */
		this.phone = new PhoneCalls( {
			view: this.view.call,
			answerOf: ( npcId ) => this.#answerOf( npcId ),
			open: ( npcId ) => this.#answered( npcId ),
			close: () => this.#closeConversation(),
			contactOf: ( npcId ) => {

				const person = this.acquaintances.get( npcId );
				return { name: person?.name ?? '', role: person?.role ?? '', handle: handleOf( person?.name ) };

			},
			portraitOf: ( npcId ) => this.portraits?.portrait( { npcId } ) ?? null,
			reach: ( npcId ) => this.#reach( npcId ),
			busyLine: ( npcId ) => this.contactLines.say( 'call-busy', {}, `${npcId}|${Math.floor( this.clock.timeMin )}` )
		} );
		// The developer readouts show when the run asks for them (GameConfig `details`) or the settings turn them on.
		this.view.setDetails( this.details = Boolean( config.details ) );
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
			( text, record ) => this.view.step( text, record ), { log: import.meta.env.DEV }
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
		const rendering = progress.timed( 'renderer', RendererFactory.create( config.backend, { antialias: false } ) );
		const resolver = new MaterialResolver();
		const theme = progress.timed( 'material theme', resolver.loadTheme( THEME ) );
		// The masks the surface-detail layer reads, where Materials publishes them.
		const detailBinding = config.off.has( 'detail' ) ? null : resolver.loadBindings( DETAIL_BINDING ).catch( () => null );
		const starting = progress.timed( 'physics', Physics.create() );
		const cars = progress.timed( 'cars', CarModels.load( config.maxCars ) );
		const {
			atlas, connections, nativeStreets, rooftopSpans, buildings, unbuilt, npcTypes, questlines, investigations, scenery,
			mechanicTargetBindings, missionAssetRequests, missionItemBindings, game, shellCatalog, kit,
			interiorModules, interiorProps, loadBuildings
		} = await reading;
		// A catalog game's name stands under the loading crystal.
		this.view.setLoadingPlace( game?.name ?? null );
		const spawn = game ? savedSpawn( game ) : pickSpawn( connections.networks, atlas, unbuilt.length ? buildings : undefined );
		const spatial = Boolean( shellCatalog );
		const transitRoutes = connections.networks.transit.routes;
		this.transitJourney = new TransitJourney( {
			atlas, routes: transitRoutes, ...( game?.transitJourney ? { state: game.transitJourney } : {} )
		} );
		this.persistence = game ? new GamePersistence( { game, gameId: config.gameId } ) : null;
		// The dialogue server keeps what people remember in the game as each
		// talk completes; the save's memory joins it beside the load, or before
		// the first talk or save that finds it has not.
		const remembering = game && this.talk.restoreMemory( game.dialogueMemory ?? [] )
			.catch( ( error ) => console.warn( 'dialogue memory not restored yet:', error.message ) );
		const stationAccess = new StationAccess( atlas );
		this.recentEvents = new RecentEvents( atlas.parcels );
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
		recoverDeviceLoss( this.renderer, {
			save: () => this.persistence && this.body && this.controller && this.quests ? this.#saveCurrent() : null,
			notify: ( message ) => this.view.toast.show( message )
		} );
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
		// Streets, sidewalks and exterior walls wear world-space use: oily
		// smears, polish, grime and stains, from the Materials surface-detail
		// masks where the catalog publishes them and procedural stand-ins
		// drawn on a worker otherwise. `off=detail` leaves it out of a run.
		if ( ! config.off.has( 'detail' ) ) {

			const detail = this.surfaceDetail = SurfaceDetail.load( {
				binding: await detailBinding,
				mapTexture: ( key, variantId, map, options ) => factory.dataMap( key, variantId, map, options ),
				anisotropy: Math.min( 4, this.tier.textureAnisotropy ?? 4 )
			} );
			factory.weathering = { detail, resources: detail.resources, nodes: ( profile ) => wearExterior( detail, profile ) };

		}
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
		// Of the modules, only those the furnished buildings' floors place: the
		// stream registers these buildings and no other.
		this.interiorModules = interiorModules
			? new InteriorModules( {
				catalog: interiorModules.document, baseUrl: interiorModules.baseUrl, factory, roomLights: this.rooms,
				only: placedModules( buildings )
			} )
			: null;
		this.interiorProps = interiorProps
			? new InteriorProps( { catalog: interiorProps.document, baseUrl: interiorProps.baseUrl, roomLights: this.rooms } )
			: null;
		// So is the furniture those floors place, read now so the load prepares
		// its draws: a floor coming into sight then never brings a model, its
		// maps or its programs to the frame. One that fails to read is left to
		// the floor that places it, which fails as it always has.
		const furnishing = this.interiorModules && ! config.off.has( 'interiors' )
			? this.interiorProps?.prepare( placedProps( buildings ) ).catch( ( error ) => console.warn( `interior furniture: ${error?.message ?? error}` ) )
			: null;
		const [ city ] = await Promise.all( [ standing, laying, progress.timed( 'room catalogs', Promise.all( [ this.interiorModules?.ready, furnishing ] ) ) ] );
		this.hydrology = await water;
		this.scene.add( city.group );

		this.elevators = new Elevators( factory );
		this.stream = new InteriorStream( {
			modules: this.interiorModules, props: this.interiorProps, roomLights: this.rooms, elevators: this.elevators,
			haze: this.tier.haze ? INDOOR_HAZE : null, hitches: this.hitches, budget: slice
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
		this.stream.apartmentDoors = new ApartmentDoors( this.physics );
		this.impactWorld = new ImpactWorld( this.physics );
		await this.colliders.addStaticsAsync( city.shellColliders, { release: true } );
		city.shellColliders.clear();
		await this.colliders.addStaticsAsync( [ [ 'building links', links.colliderGeometry ] ], { release: true } );
		await this.colliders.addStaticsAsync( this.transit.colliders );
		await this.colliders.addPostsAsync( lamps.posts );
		// Floor modules and catalog furniture enter through the cuboid path.
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
			game?.npcState?.simulation ?? null,
			castNames( questlines )
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
		if ( ! game?.npcState && ! config.explicitHour ) this.clock.seconds = storyStartMinute( this.quests, this.sim, this.clock.timeMin ) * 60;
		const crowdPlaces = placesOf( city.entrances, buildings );
		this.spawnVisibility = new SpawnVisibility( this.camera, {
			fog: this.fog,
			occluded: ( eye, point ) => {

				const direction = new THREE.Vector3( point.x - eye.x, point.y - eye.y, point.z - eye.z );
				const distance = direction.length();
				direction.normalize();
				return Boolean( this.physics.world.castRay( new this.physics.rapier.Ray( eye, direction ), Math.max( 0, distance - 1 ), true,
					undefined, undefined, undefined, undefined, collider => ! collider.isSensor() && collider.parent()?.isFixed() ) );

			}
		} );
		const continuityPlaces = npcContinuityPlaces( atlas, city.entrances, buildings, routes, transitRoutes );
		// People open doors and ride lifts on their way: the same leaves and cars the player uses.
		this.passage = new Passage( {
			doors: () => [ ...city.doors, ...( this.stream.apartmentDoors?.doors ?? [] ) ],
			elevators: this.elevators,
			// Inside buildings people give way to each other as the crowd draws them.
			steer: () => this.crowd?.indoor ?? null
		} );
		this.interiorRoutes = new InteriorRoutes( buildings, { findPath } );
		this.npcContinuity = new NpcContinuity( {
			simulation: this.sim,
			routes,
			places: continuityPlaces,
			interiorRoutes: this.interiorRoutes,
			ways: this.passage
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
			visibility: this.spawnVisibility,
			floorShown: ( parcel, floor ) => this.stream.floorShown( parcel, floor ),
			surface: new WalkSurface( atlas.volumetric?.ground ),
			places: crowdPlaces,
			// Guests walk to and from their seats, and out through the door, as the building's navigation leads.
			interiorRoutes: this.interiorRoutes,
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
			// A person's garments are fitted a few milliseconds a frame once the city plays.
			slice,
			lighting: actorLighting
		} );
		this.scene.add( this.hero.group );
		// Pictures of people and buildings for the codex, drawn only while the world holds still.
		this.snapshots = new Snapshots( { renderer: this.renderer } );
		this.portraits = new Portraits( { snapshots: this.snapshots, poser: this.hero.poser, sim: this.sim } );
		this.buildingShots = new BuildingShots( { snapshots: this.snapshots, pieces: this.shellScene?.pieces ?? null, buildings } );
		// The people standing near the player are the crowd's, and the probe reflects the city without them.
		this.probe?.exclude( this.hero.group );
		this.animations = new GameplayAnimationDirector( {
			catalog: assets.animationCatalog,
			animation: assets.animation,
			crowd: this.crowd,
			hero: this.hero
		} );
		/** Each NPC type's label, which the chat shows as the person's role. */
		this.npcTypeLabels = new Map( ( npcTypes?.types ?? [] ).map( ( { type, label } ) => [ type, label ] ) );
		this.contacts.restore( game?.contacts ?? [] );
		// Whoever the saved game remembers talking to, or keeps as a contact, is somebody the codex knows.
		const contactsOnly = this.contacts.list().filter( ( { npcId } ) => ! ( game?.dialogueMemory ?? [] ).some( ( entry ) => entry.npcId === npcId ) );
		for ( const { npcId, memory } of [ ...( game?.dialogueMemory ?? [] ), ...contactsOnly ] ) {

			const npc = rememberedPerson( this.sim, npcId );
			if ( ! npc?.name ) continue;
			const name = this.quests.characterName( npcId );
			this.acquaintances.remember( npcId, memory?.turns ?? [], {
				name: TalkClient.nameOf( name ? { ...npc, name } : npc ),
				role: this.npcTypeLabels.get( npc.type ) ?? ''
			} );

		}
		if ( ! this.lineObserver ) {

			this.lineObserver = this.voice = NpcVoice.forGame( {
				dialog: this.view.dialog, npcTypes, quests: this.quests, animations: this.animations, enabled: config.voice, target: window
			} );

		}
		// The chat's voice toggle stands for the NPC voices setting; a caller's observer has none.
		this.view.dialog.setVoice( this.voice ? this.voice.enabled : null );

		progress.step( 'loading traffic' );
		const carModels = await cars;
		this.scene.add( carModels.group );
		this.traffic = new Traffic( {
			networks: connections.networks, models: carModels,
			signals: this.signals, capacity: config.maxCars,
			spawnRadius: config.carRadius,
			seed: atlas.meta.seed, visibility: this.spawnVisibility
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
			animations: this.animations,
			itemPlaces: new ScenePlaceResolver( { buildings, doors: city.entrances, atlas } )
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
		const reach = companionReach( { buildings, places: continuityPlaces, interiorRoutes: this.interiorRoutes, continuity: this.npcContinuity, ways: this.passage } );
		const categories = new Map( ( npcTypes?.types ?? [] ).map( ( { type, category } ) => [ type, category ] ) );
		this.companion = new CompanionGameplay( {
			continuity: this.npcContinuity, sim: this.sim, routes, places: continuityPlaces, atlas,
			quests: this.questGameplay, scenes: () => companionScenes( this.scenery.stagedPlaces(), this.companion.places ), crowd: this.crowd,
			inside: reach, streets: new StreetNames( atlas.streets, atlas.meta.gridAngle ?? 0 ),
			people: ( npc ) => this.#placedAcquaintances( npc ), categoryOf: ( type ) => categories.get( type )
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
		// Unpaced until the city is drawn: a turn between programs is a pass of
		// the event loop, not a frame, while nothing is on screen to protect.
		this.floorWarmup = prepareInteriorStreaming(
			this.stream, this.renderer, this.scene, this.camera, this.look.pipeline.mrt, this.look.pipeline.renderTarget,
			{ budget: new FrameBudget( { paced: false } ), hitches: this.hitches, shadow: () => this.look.sun?.pass() ?? null }
		);
		if ( this.shellScene ) this.shellScene.warmup = this.floorWarmup;
		// A focused character's model and a scene the quests stand are prepared
		// through the same queue when they are asked for, not on the frame that
		// first draws them.
		this.hero.warmup = this.floorWarmup;
		this.scenery.renderer.warmup = this.floorWarmup;
		this.investigations.renderer.warmup = this.floorWarmup;
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
			doorColliders: this.doorColliders, interiors: this.stream, typeLabels: this.npcTypeLabels
		} );
		this.interactor.onConversation = ( conversation ) => this.presentConversation( conversation );

		this.input.onLockChange = ( locked ) => {

			this.controller.frozen = ! locked;
			if ( locked ) this.pauseState.held();
			else this.pauseState.lost( playableModalOpen( this.view, this.interactor ) );

		};

		const map = mapModel( atlas, connections.networks );
		this.view.minimap.setMap( map );
		this.view.minimap.setVenues( this.venues.marks );
		this.view.map.setWorld( blockWorld( atlas, connections.networks ) );
		this.view.map.setVenues( this.venues.marks );
		this.#updateObjectiveRoute( 0, true );
		this.view.settings.setValues( {
			quality: this.tier.name, fog: config.fog, exposure: config.exposure, crowd: config.maxCrowd,
			voice: this.voice?.enabled ? 'on' : 'off', voiceVolume: this.voice?.volume ?? 1, details: this.details ? 'on' : 'off'
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
		// six times into its resident environment, its faces counted, through
		// the frame's own render context, so it builds nothing of its own here
		// (#reflect builds that once the city plays), and a last pass pins
		// whatever program that frame was the first to ask for.
		progress.step( 'preparing nearby floors' );
		await this.stream.prepare( spawn.point );
		this.roomView.setRooms( this.stream.rooms );
		progress.step( 'preparing the first frame' );
		this.playStartedAt = performance.now();
		/** Seconds the world has played, which stand still while it holds. */
		this.playSeconds = 0;
		// The world opens paused and steps no physics until play starts: what
		// loading admitted answers queries from the first frame all the same,
		// and the player starts standing on the ground there.
		this.physics.refresh();
		this.body.settle();
		this.tick( 0 );
		if ( this.probe ) {

			const probing = progress.pass( 'preparing the probe' );
			await this.probe.prepare( this.floorWarmup, ( done, total ) => probing.at( done, total ) );
			const baking = progress.pass( 'baking the environment' );
			await this.probe.bakeAsync( spawn.point, { slice, onProgress: ( done, total ) => baking.at( done, total ) } );

		}
		// Every lift car and landing wears one set of materials whichever shaft
		// it stands in, so preparing one of each now leaves no car a graph to
		// build when a tower's lifts first come into view.
		const lifts = this.elevators.specimen( this.interiorModules );
		if ( lifts ) {

			await preparing( 'the lifts' )( lifts );
			this.elevators.discard( lifts );

		}
		const pinning = progress.pass( 'pinning the programs' );
		await this.floorWarmup.warmAll( this.scene, { onProgress: ( done, total ) => pinning.at( done, total ) } );
		await remembering;
		this.hitches.notes.length = 0;
		// The city is about to be drawn, so admitting a cell or preparing a
		// program from here on gives the frame its turn instead of holding it.
		slice.pace();
		this.floorWarmup.pace();
		this.view.setPaused( true );
		this.view.pause.setSave( this.persistence ? 'ready' : 'unavailable' );
		this.view.ready();
		progress.finish();
		const opening = openingCard( this.persistence, this.quests );
		if ( opening ) this.view.summary.show( opening );

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
		// What the continuity hands itself from now on is checked only when asked (`checks=on`).
		this.npcContinuity.boundary.play?.( config.checks === true );
		this.renderer.setAnimationLoop( () => this.#frame() );
		if ( this.probe ) this.#reflect();
		// A driver's hands on a read-only preview, installed once the city plays.
		if ( config.automation ) {

			const { AutomationProbe } = await import( './debug/AutomationProbe.js' );
			this.automation = new AutomationProbe( this );

		}

	}

	/**
	 * The probe's own graphs, built through the warm-up queue once the city
	 * plays, then a bake in its own faces where the player stands by then, all
	 * six in one go: from there on it bakes as it always has, without the
	 * frame's multisampling the opening bake borrowed (EnvironmentProbe). A
	 * graph holds the main thread for a good part of a second, so the next
	 * one, and the bake, only go while nothing on screen needs the frame: the
	 * world holds (the pause menu a game opens on, a panel) or the player has
	 * stood still for a moment.
	 */
	async #reflect() {

		const calm = {
			step: async () => {

				do await frameYield(); while ( ! this.holding && ( this.rest?.seconds ?? 0 ) < STILL_SECONDS );

			},
			pace() {}
		};
		try {

			await this.probe.prepare( this.floorWarmup, undefined, { own: true, budget: calm } );
			await calm.step();
			this.probe.unshare();
			this.probe.bake( this.body.feet );

		} catch ( error ) {

			console.warn( `environment probe: ${error?.message ?? error}` );

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
		const speaker = conversation && speakerOf( conversation, this.npcTypeLabels );
		this.view.dialog.show( speaker );
		if ( conversation?.instance && ! conversation.call ) this.acquaintances.met( conversation.npcId, { ...speaker, place: this.#placeName( this.currentLocation ), timeMin: this.clock.timeMin } );
		this.view.avatar.setVisible( Boolean( conversation ) );

		if ( ! conversation ) {

			// The chat closing on a call hangs up.
			if ( leaving?.call ) this.phone.closed( leaving.npcId );
			if ( this.pendingDialogueEnding ) this.view.summary.show( this.pendingDialogueEnding );
			this.pendingDialogueEnding = null;
			return;

		}
		if ( ! conversation.instance ) this.view.dialog.setFreeChat( false, PASSER_BY.note );
		else this.#recallTalk( conversation );
		if ( conversation.call ) {

			// The person picks up and says so; the talk is free, with what they can do from where they are.
			this.view.dialog.setStory( null );
			this.#npcSays( conversation, this.contactLines.say( 'call-greeting', {}, `${conversation.npcId}|${Math.floor( this.clock.timeMin )}` ) );
			this.#showActions( conversation );
			this.view.dialog.setTalkOpen( true );
			this.#release();
			return;

		}
		const topics = this.quests.dialoguesFor( conversation.npcId, this.clock.timeMin );
		const preferred = topics.find( topic => topic.questlineId === this.followedQuestId ) ?? topics[ 0 ];
		const arrival = this.arriving?.npcId === conversation.npcId ? this.arriving : null;
		if ( preferred ) this.#selectDialogue( { questId: preferred.questlineId, stepId: preferred.stepId } );
		// A person who has led the player here talks about the place.
		else if ( arrival ) this.#say( arrival.ask, { arrival } );
		else {

			const recap = this.quests.conversationRecap( conversation.npcId );
			this.view.dialog.setStory( recap ? { title: recap.title, objective: this.questGameplay.objective( this.clock.timeMin, recap.questId )?.text } : null );
			// A person speaks first only with something real to say: a recap of their story, or a passer-by's hurry.
			if ( recap || ! conversation.instance ) this.#npcSays( conversation, recap?.reply ?? PASSER_BY.greeting );
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
		this.view.avatar.setAvatar( { name: speaker.name, role: speaker.role, bar: 1 } );
		this.#release();

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
	/**
	 * One step of the player's body and view: physics, the crowd and traffic
	 * pushing it out of anyone it walked into, the lifts carrying it, and then
	 * the camera placed where all that left it, so no correction shows a frame late
	 * and a rider's eye stays at one height in the moving car.
	 */
	stepPlayer( delta ) {

		this.physics.step( delta );
		this.body.push( _push.copy( this.crowd.pushback( this.body.feet, BODY_RADIUS ) ).add( this.traffic.pushback( this.body.feet, BODY_RADIUS ) ) );
		this.elevators.update( delta, this.body );
		this.controller.update( delta );

	}

	tick( delta ) {

		// Paused, or with a panel open, the world holds still: no time passes for it.
		this.pauseState.update( this.input.locked );
		const holding = this.pauseState.holds( this.view.panels.current );
		if ( holding !== this.holding ) this.voice?.setPaused( this.holding = holding );
		// A call rings and counts in the player's own time, whatever the world does or the frame rate allows.
		const now = performance.now();
		this.phone.update( Math.max( 0, now - ( this.phoneClock ?? now ) ) / 1000 );
		this.phoneClock = now;
		if ( holding ) delta = 0;
		// A picture a screen asked for is drawn only while nothing moves, one piece a frame, or for the face on a call.
		if ( holding || this.phone.live ) this.snapshots?.step();
		this.controller.frozen = ! this.input.locked || playableModalOpen( this.view, this.interactor );
		this.clock.advance( delta );
		this.hydrology.update( this.playSeconds += delta );

		const day = this.sky.day;
		this.night.set( day.lampsOn );
		this.exposure.setDaylight( stopsFor( day.state ) );
		this.view.clock.setState( day.state );
		let transitFrame = this.transitGameplay.aboard
			? this.transitGameplay.update( { daySeconds: this.clock.daySeconds } )
			: null;

		this.hitches.time( 'physics/player', () => this.stepPlayer( delta ) );
		for ( const impact of this.impactWorld.drain() ) this.ragdoll( impact );

		const feet = this.body.feet;
		this.spawnVisibility.update();
		this.safetyGround.update( this.camera );
		this.shellScene?.update( feet );
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
			timeMin: this.clock.exactMin,
			deltaSeconds: delta,
			playerPosition,
			...( room ? { playerPlace: { kind: 'parcel', id: room.parcelId, floor: room.floor } } : {} )
		} ) );
		this.updateCompanion( playerPosition, playerPlaces );
		this.hitches.time( 'crowd', () => {

			const actors = this.npcContinuity.updateVisible( {
				timeMin: this.clock.exactMin,
				playerPosition,
				maxDistance: NPC_VISIBLE_RADIUS
			} );
			this.crowd.syncActors( actors, feet, delta );
			this.animations.update( actors, delta );
			this.crowd.update( delta, feet, this.clock );

		} );
		this.hitches.time( 'scenery', () => this.scenery.update( { timeMin: this.clock.timeMin, feet }, delta ) );
		this.hitches.time( 'close people', () => this.hero.near( this.#closePeople() ) );
		// Whoever the player talks to looks at them, seated or standing.
		this.hero.lookAt( this.interactor.conversation?.person ?? null, this.camera.position );
		this.hero.update( delta );
		this.hitches.time( 'traffic', () => this.traffic.update( delta, feet, this.clock.daySeconds ) );
		this.impactWorld.sync( {
			people: [ ...this.crowd.members.values() ],
			vehicles: this.traffic.cars
		} );
		this.transit.update( feet, this.clock.daySeconds, delta, this.spawnVisibility );
		this.venues.update( delta, feet, this.clock.timeMin, this.sim, this.lights );
		this.hitches.time( 'relight', () => this.#relight( feet, delta ) );

		const worldPrompt = this.interactor.update( delta, {
			timeMin: this.clock.timeMin,
			playerPlaces,
			feet: { x: feet.x, y: feet.y, z: feet.z },
			eye: { x: this.controller.eye.x, y: this.controller.eye.y, z: this.controller.eye.z },
			look: { x: this.controller.look.x, y: this.controller.look.y, z: this.controller.look.z }
		} );
		for ( const result of this.questGameplay.drainMechanicResults() ) this.questActionResult( result );
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
			else if ( owner === 'world' ) this.questActionResult( this.interactor.activate( this.clock ) );
			else this.#transitAction( this.transitGameplay.activate(), playerPlaces );

		}
		if ( secondary && ! playableModalOpen( this.view, this.interactor ) && ! transitFrame.aboard ) {

			this.questActionResult( this.interactor.activate( this.clock, 'secondary-interact' ) );

		}

		// A panel or the chat owns the keyboard while it is up; the game's own
		// keys only fire on the street.
		const free = ! playableModalOpen( this.view, this.interactor );

		if ( free ) {

			for ( const [ code, panel ] of PANEL_KEYS ) if ( this.input.consume( code ) ) this.view.toggle( panel );
			// Escape or N asks for the pause menu; an Escape that closed a panel this frame was spent on it.
			const escape = this.input.consume( 'Escape' ) && this.wasFree;
			if ( ( this.input.consume( 'KeyN' ) || escape ) && this.pauseState.ask( this.input.locked ) ) this.input.exitLock();

		}
		this.wasFree = free;

		this.view.setPaused( this.pauseState.paused && free );
		this.view.setPointerFree( this.pauseState.free( { locked: this.input.locked, open: ! free } ) );
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
			this.view.clock.update( this.clock.label, district, this.venues.nameOf( this.currentLocation.id ) ?? '' );
			if ( this.view.panels.current === 'MAP' ) this.view.map.setLocation( this.#placeName( this.currentLocation ), district );
			if ( this.details ) this.view.readout.update( feet, district, this.locator.parcel( feet.x, feet.z, this.standing?.parcelId ?? null ) );

		} );

		this.look.update( this.camera );
		this.hitches.time( 'render', () => this.look.render() );
		this.input.endFrame();

	}

	/**
	 * One pass over everything that decides where light comes from this frame:
	 * which rooms hold a light slot, what colour the air around the player is,
	 * whether the probe needs rebaking, and which exposure the camera is on.
	 */
	/** Whether the feet have stayed within a hand's width for the last second. */
	/**
	 * The people standing nearest the player's eye, the companion first while
	 * within its reach: anybody fully there, standing, walking or sitting, and
	 * not a stress copy, leaving, frozen or down.
	 */
	#closePeople() {

		const eye = this.body.eye;
		const companion = this.npcContinuity.companion?.npcId ?? null;
		const people = [];
		for ( const member of this.crowd.members.values() ) {

			if ( member.copy || member.retiring || member.fallen || member.frozen || ( member.presence ?? 1 ) < 1 ) continue;
			const leading = Boolean( companion && member.npcId === companion );
			const reach = ( leading ? COMPANION_REACH : CLOSE_REACH ) + ( this.hero.nearby.has( member ) ? CLOSE_SLACK : 0 );
			const distance = member.position.distanceTo( eye );
			if ( distance <= reach ) people.push( { member, order: leading ? - 1 : distance } );

		}
		return people.sort( ( a, b ) => a.order - b.order ).map( ( entry ) => entry.member );

	}

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
	async #say( text, { retry = false, arrival = null, ask = null, unanswered = null } = {} ) {
		const conversation = this.interactor?.conversation;
		if ( ! conversation?.instance || this.dialoguePending || ! text?.trim() ) return;
		const turn = this.#playerSays( retry || arrival ? null : text, { typed: true } );
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
			const context = { signal: controller.signal, ...this.#talkContext( conversation, ! arrival, text, ask ) };
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
			} else if ( unanswered ) {
				// Nobody could answer for the person: they decide the action asked of them by their disposition.
				this.view.dialog.setStatus( '' );
				this.failedDialogueLine = null;
				unanswered();
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
		// Asked one action and answered in words alone: they would not; the ways to answer stay.
		else if ( done && ask ) this.#showActions( conversation );
	}

	/**
	 * What the talk request adds for this person: the place they have led the
	 * player to, what happened around them, when `proposing` the companion
	 * offers they may make, and for the body the player talks to what they
	 * look like, where they stand and who they know (`line` names who the
	 * player asks about).
	 */
	#talkContext( conversation, proposing, line = '', ask = null ) {
		const { npcId, call } = conversation;
		// A chosen action asks the person that alone; a typed line lets them agree to anything they may do now.
		const offers = ask ? this.#askOffers( ask ) : proposing ? this.#proposals( conversation ) : null;
		const guide = call ? null : this.companion.guide( npcId );
		// Known once the world has loaded; on a call what happened around the player is nothing the person saw.
		const events = call ? [] : this.recentEvents?.around( {
			position: this.body.feet, timeMin: this.clock.timeMin, npcId, down: ( id ) => Boolean( this.crowd.member( id )?.fallen ),
			scenes: this.scenery.stagedPlaces(), parcelId: this.standing?.parcelId ?? null, guided: guide?.kind === 'parcel' ? guide.placeId : null
		} ) ?? [];
		const task = this.companion.taskOf?.( npcId ) ?? null;
		return {
			...( offers ? { offers } : {} ), ...( guide ? { guide } : {} ), ...( events.length ? { events } : {} ), ...( task ? { task } : {} ),
			...( call ? { call: { caller: 'player' } } : {} ),
			// A person on the phone is where their body is, wherever that is.
			...this.#bodyContext( call ? { ...conversation, person: this.#remoteBody( npcId ) } : conversation, line )
		};
	}

	/** The talk request's `offers` for one chosen ask: their number, a meeting where the player is, or a companion offer. */
	#askOffers( ask ) {
		if ( ask.kind === 'contact' ) return { contact: true };
		if ( ask.kind === 'meet' ) return { meet: { name: ask.meet.name } };
		return this.companion.talkOffers( [ ask ] );
	}

	/**
	 * What a typed line lets the person agree to: anything they may do now,
	 * and their number while the player lacks it; on a call, only what they
	 * can do from where they are and coming to where the player is.
	 */
	#proposals( conversation ) {
		const { npcId } = conversation;
		const timeMin = this.clock.timeMin;
		if ( conversation.call ) {
			const actions = { ...this.companion.talkOffers( [], { npcId, timeMin } ) };
			delete actions.sit;
			return { ...actions, meet: { name: this.#meetingPoint().name } };
		}
		const offers = this.companion.talkOffers( this.#offers( npcId, { wide: true } ), { npcId, timeMin } );
		return conversation.instance && ! this.contacts.has( npcId ) ? { ...( offers ?? {} ), contact: true } : offers;
	}

	/** Where a person on the phone stands, as a body there would tell it: the continuity's actor for them, or null. */
	#remoteBody( npcId ) {
		const actor = this.npcContinuity?.actor( npcId );
		if ( ! actor?.position ) return null;
		return { position: new THREE.Vector3( ...actor.position ), parcelId: actor.place?.kind === 'parcel' ? actor.place.id : null };
	}

	/**
	 * What only the body the player talks to tells: the look it is drawn in,
	 * in words; where it stands (the building and floor it is inside, the
	 * light there); and the people this person knows with where they are, the
	 * ones near the body seen as here. Nothing for a conversation without a
	 * body or an identity.
	 */
	#bodyContext( { npcId, instance, person }, line ) {
		if ( ! person?.position || ! instance ) return {};
		const position = person.position;
		const room = this.stream?.rooms?.find( ( candidate ) => candidate.holds( position ) ) ?? null;
		const parcelId = room?.parcelId ?? person.parcelId ?? null;
		const here = {
			x: position.x, z: position.z,
			...( parcelId ? { parcelId } : {} ), ...( room ? { floor: room.floor } : {} ),
			light: lightWords( this.sky?.day?.state, Boolean( parcelId ) )
		};
		const recipe = person.look?.recipe ?? recipeFor( { gender: instance.gender, appearanceSeed: instance.appearanceSeed, npcId } ).recipe;
		const context = { look: describeLook( recipe ), here };
		const plan = parcelId ? this.interiorRoutes?.plan( parcelId ) ?? null : null;
		if ( typeof this.sim?.findNPCs !== 'function' ) {

			if ( plan ) here.building = buildingFacts( plan, { room: room?.kind ?? null } );
			return context;

		}
		const everyone = this.sim.findNPCs( {} );
		const names = {};
		for ( const other of everyone ) {
			const name = this.questGameplay?.characterName( other.npcId );
			if ( name ) names[ other.npcId ] = name;
		}
		const people = peopleKnown( {
			npc: { ...this.sim.getNPC( npcId ), ...( names[ npcId ] ? { name: names[ npcId ] } : {} ) }, timeMin: this.clock.timeMin, line, people: everyone, names,
			present: this.#presentAround( npcId, position, parcelId ),
			behaviorAt: ( id, timeMin ) => this.sim.behaviorAt( id, timeMin )
		} );
		if ( plan ) {

			// Who else stands in the building: by name when this person knows them, else by what they are.
			const known = new Map( people.known.map( ( other ) => [ other.npcId, `${other.name.given} ${other.name.family}` ] ) );
			here.building = buildingFacts( plan, { room: room?.kind ?? null, insiders: this.#insiders( npcId, position, parcelId, known ) } );

		}
		return people.known.length || people.unknown.length ? { ...context, people } : context;
	}

	/**
	 * The other bodies in a building as the talk tells them: a name for the
	 * ones `known`, what they are (their post there, else their kind of
	 * person), the floor and the kind of room they stand in, and how far off.
	 */
	#insiders( npcId, position, parcelId, known ) {
		const insiders = [];
		for ( const member of this.crowd?.members?.values() ?? [] ) {
			if ( member.npcId === npcId || member.leaving || member.copy ) continue;
			if ( member.parcelId !== parcelId && member.place?.id !== parcelId ) continue;
			const room = this.stream?.rooms?.find( ( candidate ) => candidate.parcelId === parcelId && candidate.holds( member.position ) ) ?? null;
			const job = ( member.instance ?? this.#established( member.npcId ) )?.job;
			insiders.push( {
				...( known.has( member.npcId ) ? { name: known.get( member.npcId ) } : {} ),
				role: job?.parcelId === parcelId ? job.role : this.npcTypeLabels?.get( member.type ) ?? 'visitor',
				floor: room?.floor ?? member.place?.floor ?? 0, ...( room?.kind ? { room: room.kind } : {} ),
				metres: member.position.distanceTo( position )
			} );
		}
		return insiders;
	}

	/** The simulation's record of an established person, or null. */
	#established( npcId ) {
		if ( ! npcId ) return null;
		try { return this.sim.getNPC( npcId ); } catch { return null; }
	}

	/**
	 * The established people whose bodies stand near a person now: in the same
	 * building on any floor, or within PRESENT_REACH of them outside.
	 */
	#presentAround( npcId, position, parcelId ) {
		const present = new Set();
		for ( const member of this.crowd?.members?.values() ?? [] ) {
			if ( ! member.npcId || member.npcId === npcId || member.leaving || member.copy ) continue;
			const inside = parcelId && ( member.parcelId === parcelId || member.place?.id === parcelId );
			if ( inside || member.position.distanceTo( position ) <= PRESENT_REACH ) present.add( member.npcId );
		}
		return [ ...present ].sort();
	}

	/**
	 * The person agreed in their reply to follow or to lead the way. The typed
	 * request is the player's consent, so an offer the rules allow is taken:
	 * the chat closes on the reply and they set off. Otherwise they say why not.
	 */
	#takeOffer( conversation, { kind, placeId }, reply ) {
		if ( kind === 'contact' ) return this.#addContact( conversation );
		const meet = kind === 'meet' ? this.#meetingPoint() : null;
		const result = this.companion.acceptFromTool( {
			npcId: conversation.npcId, kind, ...( placeId ? { placeId } : {} ), ...( meet ? { meet } : {} ), timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces
		} );
		if ( result.ok ) this.#sendAlong( conversation, reply ?? result.line );
		else this.#npcSays( conversation, result.line );
	}

	/**
	 * The player takes the turn and their line, if any, shows. A line they did
	 * not type (a story choice, a recap question, a chat action) goes with the
	 * next typed line. Returns the new turn.
	 */
	#playerSays( text, { typed = false, kind = typed ? 'talk' : null } = {} ) {
		const turn = this.#interrupt();
		if ( text ) this.view.dialog.addMessage( { from: 'player', name: 'You', text, kind } );
		if ( text && ! typed ) this.talk.said( this.interactor.conversation.npcId, 'player', text, this.clock.timeMin );
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
	 * text, cues and all. A whole line is heard at once and goes with the next
	 * typed line, which a streamed reply follows already. `{ streaming: true }`
	 * opens the line with its first text and returns it to grow: `append(text)`,
	 * `hear(sentence)` as each sentence completes, then `finish()`, or
	 * `discard()` for a reply that never completed.
	 */
	#npcSays( conversation, text, { streaming = false, kind = streaming ? 'talk' : null } = {} ) {
		const speaker = { from: 'npc', name: speakerOf( conversation ).name, kind };
		const heard = ( line, words ) => {
			this.lineHeard = true;
			// The last thing a person said to the player, as the contacts screen reads it.
			this.acquaintances.heard( conversation.npcId, stripCues( words ), this.clock.timeMin );
			this.#observe( 'said', { conversation, line, text: words } );
		};
		this.animations.npcDialogueTurn( conversation );
		if ( ! streaming ) {
			heard( this.view.dialog.addMessage( { ...speaker, text: stripCues( text ) } ), text );
			this.talk.said( conversation.npcId, 'npc', text, this.clock.timeMin );
			return null;
		}
		const message = this.view.dialog.beginMessage( speaker );
		let spoken = '';
		const append = ( piece ) => message.update( stripCues( spoken += piece ) );
		append( text );
		return { append, hear: ( sentence ) => heard( message.line, sentence ), finish: message.finish, discard: message.discard };
	}

	/** What this person remembers saying with the player shows above the conversation's lines, set apart as earlier. */
	#recallTalk( conversation ) {
		const name = speakerOf( conversation ).name;
		this.talk.remembered( conversation.npcId ).then( ( turns ) => {
			if ( this.conversationShown !== conversation || ! turns.length ) return;
			this.view.dialog.recall( turns.map( ( { speaker, text } ) => ( { from: speaker, ...( speaker === 'npc' ? { name } : {} ), text } ) ) );
		}, ( error ) => console.warn( 'dialogue memory not shown:', error.message ) );
	}

	/** What the player may ask of this person now, available or not: the companion's offers, with `wide` the talk's longer list. */
	#offers( npcId, { wide = false } = {} ) {
		return this.companion.offers( { npcId, timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces, ...( wide ? { wide: true } : {} ) } );
	}

	/** The people a person knows whose bodies continuity holds now, by the name they go by, with where they stand. */
	#placedAcquaintances( npc ) {
		if ( typeof this.sim?.findNPCs !== 'function' ) return [];
		const known = peopleKnown( {
			npc, timeMin: this.clock.timeMin, people: this.sim.findNPCs( {} ),
			behaviorAt: ( id, timeMin ) => this.sim.behaviorAt( id, timeMin )
		} ).known;
		return known.flatMap( ( person ) => {
			const actor = this.npcContinuity.actor( person.npcId );
			if ( ! actor ) return [];
			const name = this.questGameplay?.characterName( person.npcId ) ?? person.name;
			return [ { npcId: person.npcId, name: `${name.given} ${name.family}`, position: actor.position } ];
		} );
	}

	/**
	 * The chat's action row: every offer for a person with an identity, whose
	 * refusal they say in words, and asking for their number while the player
	 * lacks it. On a call, asking them to come to where the player is.
	 */
	#showActions( conversation ) {
		const offers = conversation.instance && ! conversation.call ? this.#offers( conversation.npcId ) : [];
		const actions = offers.map( ( offer ) => ( { id: offer.offerId, label: offer.label, icon: offer.kind } ) );
		if ( conversation.instance && ! conversation.call && ! this.contacts.has( conversation.npcId ) ) actions.push( { id: 'contact', label: this.contactLines.say( 'label-contact' ) } );
		if ( conversation.call ) actions.push( { id: 'meet', label: this.contactLines.say( 'label-meet' ), icon: 'lead' } );
		this.dialogueActions = new Map( actions.map( ( action ) => [ action.id, action.label ] ) );
		this.view.dialog.setActions( actions );
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
		if ( id === 'contact' || id === 'meet' ) return this.#ask( conversation, id, label );
		const offer = this.#offers( conversation.npcId ).find( ( entry ) => entry.offerId === id );
		// The person decides a chosen action as they decide a typed one, in their own words; a dismissal, a refusal
		// the rules make or a person with nobody to answer for them is decided by code, in their own lines.
		if ( ! offer || offer.kind === 'dismiss' || ! offer.available || ! conversation.instance || ! this.talk ) return this.#decideAction( conversation, id, label );
		this.#say( label, { ask: offer, unanswered: () => this.#decideAction( conversation, id, null, true ) } );
	}

	/** Decides a chosen action by the companion's rules, and with `willing` by the person's disposition, and says their line. */
	#decideAction( conversation, id, label, willing = false ) {
		const result = this.companion.accept( {
			npcId: conversation.npcId, offerId: id, timeMin: this.clock.timeMin, playerPlaces: this.playerPlaces, ...( willing ? { willing: true } : {} )
		} );
		if ( label ) this.#playerSays( label );
		this.#npcSays( conversation, result.line );
		if ( result.ok ) this.#sendAlong( conversation, result.line );
		else this.#showActions( conversation );
	}

	/**
	 * The player asks for the person's number, or on a call for them to come
	 * to where the player is. The person decides in their own words, as they
	 * decide a typed line; nobody to answer for them decides by code.
	 */
	#ask( conversation, kind, label ) {
		const ask = kind === 'meet' ? { kind, meet: this.#meetingPoint() } : { kind };
		if ( ! conversation.instance || ! this.talk ) return this.#decideAsk( conversation, ask, label );
		this.#say( label, { ask, unanswered: () => this.#decideAsk( conversation, ask, null ) } );
	}

	/** An ask nobody can answer for the person: their number as their disposition says (Calls `givesNumber`), a meeting by the companion's rules. */
	#decideAsk( conversation, ask, label ) {
		if ( label ) this.#playerSays( label );
		if ( ask.kind === 'meet' ) return this.#takeOffer( conversation, { kind: 'meet' }, null );
		const npc = rememberedPerson( this.sim, conversation.npcId );
		const disposition = npc ? dispositionOf( npc, this.companion.categoryOf?.( npc.type ) ) : null;
		const seed = `${conversation.npcId}|${Math.floor( this.clock.timeMin )}`;
		if ( disposition && givesNumber( disposition ) ) {
			this.#npcSays( conversation, this.contactLines.say( 'accept-contact', {}, seed ) );
			return this.#addContact( conversation );
		}
		this.#npcSays( conversation, this.contactLines.say( disposition && disposition !== 'friendly' ? `refuse-contact-${disposition}` : 'refuse-contact-unavailable', {}, seed ) );
		this.#showActions( conversation );
	}

	/** The person gave the player their number: the book keeps them, a notice says so, and the ask leaves the row. */
	#addContact( conversation ) {
		const { npcId } = conversation;
		if ( ! this.contacts.has( npcId ) ) {
			this.contacts.add( npcId, this.clock.timeMin );
			this.view.toast.show( { title: speakerOf( conversation ).name, text: this.contactLines.say( 'notice-contact' ) } );
		}
		this.#showActions( conversation );
	}

	/** Where the player stands, for a person asked on the phone to come and meet them: the point, the building and floor, and its name. */
	#meetingPoint() {
		const feet = this.body.feet;
		const parcelId = this.standing?.parcelId ?? null;
		const name = this.#placeName( this.locator?.location( feet.x, feet.z, parcelId ) ?? this.currentLocation );
		return {
			position: [ feet.x, feet.y, feet.z ], ...( parcelId ? { parcelId } : {} ), ...( Number.isInteger( this.standing?.floor ) ? { floor: this.standing.floor } : {} ),
			name: name || this.contactLines.say( 'name-here' )
		};
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
	 * arrival, and the notices of where a leader is taking the player, that
	 * they have arrived and why a companion ended.
	 */
	updateCompanion( playerPosition, playerPlaces ) {
		const signals = this.hitches.time( 'companion', () => this.companion.update( {
			timeMin: this.clock.timeMin, playerPosition, playerPlaces, busy: playableModalOpen( this.view, this.interactor )
		} ) );
		for ( const signal of signals ) {
			if ( signal.kind === 'arrival' ) this.#arrival( signal );
			else if ( signal.kind === 'line' || signal.kind === 'refused' ) this.#companionSays( signal.npcId, signal.line );
			if ( signal.notice ) this.view.toast.show( { title: 'Companion', text: signal.notice } );
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
		// The goal would only say to talk to this person; why the talk matters says more.
		this.view.dialog.setStory( { title: dialogue.title, stake: dialogue.stake } );
		this.view.dialog.setTopics( topics.map( topic => ( {
			key: topic.questlineId + '/' + topic.stepId, title: topic.title,
			value: { questId: topic.questlineId, stepId: topic.stepId }
		} ) ), questId + '/' + stepId );
		if ( changed ) {
			this.#interrupt();
			// The scene sets where the player stands and why before the person speaks.
			this.view.dialog.addMessage( { from: 'scene', text: dialogue.scene } );
			this.#npcSays( conversation, dialogue.opening, { kind: 'story' } );
		}
		const unavailable = ! dialogue.availability.available;
		this.view.dialog.setChoices( dialogue.choices.map( choice => ( {
			text: choice.text, disabled: unavailable, commits: choice.completesStep,
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
			this.#playerSays( question.text, { kind: 'story' } );
			this.#npcSays( conversation, question.reply, { kind: 'story' } );
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
		this.#playerSays( choice.text, { kind: 'story' } );
		this.#npcSays( conversation, result.reply, { kind: 'story' } );
		if ( ! result.change ) return;
		this.activeDialogue = null;
		this.followedQuestId = questId;
		this.followedStepId = null;
		this.view.dialog.setChoices( [] );
		this.#refreshQuestState();
		const ending = result.change.ending;
		const next = this.questGameplay.objective( this.clock.timeMin, questId );
		this.view.dialog.setStory( { title: result.change.definition.title, objective: ending ? null : next?.text, journal: ! ending } );
		const remaining = this.quests.dialoguesFor( conversation.npcId, this.clock.timeMin );
		this.view.dialog.setTopics( remaining.map( topic => ( {
			key: topic.questlineId + '/' + topic.stepId, title: topic.title,
			value: { questId: topic.questlineId, stepId: topic.stepId }
		} ) ) );
		this.view.dialog.setStatus( ending ? 'Decision recorded. End the conversation to see the outcome.' : 'Journal updated.' );
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
		this.followedQuestId = questId;
		this.followedStepId = stepId;
		this.waitUntil( step.wait.timeMin );
		this.view.toast.show( { title: 'Waited until ' + step.wait.label, text: 'The world clock has advanced. Your quest progress is unchanged.' } );
		if ( this.persistence ) this.#saveCurrent().catch( error => {
			console.error( error );
			this.view.toast.show( { title: 'Save failed', text: error.message } );
		} );

	}

	/**
	 * Moves the world clock on to `timeMin`, never back, and lets the crowd,
	 * scenery, journal and objective catch up; quest progress is unchanged.
	 */
	waitUntil( timeMin ) {

		if ( ! ( timeMin > this.clock.timeMin ) ) return false;
		this.clock.seconds = timeMin * 60;
		if ( this.crowd ) this.crowd.timer = 10;
		this.#refreshQuestState();
		return true;

	}

	/** A QuestActions result updates every player-facing and persisted projection of that runtime state. */
	questActionResult( result ) {

		if ( ! result ) return;
		if ( ! result.ok ) {

			this.view.toast.show( { title: 'Objective', text: result.message } );
			return;

		}

		if ( result.readText || result.action === 'inspect' ) this.view.inspection.show( {
			title: result.readText ? result.message : 'Evidence inspected',
			text: result.readText ?? result.message
		} );

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
				id: destination.destinationId, label: destination.stationName, code: destination.lineId, detail: destination.lineId, value: destination
			} ) ), 'destination' );
			this.#release();
			return;

		}
		if ( action.action === 'choose' ) {

			this.view.transit.choose( action.services.map( ( service ) => ( {
				id: `${service.tripId}:${service.stopIndex}`,
				label: transitServiceLabel( service ),
				code: service.lineId,
				detail: service.kind,
				value: service
			} ) ) );
			this.#release();
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

	/**
	 * Turns one measured vehicle contact into the matching full-body rig; tick
	 * hands it each contact ImpactWorld measured. A fall taken is news to the
	 * named people who stood near it.
	 */
	ragdoll( impact ) {

		let person = this.crowd.member( impact.personId );
		if ( ! person ) return;
		if ( this.interactor?.conversation?.person === person ) this.#closeConversation( 'physics' );
		person = this.crowd.beginRagdoll( impact.personId );
		if ( ! person ) return;
		this.animations.physicsInterrupt( person );
		this.hero.fall( person, this.physics, { point: impact.point, impulse: impact.impulse } )
			.then( ( accepted ) => {

				if ( accepted ) {

					this.recentEvents.struck( {
						personId: impact.personId, npcId: person.npcId, point: impact.point, hard: impact.fatal, atMin: this.clock.timeMin,
						people: this.crowd.members.values()
					} );
					const result = this.questGameplay.fatalImpact( impact, person.npcId, this.clock.timeMin );
					if ( result ) this.questActionResult( result );
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
		if ( result ) this.questActionResult( result );

	}

	#cancelTransitSelection() {

		this.transitGameplay?.cancelSelection();
		this.input?.requestLock();

	}

	/** A quest has moved: the scenery, journal, objective, inventory and route follow at once. */
	#refreshQuestState() {

		for ( const job of this.quests.newlyOffered() ) this.view.toast.show( { title: job.title, text: 'New job in your journal.' } );
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

	/** The game takes the pointer from the player for a chat, panel or chooser of its own; the world plays on behind a chat or chooser. */
	#release() {

		if ( ! this.input ) return;
		this.pauseState.release( this.input.locked );
		this.input.exitLock();

	}

	/** Saves from the pause menu, which says how it went. */
	async #saveFromPause() {

		if ( ! this.persistence ) return;
		this.view.pause.setSave( 'saving' );
		try {

			await this.#saveCurrent();
			this.view.pause.setSave( 'saved' );

		} catch ( error ) {

			console.error( error );
			this.view.pause.setSave( 'failed' );

		}

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
			contacts: this.contacts.serialize(),
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

		this.view.inventory.setItems( this.#inventoryCards() );

	}

	/** The contacts screen: each contact with their portrait, what they are doing and whether they would pick up now. */
	#refreshContacts() {

		this.view.contacts.setContacts( contactCards( {
			contacts: this.contacts.list(),
			people: this.acquaintances,
			activityOf: ( npcId ) => this.#activityOf( npcId ),
			answerOf: ( npcId ) => this.#answerOf( npcId ),
			image: ( npcId ) => () => this.portraits?.portrait( { npcId } ) ?? Promise.resolve( null )
		} ) );

	}

	/** What a person's day has them doing now, or null for somebody the simulation does not hold. */
	#activityOf( npcId ) {

		try {

			return this.sim.behaviorAt( npcId, this.clock.timeMin )?.activity ?? null;

		} catch {

			return null;

		}

	}

	/** How this person takes a call now (Calls `answerOf`). */
	#answerOf( npcId ) {

		const npc = rememberedPerson( this.sim, npcId );
		const disposition = npc ? dispositionOf( npc, this.companion.categoryOf?.( npc.type ) ) : null;
		return answerOf( { npc, disposition, activity: npc ? this.#activityOf( npcId ) : null } );

	}

	/**
	 * Rings a contact from the contacts screen: the panels close and the world
	 * plays on while the phone (PhoneCalls) rings them. Nothing rings while a
	 * conversation with somebody here is open.
	 */
	#call( npcId ) {

		if ( ! this.contacts.has( npcId ) ) return;
		const open = this.interactor?.conversation;
		if ( open && ! open.call ) return;
		this.view.close();
		this.pauseState.held();
		this.view.setPaused( false );
		this.phone.call( npcId );

	}

	/** The person picked up: the conversation opens over the phone, with nobody's body moved; null when it cannot. */
	#answered( npcId ) {

		const npc = rememberedPerson( this.sim, npcId );
		if ( ! npc || this.interactor?.conversation ) return null;
		const name = this.quests.characterName( npcId );
		return this.interactor.call( { npcId, instance: name ? { ...npc, name } : npc, behavior: this.sim.behaviorAt( npcId, this.clock.timeMin ) } );

	}

	/** Where a call reaches the person (the district they are in) and how clear the line is, falling with the distance. */
	#reach( npcId ) {

		const position = this.npcContinuity?.actor( npcId )?.position;
		const feet = this.body?.feet;
		if ( ! position ) return { relay: '', signal: 0.5 };
		const metres = feet ? Math.hypot( position[ 0 ] - feet.x, position[ 2 ] - feet.z ) : 0;
		return { relay: this.locator?.district( position[ 0 ], position[ 2 ] ) ?? '', signal: Math.max( 0.35, 1 - metres / 2400 ) };

	}

	/** What the codex holds: the carried items, the people talked to and the places stood in, with their quests. */
	#refreshCodex() {

		if ( ! this.quests ) return;
		const cast = ( npcId ) => this.quests.entries.filter( ( { runtime } ) => Object.values( runtime.cast ).includes( npcId ) ).map( ( { definition } ) => definition.id );
		this.view.codex.setEntries( codexEntries( {
			cards: this.#inventoryCards(),
			people: this.acquaintances,
			places: [ ...this.discoveredLocations.values() ].map( ( location ) => this.#placeRecord( location ) ),
			quests: this.quests.view( this.clock.timeMin ),
			castOf: cast,
			personaOf: ( npcId ) => this.quests.persona( npcId ),
			// Each card asks for its picture as it comes into view.
			pictures: {
				person: ( npcId ) => () => this.portraits?.portrait( { npcId } ) ?? Promise.resolve( null ),
				place: ( parcelId ) => () => this.buildingShots?.building( parcelId ) ?? Promise.resolve( null )
			}
		} ) );

	}

	#refreshMapLocation() {

		const feet = this.body?.feet;
		if ( feet && this.currentLocation ) this.view.map.setLocation( this.#placeName( this.currentLocation ), this.locator.district( feet.x, feet.z ) );

	}

	/** A lot's name: the word on its building, else what it is used for and its lot; a district keeps its own. */
	#placeName( location ) {

		const parcel = this.locator?.parcelById.get( location?.id );
		if ( ! parcel ) return location?.name ?? '';
		const word = this.venues?.places.get( parcel.id )?.name;
		const use = parcel.label.slice( parcel.id.length ).trim();
		return word ?? `${use ? use[ 0 ].toUpperCase() + use.slice( 1 ) : 'Lot'} · ${parcel.id}`;

	}

	#placeRecord( location ) {

		const parcel = this.locator.parcelById.get( location.id );
		if ( ! parcel ) return { id: location.id, name: location.name };
		const [ x, z ] = parcel.ring.reduce( ( sum, [ px, pz ] ) => [ sum[ 0 ] + px / parcel.ring.length, sum[ 1 ] + pz / parcel.ring.length ], [ 0, 0 ] );
		return { id: parcel.id, name: this.#placeName( location ), use: parcel.label.slice( parcel.id.length ).trim(), district: this.locator.district( x, z ) };

	}

	/** The carried items as the inventory and the codex show them, a quest item with its mission model. */
	#inventoryCards() {

		return inventoryCards( this.#inventory(), this.quests.view( this.clock.timeMin ), ( questId, itemId ) => this.missionItems?.get( questId, itemId ) ?? null );

	}

	#setting( { key, value } ) {

		if ( key === 'fog' ) this.fog.density.value = value;
		else if ( key === 'exposure' ) this.exposure.base = value;
		else if ( key === 'crowd' ) this.crowd.capacity = value;
		else if ( key === 'voice' ) {

			// The settings and the chat's toggle say the same, whichever the player used.
			this.voice?.setEnabled( value === 'on' );
			this.view.settings.setValues( { voice: value } );
			this.view.dialog.setVoice( this.voice ? value === 'on' : null );

		}
		else if ( key === 'voiceVolume' ) this.voice?.setVolume( value );
		else if ( key === 'details' ) this.view.setDetails( this.details = value === 'on' );
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
		const air = room ? roomAir( room ) : this.lights.airColor( this.camera.position );
		this.#arrive( room ? this.locator.refs( feet.x, feet.z, room.parcelId ).find( ( place ) => place.kind === 'parcel' )?.id ?? null : null );

		// Crossing the threshold is what changes everything around the camera;
		// walking from one room to the next does not, and rebaking on that
		// would put six cube renders in every other frame.
		const crossed = Boolean( room ) !== this.indoors;
		this.indoors = Boolean( room );

		this.rooms.update( visible, feet, delta );
		this.fog.update( air, room ?? null, delta );
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
		if ( this.details ) this.view.stats.update( this.stats );

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
		// A cut is not a walk: the eye arrives adapted to wherever it was put.
		this.exposure?.settle();

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
export function prepareInteriorStreaming( stream, renderer, scene, camera, mrt, renderTarget = null, options = {} ) {

	const warmup = new Warmup( renderer, scene, camera, mrt, renderTarget, options );
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

/** Where a building's on-duty staff stand: just inside its entrance, and the step outside it a guest leaves by. */
function placesOf( doors, buildings ) {

	return new Map( doors.map( ( door ) => [ door.parcelId, {
		inside: door.inside.clone(),
		outside: door.outside.clone(),
		...interiorOccupancy( buildings.get( door.parcelId )?.interior, door.inside ),
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

/**
 * Every scheduled parcel position in the controller's validated JSON shape.
 * `routes`, the WalkRoutes, give a parcel without a door its doorstep.
 */
export function npcContinuityPlaces( atlas, doors, buildings, routes, transitRoutes = [] ) {

	const doorByParcel = new Map( doors.map( ( door ) => [ door.parcelId, door ] ) );
	const parcels = atlas.parcels.map( ( parcel ) => {

		const door = doorByParcel.get( parcel.id );
		const position = door
			? door.inside.toArray()
			: [ parcel.access.point[ 0 ], SIDEWALK_HEIGHT, parcel.access.point[ 1 ] ];
		// Every floor's anchors: a person at home sleeps in their own bed upstairs, and works at their own desk.
		const anchors = door
			? buildingAnchors( buildings.get( parcel.id )?.npc, buildings.get( parcel.id )?.interior )
				.map( ( anchor ) => ( { id: anchor.id, kind: anchor.kind, floor: anchor.floor, position: anchor.position.toArray(), heading: anchor.heading } ) )
			: [];
		// A leader shows the place from outside its entrance, where the player can see them; without a door,
		// from where its access path meets the pavement, since its access point lies on the lot line the building may fill.
		const doorstep = door ? door.outside.toArray() : routes.pavementEnd( parcel.id );
		return {
			kind: 'parcel', id: parcel.id, position,
			...( doorstep ? { doorstep } : {} ),
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

/** How the chat names the person in a conversation, and their role: their type's label from `labels`, else the type written out. A passer-by has no identity. */
function speakerOf( { instance }, labels = null ) {

	if ( ! instance ) return { name: 'Someone passing by', role: '' };
	return { name: TalkClient.nameOf( instance ), role: labels?.get( instance.type ) ?? ( instance.type ?? '' ).replace( /^quest[ _]/i, '' ).replace( /_/g, ' ' ) };

}

/** A new game opens on its story's prologue card: the main questline's, while the save has no play time; else null. */
export function openingCard( persistence, quests ) {

	const prologue = persistence?.unplayed ? quests.prologue() : null;
	return prologue ? { kind: 'prologue', ...prologue } : null;

}

/** The simulation's person a saved memory of talks names, or null when the city has no such person now. */
function rememberedPerson( sim, npcId ) {

	try {

		return sim.getNPC( npcId );

	} catch {

		return null;

	}

}

/** A person's name as the call screen's handle: the given name's initial and the family name, `K. O'CONNELL`. */
function handleOf( name = '' ) {

	const words = name.trim().split( /\s+/ ).filter( Boolean );
	if ( words.length < 2 ) return name.toUpperCase();
	return `${words[ 0 ][ 0 ]}. ${words.slice( 1 ).join( ' ' )}`.toUpperCase();

}

/** A modal owns both pointer capture and game actions until it closes. */
export function playableModalOpen( view, interactor ) {

	return Boolean( interactor?.conversation || view.panels.current || view.transit.open || ! view.summary.element.hidden || view.inspection && ! view.inspection.element.hidden );

}

/**
 * The light where a person stands, in the words the dialog layer tells them:
 * the sky's state (DayCycle) and whether they are indoors.
 */
export function lightWords( state = 'night', indoors = false ) {

	const sky = { night: 'night outside, dark but for the street lamps and the neon signs', dusk: 'dusk, the light going and the neon coming on',
		dawn: 'dawn, grey light coming up between the towers', day: 'day, flat daylight between the towers' }[ state ] ?? 'night outside';
	return indoors ? `indoors under the building's lights; ${sky}` : sky;

}

/**
 * What a companion reaches inside buildings, from what the world published:
 * each building's circulation (kept from load, so a building streamed out
 * is still known), the post a person works at (their role's home anchor), the
 * seat of their own home (in their apartment's rooms) and the free seat
 * nearest a body in its building. Each answers `{ position, parcelId, floor,
 * heading?, seated? }` or null.
 */
export function companionReach( { buildings, places, interiorRoutes, continuity, ways = null } ) {

	const plans = new Map();
	const supports = new Map();
	for ( const [ parcelId, source ] of buildings ) {

		if ( source?.npc ) supports.set( parcelId, { npc: source.npc, homes: homesOf( source ) } );
		const plan = source?.interior ? circulationOf( source ) : null;
		if ( plan ) plans.set( parcelId, plan );

	}
	const anchors = new Map( places.filter( ( place ) => place.kind === 'parcel' ).map( ( place ) => [ place.id, place.anchors ?? [] ] ) );
	const spot = ( parcelId, anchor, seated = false ) => anchor && {
		position: [ ...anchor.position ], parcelId, ...( Number.isInteger( anchor.floor ) ? { floor: anchor.floor } : {} ),
		...( Number.isFinite( anchor.heading ) ? { heading: anchor.heading } : {} ), ...( seated ? { seated: true } : {} )
	};
	const anchorOf = ( parcelId, id ) => anchors.get( parcelId )?.find( ( anchor ) => anchor.id === id ) ?? null;
	return {
		plan: ( parcelId ) => plans.get( parcelId ) ?? interiorRoutes?.plan( parcelId ) ?? null,
		/** Opens the door a gate names, the host's own door to a guest (Passage `open`); false when it is not loaded. */
		open: ( gate ) => ways?.open?.( gate ) ?? false,
		workSpot( npc ) {

			const parcelId = npc.job?.parcelId;
			const slot = parcelId ? supports.get( parcelId )?.npc.roles?.find( ( role ) => role.role === npc.job.role ) : null;
			return slot ? spot( parcelId, anchorOf( parcelId, slot.homeAnchor ) ) : null;

		},
		homeSpot( npc ) {

			const apartment = npc.home?.apartment;
			const support = apartment ? supports.get( npc.home.parcelId ) : null;
			const home = support?.homes.find( ( entry ) => entry.id === apartment.id );
			if ( ! home ) return null;
			const rooms = new Set( home.rooms );
			const seat = support.npc.anchors?.find( ( anchor ) => anchor.kind === 'seat' && rooms.has( anchor.room ) );
			return spot( npc.home.parcelId, seat && anchorOf( npc.home.parcelId, seat.id ), true );

		},
		seat( actor ) {

			if ( actor?.place.kind !== 'parcel' ) return null;
			const taken = ( anchor ) => ( continuity?.errandsUnderway ?? [] ).some( ( errand ) => {

				const other = continuity.actor( errand.npcId );
				return other && Math.hypot( other.position[ 0 ] - anchor.position[ 0 ], other.position[ 2 ] - anchor.position[ 2 ] ) < 0.5;

			} );
			const free = ( anchors.get( actor.place.id ) ?? [] )
				.filter( ( anchor ) => anchor.kind === 'seat' && Math.abs( anchor.position[ 1 ] - actor.position[ 1 ] ) < 1.5 && ! taken( anchor ) )
				.map( ( anchor ) => ( { anchor, metres: Math.hypot( anchor.position[ 0 ] - actor.position[ 0 ], anchor.position[ 2 ] - actor.position[ 2 ] ) } ) )
				.filter( ( { metres } ) => metres <= SEAT_REACH )
				.sort( ( a, b ) => a.metres - b.metres || a.anchor.id.localeCompare( b.anchor.id ) )[ 0 ];
			return free ? spot( actor.place.id, free.anchor, true ) : null;

		}
	};

}

