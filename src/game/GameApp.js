import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { MaterialResolver } from '../building/MaterialResolver.js';
import { PbrMaterialFactory } from '../building/PbrMaterialFactory.js';
import { GameView } from '../ui/views/GameView.js';
import { GameConfig } from './data/GameConfig.js';
import { WorldSource } from './data/WorldSource.js';
import { Signals } from './data/Signals.js';
import { GroundBuilder, SIDEWALK_HEIGHT } from './ground/GroundBuilder.js';
import { BuildingsLoader } from './city/BuildingsLoader.js';
import { Neon } from './city/Neon.js';
import { StreetLamps } from './city/StreetLamps.js';
import { LaneGlow } from './city/LaneGlow.js';
import { LitWindows } from './city/LitWindows.js';
import { LightBudget } from './city/LightBudget.js';
import { NightSky } from './sky/NightSky.js';
import { Physics } from './physics/Physics.js';
import { WorldColliders } from './physics/WorldColliders.js';
import { PlayerBody } from './physics/PlayerBody.js';
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
import { Locator } from './world/Locator.js';
import { mapModel } from './world/MapModel.js';

const THEME = 'cyberpunk';
const INTERIOR_VISIBLE_RADIUS = 70;
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
		this.stats = { frameMs: 16.7, gpuMs: 0, drawCalls: 0, triangles: 0, crowd: 0, cars: 0, interiors: 0 };

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
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.5;
		document.body.prepend( this.renderer.domElement );

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( 72, window.innerWidth / window.innerHeight, NEAR_PLANE, FAR_PLANE );

		this.view.step( 'resolving materials' );
		const resolver = new MaterialResolver();
		await resolver.loadTheme( THEME );
		const factory = new PbrMaterialFactory( resolver );

		this.view.step( 'laying the ground' );
		const ground = new GroundBuilder( atlas, factory ).build();
		this.scene.add( ground.group );

		this.view.step( `loading ${buildings.size} buildings` );
		const city = await new BuildingsLoader( factory ).load( buildings );
		this.scene.add( city.group );
		this.interiors = city.interiors;

		this.view.step( 'hanging the neon' );
		const neon = new Neon( atlas, buildings, factory ).build();
		const lamps = new StreetLamps( atlas, factory ).build();
		this.scene.add(
			neon.group,
			lamps.group,
			new LaneGlow( connections.networks, config.laneDebug ).build(),
			new LitWindows( atlas, buildings ).build()
		);
		this.lights = new LightBudget( [ ...neon.glows, ...lamps.glows ] );
		this.scene.add( this.lights.group );

		this.view.step( 'raising the sky' );
		this.sky = new NightSky( this.renderer, this.scene ).build( this.clock.hour );
		this.sky.bakeEnvironment();

		this.view.step( 'building the physics world' );
		this.physics = await Physics.create();
		this.colliders = new WorldColliders( this.physics );
		this.colliders.addGround( ground.colliderGeometry );
		this.colliders.addShells( city.shellColliders );
		this.colliders.registerInteriors( city.interiors );

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

		this.interactor = new Interactor( {
			crowd: this.crowd, doors: city.doors, sim: this.sim, controller: this.controller
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

		this.baseTriangles = city.triangles;
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
		this.sky.setHour( this.clock.hour );

		this.physics.step( delta );
		this.controller.update( delta );

		const feet = this.body.feet;
		this.colliders.update( feet );
		this.lights.update( this.camera.position, delta );
		this.crowd.update( delta, feet, this.clock );
		this.traffic.update( delta, feet, this.clock.daySeconds );
		this.#cullInteriors( feet );

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

		this.renderer.render( this.scene, this.camera );
		this.input.endFrame();

	}

	/**
	 * Interiors sit in the world permanently so a doorway is see-through, but
	 * an interior more than a block away is behind opaque walls and fog.
	 */
	#cullInteriors( position ) {

		for ( const entry of this.interiors.values() ) {

			entry.group.visible = entry.center.distanceTo( position ) < INTERIOR_VISIBLE_RADIUS;

		}

	}

	#measure( frameMs ) {

		const info = this.renderer.info;
		this.stats.frameMs = this.stats.frameMs * 0.9 + frameMs * 0.1;
		this.stats.drawCalls = info.render.drawCalls;
		this.stats.triangles = info.render.triangles || this.baseTriangles;
		this.stats.gpuMs = info.render.timestamp ?? 0;
		this.stats.crowd = this.crowd.count;
		this.stats.cars = this.traffic.count;
		this.stats.interiors = this.colliders.liveInteriors;
		this.view.stats.update( this.stats );

		this.renderer.resolveTimestampsAsync?.( 'render' ).catch( () => {} );

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
