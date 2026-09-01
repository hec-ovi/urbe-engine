import { TimestampQuery } from 'three/webgpu';
import { CityGenerator } from '../city/CityGenerator.js';
import { ArchetypeGeometries } from '../scene/ArchetypeGeometries.js';
import { SceneBuilder } from '../scene/SceneBuilder.js';
import { createVariant, VARIANTS } from '../variants/createVariant.js';
import { ExperimentView } from '../ui/views/ExperimentView.js';
import { RunConfig } from './RunConfig.js';
import { RendererFactory } from './RendererFactory.js';
import { Metrics } from './Metrics.js';

const RESULTS_INTERVAL = 250; // ms between panel refreshes
const READBACK_INTERVAL = 500; // ms between GPU visible-count readbacks

/** Owns one experiment run: renderer, stage, active variant, metrics, view. */
export class App {

	constructor( config ) {

		this.config = config;
		this.metrics = new Metrics();
		this.view = new ExperimentView( {
			config,
			webgpuAvailable: RendererFactory.webgpuAvailable(),
			onConfigChange: ( next ) => RunConfig.navigate( next ),
			onCopyJson: () => JSON.stringify( this.exportSnapshot(), null, 2 )
		} );
		this.view.mount( document.body );

	}

	async start() {

		const { config } = this;
		const entry = VARIANTS.find( ( v ) => v.id === config.variant );

		if ( ! entry.backends.includes( config.backend ) ) {

			this.view.showError( `Variant "${ entry.label }" does not support the ${ config.backend } backend.` );
			return;

		}

		this.renderer = await RendererFactory.create( config.backend );
		document.body.prepend( this.renderer.domElement );
		this.actualBackend = RendererFactory.actualBackend( this.renderer );

		if ( ! entry.backends.includes( this.actualBackend ) ) {

			this.view.showError( 'This variant needs real WebGPU and the browser fell back to WebGL2.' );
			return;

		}

		const city = new CityGenerator( config.seed ).generate( config.count );
		const archetypes = await ArchetypeGeometries.build();
		const stage = SceneBuilder.build( city.halfExtent, this.renderer.domElement );
		Object.assign( this, stage ); // scene, camera, controls, staticDrawCalls

		this.variant = createVariant( config.variant );
		await this.variant.build( {
			scene: this.scene,
			renderer: this.renderer,
			camera: this.camera,
			city,
			archetypes,
			staticDrawCalls: this.staticDrawCalls
		} );

		this.view.setStatus( `backend: ${ this.actualBackend }${ this.actualBackend !== config.backend ? ' (fallback)' : '' }` );

		window.addEventListener( 'resize', () => this.resize() );
		this.startSampling();
		this.renderer.setAnimationLoop( () => this.frame() );

	}

	frame() {

		this.metrics.beginFrame( performance.now() );

		this.controls.update();
		this.variant.update( this.camera );
		this.renderer.render( this.scene, this.camera );

		this.metrics.endFrame( performance.now() );
		this.metrics.setRenderInfo( this.renderer.info );
		this.metrics.setVisible( this.variant.visibleInstances( this.renderer.info ) );
		this.resolveTimestamps();

	}

	/** One resolve in flight at a time; values land in renderer.info. */
	resolveTimestamps() {

		if ( this.resolvingTimestamps ) return;
		this.resolvingTimestamps = true;

		Promise.all( [
			this.renderer.resolveTimestampsAsync( TimestampQuery.RENDER ),
			this.renderer.resolveTimestampsAsync( TimestampQuery.COMPUTE )
		] ).then( ( [ renderMs, computeMs ] ) => {

			this.metrics.setGpuTimestamps( renderMs, computeMs );

		} ).finally( () => {

			this.resolvingTimestamps = false;

		} );

	}

	startSampling() {

		setInterval( () => {

			this.view.updateResults( this.exportSnapshot() );

		}, RESULTS_INTERVAL );

		if ( typeof this.variant.readVisible === 'function' ) {

			setInterval( () => {

				if ( this.readingVisible ) return;
				this.readingVisible = true;
				this.variant.readVisible().finally( () => {

					this.readingVisible = false;

				} );

			}, READBACK_INTERVAL );

		}

	}

	exportSnapshot() {

		return this.metrics.snapshot( {
			variant: this.config.variant,
			backendRequested: this.config.backend,
			backendActual: this.actualBackend,
			buildingCount: this.config.count,
			seed: this.config.seed
		} );

	}

	resize() {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );

	}

}
