import * as THREE from 'three/webgpu';
import { RendererFactory } from '../app/RendererFactory.js';
import { BuildingAssets } from './BuildingAssets.js';
import { BuildingStage } from './BuildingStage.js';
import { MaterialResolver } from './MaterialResolver.js';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';
import { FloorSlicer } from './FloorSlicer.js';
import { BuildingView } from '../ui/views/BuildingView.js';

const DEFAULT_THEME = 'cyberpunk';

/**
 * One building viewer run, described by the URL query:
 * ?mode=building&parcel=p1640[&source=shell|interior][&backend=webgpu|webgl].
 * Loads the assembled building from /out/<parcel>/, resolves every material
 * key through the materials database and orbits the result.
 */
export class BuildingViewerApp {

	static configFromUrl() {

		const params = new URLSearchParams( window.location.search );

		return {
			parcel: params.get( 'parcel' ) ?? 'p1640',
			source: [ 'shell', 'interior' ].includes( params.get( 'source' ) ) ? params.get( 'source' ) : null,
			backend: params.get( 'backend' ) === 'webgl' ? 'webgl' : 'webgpu'
		};

	}

	constructor( config ) {

		this.config = config;
		this.view = new BuildingView( {
			parcel: config.parcel,
			onSourceChange: ( source ) => this.navigate( { source } ),
			onSliceChange: ( value ) => this.slicer?.apply( value )
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
			this.view.showError( String( error.message ?? error ) );

		}

	}

	async #run() {

		const { parcel, backend } = this.config;
		const assets = new BuildingAssets( parcel );

		const [ blueprint, hasInterior ] = await Promise.all( [
			assets.loadBlueprint(),
			assets.hasInterior()
		] );

		const source = this.config.source ?? ( hasInterior ? 'interior' : 'shell' );
		this.view.setSource( source, hasInterior );

		this.renderer = await RendererFactory.create( backend );
		document.body.prepend( this.renderer.domElement );

		const resolver = new MaterialResolver();
		await resolver.loadTheme( DEFAULT_THEME );
		const factory = new PbrMaterialFactory( resolver );

		this.slicer = new FloorSlicer( blueprint.floors );
		this.view.setFloorOptions( this.slicer.options() );

		const building = await assets.loadScene( source );
		building.traverse( ( node ) => {

			if ( ! node.isMesh ) return;

			const replace = ( material ) => {

				const built = factory.build( material.name );
				this.slicer.attach( built );

				return built;

			};

			node.material = Array.isArray( node.material )
				? node.material.map( replace )
				: replace( node.material );

		} );

		const bounds = new THREE.Box3().setFromObject( building );
		const stage = BuildingStage.build( bounds, this.renderer.domElement );
		stage.scene.add( building );
		Object.assign( this, stage ); // scene, camera, controls

		if ( import.meta.env.DEV ) window.__viewer = this; // headless verification handle

		this.view.setReport( resolver.report() );
		this.view.setStatus( `${parcel} · ${source} · ${RendererFactory.actualBackend( this.renderer )}` );

		window.addEventListener( 'resize', () => this.resize() );
		this.renderer.setAnimationLoop( () => {

			this.controls.update();
			this.renderer.render( this.scene, this.camera );

		} );

	}

	resize() {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );

	}

}
