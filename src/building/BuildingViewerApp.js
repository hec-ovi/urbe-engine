import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { QualityTier } from '../game/look/QualityTier.js';
import { NightLook } from '../game/look/NightLook.js';
import { Warmup } from '../game/look/Warmup.js';
import { CityLights } from '../game/light/CityLights.js';
import { ScenicSurface } from '../game/city/ScenicSurface.js';
import { shellGlows } from '../game/city/ShellFixtures.js';
import { StreetLamps } from '../game/city/StreetLamps.js';
import { LitWindows } from '../game/city/LitWindows.js';
import { isSceneryNode, shellMaterial, shellScenery, shellVariant } from '../game/city/ShellSurface.js';
import { BuildingAssetError, BuildingAssets } from './BuildingAssets.js';
import { BuildingStage } from './BuildingStage.js';
import { MaterialResolver } from './MaterialResolver.js';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';
import { FloorSlicer } from './FloorSlicer.js';
import { PreviewProgress } from './PreviewProgress.js';
import { BuildingView } from '../ui/views/BuildingView.js';

const DEFAULT_THEME = 'cyberpunk';
/** One building's HDR frame is not worth paying for twice on a dense display. */
const MAX_PIXEL_RATIO = 2;
/** How long the preview prepares before showing the building regardless. */
const PREPARE_BUDGET_MS = 15000;

/**
 * One building viewer run, described by the URL query:
 * ?mode=building&parcel=p1640[&out=/out/small][&source=shell|interior][&backend=webgpu|webgl][&quality=high].
 * W A S D walk, Q and E go down and up, drag to look, Shift is fast; nothing zooms.
 *
 * It loads the assembled building from /out/<parcel>/ and shows it the way the
 * game shows it: the same night look (game/look/NightLook.js), the same surface
 * rules (game/city/ShellSurface.js) and the building's own fixtures in lumens
 * (game/city/ShellFixtures.js), so what is judged here is the model and its
 * materials rather than a second, kinder lighting rig.
 */
export class BuildingViewerApp {

	static configFromUrl() {

		const params = new URLSearchParams( window.location.search );

		return {
			parcel: params.get( 'parcel' ) ?? 'p1640',
			out: params.get( 'out' ) ?? '/out',
			source: [ 'shell', 'interior' ].includes( params.get( 'source' ) ) ? params.get( 'source' ) : 'shell',
			backend: params.get( 'backend' ) === 'webgl' ? 'webgl' : 'webgpu',
			// Unset follows the backend, exactly as a played run does.
			quality: QualityTier.names().includes( params.get( 'quality' ) ) ? params.get( 'quality' ) : null
		};

	}

	constructor( config ) {

		this.config = config;
		this.view = new BuildingView( {
			parcel: config.parcel,
			onSourceChange: ( source ) => this.navigate( { source } ),
			onSliceChange: ( value ) => this.slicer?.apply( value ),
			onRetry: () => window.location.reload(),
			onExterior: () => this.navigate( { source: 'shell' } )
		} );
		this.view.mount( document.body );

	}

	navigate( patch ) {

		const params = new URLSearchParams( window.location.search );
		params.set( 'mode', 'building' );
		for ( const [ key, value ] of Object.entries( patch ) ) params.set( key, value );
		window.location.search = params.toString();

	}

	async start() {

		try {

			await this.#run();

		} catch ( error ) {

			console.error( error );
			const source = this.config.source;
			const state = error.state === 'unavailable' ? 'unavailable' : 'failed';
			const rawDetails = error.details ?? String( error.stack ?? error );
			const details = error.code && ! String( rawDetails ).startsWith( `${error.code}:` )
				? `${error.code}: ${rawDetails}`
				: rawDetails;
			this.view.setSource( source, false );
			this.view.setStatus( `${this.config.parcel} · ${source} · ${state}`, state );
			this.view.showIssue( {
				state,
				title: `${source === 'interior' ? 'interior' : 'exterior'} ${state}`,
				message: error.message ?? 'The preview could not be loaded.',
				details,
				exterior: source === 'interior'
			} );

		}

	}

	async #run() {

		const { parcel, out, backend, source, quality } = this.config;
		const assets = new BuildingAssets( parcel, out );
		this.view.clearIssue();
		const progress = new PreviewProgress(
			( text ) => this.view.setStatus( `${parcel} · ${source} · ${text}`, 'loading' )
		);

		await progress.run( 'requesting the build', () => assets.ensure( source ) );

		const [ blueprint, selected, interior, world ] = await progress.run( 'reading the world', () => Promise.all( [
			assets.loadBlueprint(),
			assets.inspectScene( source ),
			source === 'interior' ? Promise.resolve( null ) : assets.inspectScene( 'interior' ),
			assets.loadWorld()
		] ) );

		if ( ! selected.available ) throw new BuildingAssetError(
			selected.state, selected.code, selected.message, selected.details
		);
		this.view.setSource( source, source === 'interior' || interior.available );

		const look = await progress.run( 'starting the renderer', async () => {

			this.renderer = await RendererFactory.create( backend );
			this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, MAX_PIXEL_RATIO ) );
			document.body.prepend( this.renderer.domElement );

			return NightLook.begin( this.renderer, { quality, backend: RendererFactory.actualBackend( this.renderer ) } );

		} );
		this.look = look;
		const actualBackend = RendererFactory.actualBackend( this.renderer );

		const factory = await progress.run( 'resolving materials', async () => {

			const resolver = this.resolver = new MaterialResolver();
			await resolver.loadTheme( DEFAULT_THEME );

			return new PbrMaterialFactory( resolver, look.tier );

		} );

		this.slicer = new FloorSlicer( blueprint.floors );
		this.view.setFloorOptions( this.slicer.options() );

		// A parcel whose interior is generated shows that interior in the game,
		// so its painted rooms are the shell's only where none exists.
		const hasInterior = source === 'interior' || interior.available;
		const building = await progress.run( 'reading the model', async () => {

			const scene = await assets.loadScene( source, selected );
			this.#dressSurfaces( scene, { factory, blueprint, parcel, hasInterior } );

			return scene;

		} );

		const bounds = new THREE.Box3().setFromObject( building );
		const stage = BuildingStage.build( bounds, this.renderer.domElement, {
			facing: facadeNormal( blueprint ),
			onLockChange: ( captured, failed ) => this.view.setCameraCaptured( captured, failed )
		} );
		stage.scene.add( building );
		Object.assign( this, stage ); // scene, camera, controls

		await progress.run( 'lighting the street', async () => {

			look.raise( this.scene ).compose( this.camera );

			// What lights this building in the city: the fixtures it carries
			// itself and the street's lamps, each where the world puts them.
			// Other parcels' own fixtures stay out, because their buildings are
			// not on this stage.
			this.lights = new CityLights( [
				...shellGlows( { parcelId: parcel, blueprint, hasInterior } ),
				...( world ? StreetLamps.plan( world.atlas, world.walk ).glows : [] )
			], look.lighting.capacity );
			this.scene.add( this.lights.group );
			if ( world ) this.scene.add( this.#litWindows( { world, blueprint, parcel, hasInterior, factory } ) );

		} );

		// Decoded, uploaded and compiled before anything is judged on it, and
		// before the probe bakes the surfaces it will reflect. It runs against a
		// budget: a machine that cannot finish it in that time gets its first
		// frame anyway, with the rest compiled as it draws.
		const prepared = await progress.run( 'preparing surfaces', () => this.#prepare( look, progress ) );

		await progress.run( 'baking reflections', async () => look.probe?.bake( this.camera.position ) );

		if ( import.meta.env.DEV ) window.__viewer = this; // headless verification handle

		this.view.setReport( this.resolver.report() );
		this.view.setStatus(
			`${parcel} · ${source} · ready · ${actualBackend} · ${look.tier.name}${prepared.note}`,
			'ready'
		);
		console.info( `building preview: ${progress.timeline}` );

		window.addEventListener( 'resize', () => this.resize() );
		let last = performance.now();
		this.renderer.setAnimationLoop( () => {

			const now = performance.now();
			const delta = Math.min( 0.05, ( now - last ) / 1000 );
			last = now;
			this.controls.update();
			this.lights.update( this.camera.position, delta );
			this.look.render();

		} );

	}

	/**
	 * Every map decoded and every pipeline compiled before the first frame, for
	 * as long as the budget allows. What is left over compiles on the frame that
	 * first draws it, which costs a stutter rather than a wait.
	 */
	async #prepare( look, progress ) {

		const warmup = new Warmup(
			this.renderer, this.scene, this.camera, look.pipeline.mrt, look.pipeline.renderTarget
		);
		const started = performance.now();
		let done = 0;
		let total = 0;

		await warmup.warmAll( this.scene, {
			wanted: () => performance.now() - started < PREPARE_BUDGET_MS,
			onProgress: ( completed, count ) => {

				done = completed;
				total = count;
				progress.step( completed, count );

			}
		} );

		if ( done >= total ) return { done, total, note: '' };

		console.warn(
			`building preview: prepared ${done} of ${total} surfaces in ${PREPARE_BUDGET_MS / 1000}s and went on. `
			+ 'Preparation waits for animation frames, which a browser stops for a window it cannot see.'
		);

		return { done, total, note: ` · prepared ${done}/${total}` };

	}

	/** The rooms the city paints behind a closed shell's plain windows. */
	#litWindows( { world, blueprint, parcel, hasInterior, factory } ) {

		const rooms = new LitWindows( world.atlas, new Map( [ [ parcel, { blueprint, hasInterior } ] ] ), factory ).build();
		rooms.traverse( ( node ) => { if ( node.material ) this.slicer.attach( node.material ); } );

		return rooms;

	}

	/**
	 * Every surface of the loaded model, wearing what the city gives it: the
	 * catalog material for its key and variant, the fake rooms behind its
	 * windows carrying their baked light, and the floor slice on all of them.
	 */
	#dressSurfaces( building, { factory, blueprint, parcel, hasInterior } ) {

		building.updateMatrixWorld( true );
		const meshes = [];
		building.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const scenic = new ScenicSurface( blueprint );
		// One baked material per catalog surface, as the city merges them.
		const baked = new Map();
		const dress = ( material ) => {

			const built = materialForViewerSurface( factory, material, { parcel, blueprint } );
			this.slicer.attach( built );

			return built;

		};

		for ( const node of meshes ) {

			if ( isSceneryNode( node ) ) {

				// Scenery bakes to world space, so it is rehung on the model root.
				const geometry = shellScenery( node, factory, {
					key: node.material?.name ?? '', hasInterior, scenic
				} );
				node.removeFromParent();
				if ( ! geometry ) continue;

				const base = dress( node.material );
				if ( geometry.hasAttribute( 'scenicRadiance' ) && ! baked.has( base ) ) {

					const material = ScenicSurface.material( base );
					this.slicer.attach( material );
					baked.set( base, material );

				}

				const mesh = new THREE.Mesh(
					geometry, geometry.hasAttribute( 'scenicRadiance' ) ? baked.get( base ) : base
				);
				mesh.name = node.name;
				building.add( mesh );
				continue;

			}

			node.material = Array.isArray( node.material )
				? node.material.map( dress )
				: dress( node.material );

		}

	}

	resize() {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );

	}

}

/** Which way the building looks out: where Exterior put its entrance or its sign. */
function facadeNormal( blueprint ) {

	const normal = ( blueprint.lights ?? [] ).find( ( light ) => light.kind === 'entrance' )?.normal
		?? blueprint.signage?.[ 0 ]?.normal;

	return normal ? new THREE.Vector3( normal[ 0 ], 0, normal[ 1 ] ).normalize() : null;

}

/** Resolve one GLB material without dropping its authored two-sided surface. */
export function materialForViewerSurface( factory, source, { parcel, blueprint } = {} ) {

	return shellMaterial( factory, {
		key: source.name,
		variantId: shellVariant( factory, {
			key: source.name, authored: source.userData?.materialVariant, blueprint, parcelId: parcel
		} ),
		doubleSided: source.side === THREE.DoubleSide
	} );

}
