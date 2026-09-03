import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { MaterialResolver } from '../building/MaterialResolver.js';
import { PbrMaterialFactory } from '../building/PbrMaterialFactory.js';
import { TalkClient } from './talk/TalkClient.js';
import { DialogueSpeech } from './voice/index.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestGameplay, questGameplayWorld } from './quests/QuestGameplay.js';
import { MissionItemAssets } from './quests/MissionItemAssets.js';
import { InvestigationGameplay } from './investigation/index.js';
import { ObjectiveRouter } from './routes/ObjectiveRouter.js';
import { ObjectiveGuide } from './routes/ObjectiveGuide.js';
import { GamePersistence, mergeInventory, mergeProgress, uniqueLocations } from './persistence/index.js';
import { groundAnchors } from './agents/Anchors.js';
import { GameView } from '../ui/views/GameView.js';
import { GameConfig } from './data/GameConfig.js';
import { WorldSource } from './data/WorldSource.js';
import { Signals } from './data/Signals.js';
import { GroundBuilder, SIDEWALK_HEIGHT } from './ground/GroundBuilder.js';
import { HydrologyHost } from './hydro/index.js';
import { pointInRing } from './ground/Polygons.js';
import { BuildingsLoader } from './city/BuildingsLoader.js';
import { Links } from './links/Links.js';
import { Transit } from './transit/Transit.js';
import { TransitJourney } from './transit/TransitJourney.js';
import {
	TransitGameplay, transitErrorMessage, transitServiceLabel, transitStatusLabel
} from './transit/TransitGameplay.js';
import { InteriorStream } from './city/InteriorStream.js';
import { Elevators } from './city/Elevators.js';
import { Neon } from './city/Neon.js';
import { StreetLamps } from './city/StreetLamps.js';
import { Dressing } from './props/Dressing.js';
import { LaneMarkings } from './city/LaneMarkings.js';
import { Crossings } from './city/Crossings.js';
import { LitWindows } from './city/LitWindows.js';
import { RoomView } from './city/RoomView.js';
import { Venues } from './city/Venues.js';
import { CityLights } from './light/CityLights.js';
import { NightSwitch } from './light/NightSwitch.js';
import { LightingSystem } from './light/LightingSystem.js';
import { RoomLights } from './light/RoomLights.js';
import { Haze } from './light/Haze.js';
import { QualityTier } from './look/QualityTier.js';
import { Exposure } from './look/Exposure.js';
import { NightFog } from './look/NightFog.js';
import { HitchLog } from './debug/HitchLog.js';
import { RenderWork } from './debug/RenderWork.js';
import { EnvironmentProbe } from './look/EnvironmentProbe.js';
import { LookPipeline } from './look/LookPipeline.js';
import { Warmup } from './look/Warmup.js';
import { NightSky, SKY_COLOR } from './sky/NightSky.js';
import { Physics, WorldColliders, PlayerBody, BODY_RADIUS, ImpactWorld } from './physics/index.js';
import { Input } from './player/Input.js';
import { PlayerController } from './player/PlayerController.js';
import { Interactor } from './player/Interactor.js';
import { CharacterAssets } from './agents/CharacterAssets.js';
import { HeroCharacter } from './agents/HeroCharacter.js';
import { GameplayAnimationDirector } from './GameplayAnimationDirector.js';
import { Crowd } from './agents/Crowd.js';
import { WalkRoutes } from './agents/WalkRoutes.js';
import { NpcContinuity } from './agents/NpcContinuity.js';
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
/** Past this a room is behind opaque walls and haze, so it is not drawn. */
const ROOM_VISIBLE_RADIUS = 32;
const NPC_VISIBLE_RADIUS = 115;
/** Air scattering is wide and weak indoors, tight and small on the street. */
const INDOOR_HAZE = { spread: 0.55, cap: 3 };
const OUTDOOR_HAZE = { spread: 0.28, cap: 2.4 };
// A near plane this far out is still inside the player capsule, and it buys
// the depth precision that keeps coplanar facade layers from flickering.
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

const NEAR_PLANE = 0.2;
const FAR_PLANE = 900;

/**
 * One playable run of the city: mode=game. Loads the assembled world, builds
 * the night scene, puts a physical body on a sidewalk and hands it the mouse.
 * Everything it shows is generated data; nothing here invents a city.
 */
export class GameApp {

	constructor( config, {
		navigate = ( path ) => window.location.assign( path ),
		speechConnect = () => DialogueSpeech.connect()
	} = {} ) {

		this.config = config;
		this.navigate = navigate;
		this.speechConnect = speechConnect;
		this.talk = new TalkClient( config.outBase );
		this.view = new GameView( {
			onResume: () => this.input?.requestLock(),
			onCloseDialog: () => {

				this.#cancelDialogueSpeech( 'player-left' );
				this.interactor?.close( this.clock );

			},
			onSend: ( text ) => this.#say( text ),
			onRecord: ( recording ) => this.#record( recording ),
			onOpen: () => this.input?.exitLock(),
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
			materials: 0, unresolved: 0, hitches: 0, worstMs: 0
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
		this.view.step( 'checking local speech' );
		this.speech = await this.speechConnect();

		this.view.step( 'reading the world' );
		const source = new WorldSource( config );
		const {
			atlas, connections, buildings, unbuilt, npcTypes, questlines, investigations,
			mechanicTargetBindings, missionAssetRequests, missionItemBindings, game
		} = await source.load();
		const transitRoutes = connections.networks.transit.routes;
		this.transitJourney = new TransitJourney( {
			atlas, routes: transitRoutes, ...( game?.transitJourney ? { state: game.transitJourney } : {} )
		} );
		this.persistence = game ? new GamePersistence( { game, gameId: config.gameId } ) : null;
		this.locator = new Locator( atlas, transitRoutes );
		this.clock = new GameClock( {
			startHour: transitStartHour(
				this.transitJourney,
				game?.npcState ? game.npcState.timeMin / 60 : config.startHour
			),
			scale: config.timeScale
		} );

		this.view.step( 'starting the renderer' );
		this.renderer = await RendererFactory.create( config.backend );
		// After init, because that is when the WebGPU-to-WebGL2 fallback has
		// already happened and the tier is a choice about cost, not backend.
		const backend = RendererFactory.actualBackend( this.renderer );
		this.tier = QualityTier.describe( config.quality, backend );
		this.stats.backend = backend;
		if ( config.off.has( 'bloom' ) ) this.tier.bloom = { strength: 0, radius: 0 };
		if ( config.off.has( 'haze' ) ) this.tier.haze = false;
		this.lighting = LightingSystem.install( this.renderer, this.tier );
		this.exposure = new Exposure( this.renderer, config.exposure );
		document.body.prepend( this.renderer.domElement );

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( 72, window.innerWidth / window.innerHeight, NEAR_PLANE, FAR_PLANE );

		this.view.step( 'resolving materials' );
		const resolver = new MaterialResolver();
		await resolver.loadTheme( THEME );
		this.resolver = resolver;
		const factory = new PbrMaterialFactory( resolver, this.tier );
		this.missionItems = new MissionItemAssets( {
			requests: missionAssetRequests,
			bindings: missionItemBindings,
			mechanicBindings: mechanicTargetBindings,
			materialCatalog: resolver.missionCatalog( THEME )
		} );
		this.rooms = new RoomLights( factory, this.tier );

		this.view.step( 'laying the ground' );
		const ground = new GroundBuilder( atlas, factory ).build();
		this.scene.add( ground.group );
		this.hydrology = await HydrologyHost.install( { blueprint: atlas, factory, scene: this.scene } );

		this.view.step( `loading ${buildings.size} buildings` );
		const city = await new BuildingsLoader( factory ).load( buildings );
		this.scene.add( city.group );

		this.elevators = new Elevators( factory );
		this.hitches = new HitchLog();
		this.work = new RenderWork( this.renderer.info );
		this.stream = new InteriorStream( {
			factory, roomLights: this.rooms, elevators: this.elevators,
			haze: this.tier.haze ? INDOOR_HAZE : null, hitches: this.hitches
		} );
		if ( ! config.off.has( 'interiors' ) ) this.stream.register( buildings, city.centers );
		this.scene.add( this.stream.group );

		this.view.step( 'hanging the neon' );
		const neon = new Neon( atlas, buildings, factory ).build();
		const lamps = new StreetLamps( atlas, factory, connections.networks.walk ).build();
		const links = new Links( connections, factory ).build();
		const props = new Dressing( atlas, connections.networks.walk, factory ).build();
		this.transit = new Transit( { atlas, networks: connections.networks, factory } );
		this.scene.add(
			neon.group,
			lamps.group,
			links.group,
			props.group,
			this.transit.group,
			new LaneMarkings( connections.networks, config.laneMode ).build(),
			new Crossings( atlas ).build(),
			new LitWindows( atlas, buildings ).build()
		);

		this.view.step( 'lighting the street' );
		const fixtures = [ ...neon.glows, ...lamps.glows, ...this.transit.glows ];
		this.lights = new CityLights( fixtures, this.lighting.capacity );
		this.scene.add( this.lights.group );
		this.roomView = new RoomView( this.stream.rooms, ROOM_VISIBLE_RADIUS );
		// A building you can walk into says so, and one with nothing behind its
		// facade says that too, by staying dark and offering no prompt.
		this.venues = new Venues( { atlas, buildings, doors: city.doors, fixtures, factory } );
		this.scene.add( this.venues.build( city.doors ) );
		this.#hangHaze( fixtures );

		this.view.step( 'raising the sky' );
		this.sky = new NightSky( this.scene ).build( this.clock.hour );
		// Everything the city lights itself with, switched together by the hour:
		// taken off the built scene, so a new kind of lit surface joins by being
		// added to the world rather than by being registered here.
		this.night = new NightSwitch( this.lights )
			.addGroup( neon.group ).addGroup( lamps.group ).addGroup( city.group ).addGroup( this.transit.group ).addGroup( props.group );
		this.fog = new NightFog( this.scene, config.off.has( 'fog' )
			? { density: 0, indoorDensity: 0, color: SKY_COLOR }
			: { density: config.fog, color: SKY_COLOR } );
		this.probe = config.off.has( 'probe' ) || this.tier.probeSize === 0
			? null
			: new EnvironmentProbe( this.renderer, this.scene, this.tier, this.hitches );
		this.probe?.exclude( this.stream.group, props.group, this.transit.group );
		if ( this.hydrology.group ) this.probe?.exclude( this.hydrology.group );

		this.view.step( 'building the physics world' );
		this.physics = await Physics.create();
		this.impactWorld = new ImpactWorld( this.physics );
		this.colliders = new WorldColliders( this.physics );
		this.colliders.addStatic( ground.colliderGeometry, 'ground' );
		await this.colliders.addStaticsAsync( city.shellColliders, { release: true } );
		city.shellColliders.clear();
		this.colliders.addStatic( links.colliderGeometry, 'building links' );
		this.colliders.addStatics( this.transit.colliders );
		this.colliders.addStatics( props.colliders );
		this.colliders.addPosts( lamps.posts );
		this.stream.onColliderBand = ( id, geometry ) => this.colliders.addBand( id, geometry );
		this.stream.onDropBand = ( id ) => this.colliders.dropBand( id );

		this.view.step( 'waking the population' );
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
			game ? [ ...game.quests, ...game.sideJobs ] : []
		);
		this.savedInventory = game?.player.inventory ?? [];
		this.questItemIds = questlines.flatMap( ( questline ) => questline.items.map( ( item ) => item.itemId ) );
		this.#refreshInventory();
		this.view.quests.setQuests( this.quests.view() );
		this.signals = new Signals( connections.networks );
		const routes = new WalkRoutes( connections.networks );
		const crowdPlaces = placesOf( city.doors, buildings );
		this.npcContinuity = new NpcContinuity( {
			simulation: this.sim,
			routes,
			places: npcContinuityPlaces( atlas, city.doors, buildings, transitRoutes )
		} );
		if ( game?.npcState?.continuity ) this.npcContinuity.restore( game.npcState.continuity );

		this.view.step( 'loading characters' );
		const assets = await CharacterAssets.load(
			config.maxCrowd,
			RendererFactory.actualBackend( this.renderer ) === 'webgpu'
		);
		this.scene.add( assets.group );
		this.probe?.exclude( assets.group );
		this.crowd = new Crowd( {
			assets, routes, sim: this.sim, signals: this.signals,
			places: crowdPlaces,
			capacity: config.maxCrowd,
			stress: config.stress,
			continuity: this.npcContinuity
		} );
		this.hero = await HeroCharacter.create( {
			animation: assets.animation,
			warmup: null
		} );
		this.scene.add( this.hero.group );
		this.animations = new GameplayAnimationDirector( {
			catalog: assets.animationCatalog,
			animation: assets.animation,
			crowd: this.crowd,
			hero: this.hero
		} );

		this.view.step( 'loading traffic' );
		const carModels = await CarModels.load( config.maxCars );
		this.scene.add( carModels.group );
		this.traffic = new Traffic( {
			networks: connections.networks, models: carModels,
			signals: this.signals, capacity: config.maxCars,
			seed: atlas.meta.seed
		} );

		this.view.step( 'stepping outside' );
		const spawn = game ? savedSpawn( game ) : pickSpawn( connections.networks, atlas );
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
		this.currentLocation = game?.currentLocation ?? this.locator.location( spawn.point.x, spawn.point.z );
		this.discoveredLocations = new Map(
			( game?.discoveredLocations ?? [ this.currentLocation ] ).map( ( location ) => [ location.id, location ] )
		);
		this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
		this.bookmarks = new Bookmarks( { fixtures, rooms: () => this.stream.rooms, networks: connections.networks } );
		this.questGameplay = new QuestGameplay( {
			session: this.quests,
			world: questGameplayWorld( atlas, city.doors ),
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
		this.objectiveGuide = new ObjectiveGuide( new ObjectiveRouter( connections.networks.walk ) );
		this.#refreshCurrentObjective();

		// Construct the scene pass before a WebGPU probe bake so its final
		// material programs can be warmed against that render context.
		this.view.step( 'warming the renderer' );
		this.look = new LookPipeline( this.renderer, this.scene, this.camera, this.tier );
		// Compiling the complete city here can occupy either backend for minutes.
		// Streamed floors are different: one small, detached band can compile while
		// it is still 70 m away, before walking makes it visible.
		this.floorWarmup = prepareInteriorStreaming(
			this.stream, this.renderer, this.scene, this.camera, this.look.mrt
		);

		this.view.step( 'baking the environment' );
		this.probe?.bake( spawn.point );
		this.interactor = new Interactor( {
			crowd: this.crowd, doors: city.doors, sim: this.sim,
			controller: this.controller, elevators: this.elevators, quests: this.questGameplay,
			investigations: this.investigations,
			continuity: this.npcContinuity,
			animations: this.animations
		} );
		this.interactor.onConversation = ( conversation ) => {

			if ( ! conversation ) this.#cancelDialogueSpeech( 'player-left' );
			this.view.dialog.show( conversation );
			this.view.avatar.setVisible( Boolean( conversation ) );

			if ( ! conversation ) return;
			if ( conversation.npcId ) this.#questEvent( { kind: 'talkedTo', npcId: conversation.npcId } );

			// The chat takes the mouse: the input wants focus and the panel a click.
			this.view.avatar.setAvatar( { name: conversation.instance?.name ?? 'someone passing by', bar: 1 } );
			this.input.exitLock();

		};

		this.input.onLockChange = ( locked ) => {

			this.controller.frozen = ! locked;

		};

		const map = mapModel( atlas, connections.networks );
		this.view.minimap.setMap( map );
		this.view.minimap.setVenues( this.venues.marks );
		this.view.map.setWorld( blockWorld( atlas, connections.networks ) );
		this.view.map.setVenues( this.venues.marks );
		this.#updateObjectiveRoute( 0, true );
		this.view.settings.setValues( { quality: this.tier.name, fog: config.fog, exposure: config.exposure, crowd: config.maxCrowd } );
		this.view.controls.setBindings( BINDINGS );
		this.view.readout.setAbout( [
			config.blueprintUrl,
			`${config.outBase}/ (${buildings.size} built${unbuilt.length ? `, ${unbuilt.length} unbuilt` : ''})`,
			`/materials/${THEME}`,
			'/models/quaternius'
		] );
		this.view.setPaused( true );
		this.view.ready();
		this.playStartedAt = performance.now();

		this.renderer.domElement.addEventListener( 'click', () => this.input.requestLock() );
		window.addEventListener( 'resize', () => this.#resize() );

		if ( import.meta.env.DEV ) window.__game = this;

		this.baseTriangles = city.triangles + links.triangles + ( this.hydrology.summary?.triangles ?? 0 );
		this.last = performance.now();
		this.renderer.setAnimationLoop( () => this.#frame() );

	}

	#frame() {

		const now = performance.now();
		// What the renderer built for itself last frame, before the gap that
		// carried it is printed: a link and an upload are blocking work the
		// world never asked for and could not otherwise name.
		const built = this.work.since();
		if ( built ) this.hitches.note( built );
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

		this.clock.advance( delta );
		this.hydrology.update( Math.max( 0, ( performance.now() - this.playStartedAt ) / 1000 ) );

		const day = this.sky.setHour( this.clock.hour );
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

		this.hitches.time( 'interior stream', () => {

			if ( this.stream.update( feet ) ) this.roomView.setRooms( this.stream.rooms );

		} );

		this.lights.update( this.camera.position, delta );
		this.hitches.time( 'crowd', () => {

			this.npcContinuity.updateFollow( {
				timeMin: this.clock.timeMin,
				deltaSeconds: delta,
				playerPosition: feet.toArray()
			} );
			const actors = this.npcContinuity.updateVisible( {
				timeMin: this.clock.timeMin,
				playerPosition: feet.toArray(),
				maxDistance: NPC_VISIBLE_RADIUS
			} );
			this.crowd.syncActors( actors, feet );
			this.animations.update( actors, delta );
			this.crowd.update( delta, feet, this.clock );

		} );
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

		const playerPlaces = questPlayerPlaces( this.locator, feet, this.standing?.parcelId ?? null );
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

		if ( this.input.consume( 'KeyE' ) && this.input.locked ) {

			const owner = playableInteractionOwner( this.interactor, transitFrame );
			if ( owner === 'conversation' ) this.interactor.close( this.clock );
			else if ( owner === 'world' ) this.#questActionResult( this.interactor.activate( this.clock ) );
			else this.#transitAction( this.transitGameplay.activate(), playerPlaces );

		}
		if ( this.input.consume( 'KeyR' ) && this.input.locked && ! this.interactor.conversation && ! transitFrame.aboard ) {

			this.#questActionResult( this.interactor.activate( this.clock, 'secondary-interact' ) );

		}

		// A panel or the chat owns the keyboard while it is up; the game's own
		// keys only fire on the street.
		const free = ! this.view.panels.current && ! this.interactor.conversation && ! this.view.transit.open;

		if ( free ) {

			for ( const [ code, panel ] of PANEL_KEYS ) if ( this.input.consume( code ) ) this.view.toggle( panel );
			if ( this.input.consume( 'KeyN' ) || ( this.input.consume( 'Escape' ) && this.input.locked ) ) this.input.exitLock();

		}

		this.view.setPaused( ! this.input.locked && free );
		this.#updateObjectiveRoute( delta );
		this.view.minimap.update( feet, this.controller.yaw );
		if ( this.view.panels.current === 'MAP' ) this.view.map.setPlayer( feet, this.controller.yaw );
		this.hitches.time( 'location HUD', () => {

			const district = this.locator.district( feet.x, feet.z );
			this.currentLocation = this.locator.location( feet.x, feet.z );
			this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
			this.view.clock.update( this.clock.label, district );
			this.view.readout.update( feet, district, this.locator.parcel( feet.x, feet.z ) );

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

	/** A setting changed in the HUD: the ones that are uniforms apply on the spot, the tier reloads the run. */
	/** The player's line goes to the person in front of them; their answer lands in the same panel. */
	async #say( text ) {

		this.view.dialog.addMessage( { from: 'player', name: 'you', text } );
		const conversation = this.interactor?.conversation;
		if ( ! conversation?.instance ) return;
		this.#cancelDialogueSpeech( 'new-line' );
		const turn = ( this.dialogueTurn ?? 0 ) + 1;
		this.dialogueTurn = turn;
		this.speech?.cancelTranscription();
		this.view.dialog.setRecording( false );
		const unlock = this.speech
			? this.speech.unlock().then( () => null, ( error ) => error )
			: Promise.resolve( null );
		this.animations.playerDialogueTurn( conversation );
		this.animations.completeDialogueTurn( conversation );

		const name = TalkClient.nameOf( conversation.instance );
		let reply;
		try { reply = await this.talk.say( conversation, text, this.clock.timeMin, this.quests.snapshot() ); }
		catch ( error ) {

			console.warn( 'talk:', error.message );
			if ( this.interactor.conversation === conversation && turn === this.dialogueTurn ) {

				this.view.dialog.addMessage( { from: 'npc', name, text: '...' } );

			}
			return;

		}
		if ( this.interactor.conversation !== conversation || turn !== this.dialogueTurn ) return;
		this.view.dialog.addMessage( { from: 'npc', name, text: reply } );
		const audioError = await unlock;
		if ( audioError ) {

			this.#speechError( audioError );
			return;

		}
		if ( this.interactor.conversation !== conversation || turn !== this.dialogueTurn ) return;
		if ( ! this.speech ) return;
		try {

			await this.speech.speak( conversation, reply, {
				onPlaybackStart: () => {

					if ( this.interactor.conversation === conversation && turn === this.dialogueTurn ) {

						this.animations.npcDialogueTurn( conversation );

					}

				},
				onPlaybackEnd: () => {

					if ( this.interactor.conversation === conversation && turn === this.dialogueTurn ) {

						this.animations.completeDialogueTurn( conversation );

					}

				}
			} );

		} catch ( error ) {

			if ( this.interactor.conversation === conversation && turn === this.dialogueTurn ) {

				this.animations.completeDialogueTurn( conversation );
				this.#speechError( error );

			}

		}

	}

	async #record( recording ) {

		if ( ! this.speech ) return;
		if ( recording ) {

			try {

				const [ , started ] = await Promise.all( [ this.speech.unlock(), this.speech.startTranscription() ] );
				this.view.dialog.setRecording( started === true );

			} catch ( error ) {

				this.speech.cancelTranscription();
				this.view.dialog.setRecording( false );
				this.#speechError( error );

			}
			return;

		}

		this.view.dialog.setRecording( false );
		try {

			const result = await this.speech.stopTranscription();
			if ( result?.text && this.interactor?.conversation ) await this.#say( result.text );

		} catch ( error ) { this.#speechError( error ); }

	}

	#cancelDialogueSpeech( reason ) {

		const conversation = this.interactor?.conversation;
		if ( conversation ) this.animations?.completeDialogueTurn( conversation );
		this.speech?.cancel( reason );
		this.speech?.cancelTranscription();
		this.view.dialog.setRecording( false );

	}

	#speechError( error ) {

		console.warn( 'speech:', error.message );
		this.view.toast.show( { title: 'Speech unavailable', text: error.message } );

	}

	/** Stepping into a building's rooms is arriving there for the story; the street in between is not a place. */
	#arrive( parcelId ) {

		if ( parcelId === this.parcelStanding ) return;

		this.parcelStanding = parcelId;
		if ( parcelId ) this.#questEvent( { kind: 'arrivedAt', parcelId } );

	}

	/** A player event goes to every questline; what it completed shows as a toast, an ending as the summary. */
	#questEvent( event ) {

		const moved = this.quests.advance( event, this.clock.timeMin );
		if ( moved.length === 0 ) return;

		for ( const { definition, completed, ending } of moved ) {

			for ( const step of completed ) this.view.toast.show( { title: definition.title, text: step.narrative.description } );
			if ( ending ) this.view.summary.show( { title: ending.title, text: ending.epilogue, outcome: 'done' } );

		}

		this.#refreshQuestState();

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
		this.#transitQuestEvent( action, playerPlaces );
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
		if ( this.interactor?.conversation?.person === person ) this.interactor.close( this.clock, 'physics' );
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
		this.#transitAction( this.transitGameplay?.board( service ), places );
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

	#refreshQuestState() {

		this.view.quests.setQuests( this.quests.view() );
		this.#refreshCurrentObjective();
		this.#refreshInventory();
		this.#updateObjectiveRoute( 0, true );

	}

	#refreshCurrentObjective() {

		this.view.setObjective( currentObjectiveView( this.questGameplay, this.quests, this.clock.timeMin ) );

	}

	#updateObjectiveRoute( deltaSeconds, force = false ) {

		if ( ! this.objectiveGuide || ! this.questGameplay || ! this.body ) return;
		const feet = this.body.feet;
		const objective = this.questGameplay.objective( this.clock.timeMin );
		const destination = objective?.guidance?.destination ?? null;

		try {

			const result = this.objectiveGuide.update( {
				deltaSeconds,
				from: [ feet.x, feet.y, feet.z ],
				destination,
				...( force ? { force: true } : {} )
			} );
			if ( ! result.changed ) return;
			const route = result.route ? {
				path: result.route.path3.map( ( point ) => [ point[ 0 ], point[ 2 ] ] ),
				label: objective.text
			} : null;
			this.view.minimap.setRoute( route );
			this.view.map.setRoute( route );

		} catch ( error ) {

			console.warn( 'objective route:', error.message );
			this.view.minimap.setRoute( null );
			this.view.map.setRoute( null );

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

	#saveCurrent() {

		const feet = this.body.feet;
		this.currentLocation = this.locator.location( feet.x, feet.z );
		this.discoveredLocations.set( this.currentLocation.id, this.currentLocation );
		const progress = mergeProgress( this.persistence.game, this.quests.persistenceView() );

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
			npcState: {
				timeMin: this.clock.timeMin,
				simulation: this.sim.serialize(),
				continuity: this.npcContinuity.serialize()
			},
			elapsedSeconds: Math.max( 0, ( performance.now() - this.playStartedAt ) / 1000 )
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
		this.#arrive( room?.parcelId ?? null );

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

		if ( holds( this.standing, feet ) && this.standing.group.visible ) return this.standing;

		for ( const room of visible ) {

			if ( holds( room, feet ) ) return room;

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
		this.stats.gpuMs = ( info.render.timestamp ?? 0 ) + ( info.compute.timestamp ?? 0 );
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

		this.renderer.resolveTimestampsAsync?.( 'render' ).catch( () => {} );
		this.renderer.resolveTimestampsAsync?.( 'compute' ).catch( () => {} );

	}

	/**
	 * The resolution count, and the keys behind it the first time one fails.
	 * A key the database cannot answer renders magenta and is named here; it
	 * never takes the load down, because a world can name a brand whose assets
	 * are not on this machine (../materials/CONTRACT.md).
	 */
	#materials() {

		const { resolved, unresolved } = this.resolver.counts;

		this.stats.materials = resolved;

		if ( unresolved > this.stats.unresolved ) {

			this.stats.unresolved = unresolved;
			console.warn( `unresolved material keys: ${this.resolver.report().unresolved.join( ', ' )}` );

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

		this.body.teleport( pose.point );
		this.controller.yaw = pose.yaw;
		this.controller.pitch = pose.pitch;
		this.controller.update( 0 );
		// The probe rebakes itself on the next step, once the rooms around the
		// camera have taken their light slots and are worth reflecting.
		this.indoors = undefined;

		return true;

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
export function prepareInteriorStreaming( stream, renderer, scene, camera, mrt ) {

	const warmup = new Warmup( renderer, scene, camera, mrt );
	stream.warmup = warmup;

	return warmup;

}

/** Whether a point stands on this room's floor, inside its outline. */
function holds( room, feet ) {

	return Boolean( room )
		&& feet.y >= room.elevation - 0.5
		&& feet.y <= room.elevation + room.height
		&& pointInRing( feet.x, feet.z, room.polygon );

}

/**
 * The light filling a room's air: its own fixtures' flux spread over its own
 * surfaces, which is the mean illuminance in it, and their colour. Same shape
 * as the street's, so the fog reads one or the other without knowing which.
 */
function roomAir( room ) {

	return { color: room.color, lux: room.flux / Math.max( 1, room.area ) };

}

/** Where a building's on-duty staff stand: just inside its entrance. */
function placesOf( doors, buildings ) {

	return new Map( doors.map( ( door ) => [ door.parcelId, {
		inside: door.inside.clone(),
		heading: Math.atan2( door.normal.x, door.normal.z ),
		anchors: groundAnchors( buildings.get( door.parcelId )?.npc, door.inside.y )
	} ] ) );

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
			? Object.values( groundAnchors( buildings.get( parcel.id )?.npc, door.inside.y ) )
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
export function pickSpawn( networks, atlas ) {

	const centre = atlas.parcels.reduce(
		( acc, p ) => [ acc[ 0 ] + p.access.point[ 0 ] / atlas.parcels.length, acc[ 1 ] + p.access.point[ 1 ] / atlas.parcels.length ],
		[ 0, 0 ]
	);

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

export function playableInteractionOwner( interactor, transitFrame ) {

	if ( interactor?.conversation ) return 'conversation';
	if ( ! transitFrame?.aboard && interactor?.target ) return 'world';
	return 'transit';

}

/** Current quest projection for the persistent objective widget. */
export function currentObjectiveView( gameplay, session, timeMin ) {

	const active = gameplay?.objective( timeMin );
	if ( active ) return { title: active.title, objective: active.text, state: 'active' };
	const completed = [ ...( session?.view() ?? [] ) ].reverse().find( ( quest ) => quest.state === 'done' );
	if ( ! completed ) return null;
	const lastStep = [ ...completed.steps ].reverse().find( ( step ) => step.done );
	return {
		title: completed.title,
		objective: lastStep?.text ?? completed.text,
		state: 'done'
	};

}
