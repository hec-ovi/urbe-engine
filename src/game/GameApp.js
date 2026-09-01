import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { MaterialResolver } from '../building/MaterialResolver.js';
import { PbrMaterialFactory } from '../building/PbrMaterialFactory.js';
import { GameView } from '../ui/views/GameView.js';
import { GameConfig } from './data/GameConfig.js';
import { WorldSource } from './data/WorldSource.js';
import { Signals } from './data/Signals.js';
import { GroundBuilder, SIDEWALK_HEIGHT } from './ground/GroundBuilder.js';
import { pointInRing } from './ground/Polygons.js';
import { BuildingsLoader } from './city/BuildingsLoader.js';
import { Links } from './links/Links.js';
import { Transit } from './transit/Transit.js';
import { InteriorStream } from './city/InteriorStream.js';
import { Elevators } from './city/Elevators.js';
import { Neon } from './city/Neon.js';
import { StreetLamps } from './city/StreetLamps.js';
import { Dressing } from './props/Dressing.js';
import { LaneMarkings } from './city/LaneMarkings.js';
import { LitWindows } from './city/LitWindows.js';
import { RoomView } from './city/RoomView.js';
import { CityLights } from './light/CityLights.js';
import { NightSwitch } from './light/NightSwitch.js';
import { LightingSystem } from './light/LightingSystem.js';
import { RoomLights } from './light/RoomLights.js';
import { Haze } from './light/Haze.js';
import { QualityTier } from './look/QualityTier.js';
import { Exposure } from './look/Exposure.js';
import { NightFog } from './look/NightFog.js';
import { EnvironmentProbe } from './look/EnvironmentProbe.js';
import { LookPipeline } from './look/LookPipeline.js';
import { NightSky, SKY_COLOR } from './sky/NightSky.js';
import { Physics } from './physics/Physics.js';
import { WorldColliders } from './physics/WorldColliders.js';
import { PlayerBody, BODY_RADIUS } from './physics/PlayerBody.js';
import { Input } from './player/Input.js';
import { PlayerController } from './player/PlayerController.js';
import { Interactor } from './player/Interactor.js';
import { CharacterAssets } from './agents/CharacterAssets.js';
import { Crowd } from './agents/Crowd.js';
import { WalkRoutes } from './agents/WalkRoutes.js';
import { CarModels } from './agents/CarModels.js';
import { Traffic } from './agents/Traffic.js';
import { SimBridge } from './sim/SimBridge.js';
import { GameClock } from './time/GameClock.js';
import { stopsFor } from './time/DayCycle.js';
import { Locator } from './world/Locator.js';
import { Bookmarks } from './world/Bookmarks.js';
import { mapModel } from './world/MapModel.js';

const THEME = 'cyberpunk';
/** Past this a room is behind opaque walls and haze, so it is not drawn. */
const ROOM_VISIBLE_RADIUS = 32;
/** Air scattering is wide and weak indoors, tight and small on the street. */
const INDOOR_HAZE = { spread: 0.55, cap: 3 };
const OUTDOOR_HAZE = { spread: 0.28, cap: 2.4 };
const NIGHT_FOG_DENSITY = 0.003;
// A near plane this far out is still inside the player capsule, and it buys
// the depth precision that keeps coplanar facade layers from flickering.
const NEAR_PLANE = 0.2;
const FAR_PLANE = 900;

/**
 * One playable run of the city: mode=game. Loads the assembled world, builds
 * the night scene, puts a physical body on a sidewalk and hands it the mouse.
 * Everything it shows is generated data; nothing here invents a city.
 */
export class GameApp {

	constructor( config ) {

		this.config = config;
		this.view = new GameView( {
			onResume: () => this.input?.requestLock(),
			onCloseDialog: () => this.interactor?.close( this.clock )
		} );
		this.view.mount( document.body );
		this.stats = {
			frameMs: 16.7, gpuMs: 0, drawCalls: 0, triangles: 0,
			crowd: 0, cars: 0, interiors: 0, lights: 0, tier: '-'
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

		this.view.step( 'reading the world' );
		const source = new WorldSource( config );
		const { atlas, connections, buildings, unbuilt } = await source.load();
		this.locator = new Locator( atlas );
		this.clock = new GameClock( { startHour: config.startHour, scale: config.timeScale } );

		this.view.step( 'starting the renderer' );
		this.renderer = await RendererFactory.create( config.backend );
		// After init, because that is when the WebGPU-to-WebGL2 fallback has
		// already happened and the tier is a choice about cost, not backend.
		const backend = RendererFactory.actualBackend( this.renderer );
		this.tier = QualityTier.describe( config.quality, backend );
		this.lighting = LightingSystem.install( this.renderer, this.tier );
		this.exposure = new Exposure( this.renderer, config.exposure );
		document.body.prepend( this.renderer.domElement );

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( 72, window.innerWidth / window.innerHeight, NEAR_PLANE, FAR_PLANE );

		this.view.step( 'resolving materials' );
		const resolver = new MaterialResolver();
		await resolver.loadTheme( THEME );
		const factory = new PbrMaterialFactory( resolver );
		this.rooms = new RoomLights( factory, this.tier );

		this.view.step( 'laying the ground' );
		const ground = new GroundBuilder( atlas, factory ).build();
		this.scene.add( ground.group );

		this.view.step( `loading ${buildings.size} buildings` );
		const city = await new BuildingsLoader( factory ).load( buildings );
		this.scene.add( city.group );

		this.elevators = new Elevators( factory );
		this.stream = new InteriorStream( {
			factory, roomLights: this.rooms, elevators: this.elevators,
			haze: this.tier.haze ? INDOOR_HAZE : null
		} );
		this.stream.register( buildings, city.centers );
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
			new LitWindows( atlas, buildings ).build()
		);

		this.view.step( 'lighting the street' );
		const fixtures = [ ...neon.glows, ...lamps.glows, ...this.transit.glows ];
		this.lights = new CityLights( fixtures, this.lighting.capacity );
		this.scene.add( this.lights.group );
		this.roomView = new RoomView( this.stream.rooms, ROOM_VISIBLE_RADIUS );
		this.#hangHaze( fixtures );

		this.view.step( 'raising the sky' );
		this.sky = new NightSky( this.scene ).build( this.clock.hour );
		// Everything the city lights itself with, switched together by the hour:
		// taken off the built scene, so a new kind of lit surface joins by being
		// added to the world rather than by being registered here.
		this.night = new NightSwitch( this.lights )
			.addGroup( neon.group ).addGroup( lamps.group ).addGroup( city.group ).addGroup( this.transit.group ).addGroup( props.group );
		this.fog = new NightFog( this.scene, { density: NIGHT_FOG_DENSITY, color: SKY_COLOR } );
		this.probe = new EnvironmentProbe( this.renderer, this.scene, this.tier );

		this.view.step( 'building the physics world' );
		this.physics = await Physics.create();
		this.colliders = new WorldColliders( this.physics );
		this.colliders.addStatic( ground.colliderGeometry );
		this.colliders.addStatics( city.shellColliders.values() );
		this.colliders.addStatic( links.colliderGeometry );
		this.colliders.addStatics( this.transit.colliders.values() );
		this.colliders.addStatics( props.colliders.values() );
		this.colliders.addPosts( lamps.posts );
		this.stream.onColliderBand = ( id, geometry ) => this.colliders.addBand( id, geometry );
		this.stream.onDropBand = ( id ) => this.colliders.dropBand( id );

		this.view.step( 'waking the population' );
		this.sim = SimBridge.create( atlas, connections, buildings, { streetDensity: config.streetDensity } );
		this.signals = new Signals( connections.networks );
		const routes = new WalkRoutes( connections.networks );

		this.view.step( 'loading characters' );
		const assets = await CharacterAssets.load(
			config.maxCrowd,
			RendererFactory.actualBackend( this.renderer ) === 'webgpu'
		);
		this.scene.add( assets.group );
		this.crowd = new Crowd( {
			assets, routes, sim: this.sim, signals: this.signals,
			places: placesOf( city.doors ),
			capacity: config.maxCrowd,
			stress: config.stress
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
		const spawn = pickSpawn( connections.networks, atlas );
		this.body = new PlayerBody( this.physics, spawn.point );
		this.input = new Input( this.renderer.domElement );
		this.controller = new PlayerController( { body: this.body, camera: this.camera, input: this.input } );
		this.controller.lookAt( spawn.lookAt );
		this.bookmarks = new Bookmarks( { fixtures, rooms: () => this.stream.rooms, networks: connections.networks } );

		this.view.step( 'baking the environment' );
		this.probe.bake( spawn.point );
		this.look = new LookPipeline( this.renderer, this.scene, this.camera, this.tier );

		this.interactor = new Interactor( {
			crowd: this.crowd, doors: city.doors, sim: this.sim,
			controller: this.controller, elevators: this.elevators
		} );
		this.interactor.onConversation = ( conversation ) => this.view.dialog.show( conversation );

		this.input.onLockChange = ( locked ) => {

			this.view.pause.setVisible( ! locked );
			this.controller.frozen = ! locked;

		};

		this.view.minimap.setMap( mapModel( atlas ) );
		this.view.readout.setAbout( [
			config.blueprintUrl,
			`${config.outBase}/ (${buildings.size} built${unbuilt.length ? `, ${unbuilt.length} unbuilt` : ''})`,
			`/materials/${THEME}`,
			'/models/quaternius'
		] );
		this.view.pause.setVisible( true );
		this.view.ready();

		this.renderer.domElement.addEventListener( 'click', () => this.input.requestLock() );
		window.addEventListener( 'resize', () => this.#resize() );

		if ( import.meta.env.DEV ) window.__game = this;

		this.baseTriangles = city.triangles + links.triangles;
		this.last = performance.now();
		this.renderer.setAnimationLoop( () => this.#frame() );

	}

	#frame() {

		const now = performance.now();
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

		const day = this.sky.setHour( this.clock.hour );
		this.night.set( day.lampsOn );
		this.exposure.setDaylight( stopsFor( day.state ) );
		this.view.clock.setState( day.state );

		this.physics.step( delta );

		// Out of anyone the crowd walked into last frame before the camera is
		// placed, so the correction never shows up as a jolt a frame later.
		this.body.push( this.crowd.pushback( this.body.feet, BODY_RADIUS ) );
		this.controller.update( delta );

		const feet = this.body.feet;

		if ( this.stream.update( feet ) ) this.roomView.setRooms( this.stream.rooms );

		this.lights.update( this.camera.position, delta );
		this.crowd.update( delta, feet, this.clock );
		this.traffic.update( delta, feet, this.clock.daySeconds );
		this.transit.update( feet, this.clock.daySeconds );
		this.elevators.update( delta, this.body );
		this.#relight( feet, delta );

		const prompt = this.interactor.update( delta );
		this.view.prompt.update( this.input.locked ? prompt : null );

		if ( this.input.consume( 'KeyE' ) && this.input.locked ) {

			if ( this.interactor.conversation ) this.interactor.close( this.clock );
			else this.interactor.activate( this.clock );

		}

		if ( this.input.consume( 'KeyM' ) ) this.view.minimap.toggle();
		if ( this.input.consume( 'KeyI' ) ) this.view.inventory.toggle();
		if ( this.input.consume( 'Escape' ) ) this.input.exitLock();

		this.view.minimap.update( feet, this.controller.yaw );
		this.view.clock.update( this.clock.label, this.locator.district( feet.x, feet.z ) );
		this.view.readout.update( feet, this.locator.district( feet.x, feet.z ), this.locator.parcel( feet.x, feet.z ) );

		this.look.render();
		this.input.endFrame();

	}

	/**
	 * One pass over everything that decides where light comes from this frame:
	 * which rooms hold a light slot, what colour the air around the player is,
	 * whether the probe needs rebaking, and which exposure the camera is on.
	 */
	#relight( feet, delta ) {

		const visible = this.roomView.update( feet, delta );
		const room = this.#inside( visible, feet );

		this.standing = room;

		// Crossing the threshold is what changes everything around the camera;
		// walking from one room to the next does not, and rebaking on that
		// would put six cube renders in every other frame.
		const crossed = Boolean( room ) !== this.indoors;
		this.indoors = Boolean( room );

		this.rooms.update( visible, feet, delta );
		this.fog.update( room ? roomAir( room ) : this.lights.airColor( this.camera.position ), Boolean( room ), delta );
		this.probe.update( feet, crossed );
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
		this.view.stats.update( this.stats );

		this.renderer.resolveTimestampsAsync?.( 'render' ).catch( () => {} );
		this.renderer.resolveTimestampsAsync?.( 'compute' ).catch( () => {} );

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
function placesOf( doors ) {

	return new Map( doors.map( ( door ) => [ door.parcelId, {
		inside: door.inside.clone(),
		heading: Math.atan2( door.normal.x, door.normal.z )
	} ] ) );

}

/**
 * Start on a sidewalk in the middle of things, looking down the street rather
 * than at a wall: the walk node nearest the built centre, aimed at the corner
 * furthest from it.
 */
function pickSpawn( networks, atlas ) {

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
		point: new THREE.Vector3( best.x, SIDEWALK_HEIGHT + 0.05, best.z ),
		lookAt: new THREE.Vector3( target.x, SIDEWALK_HEIGHT, target.z )
	};

}
