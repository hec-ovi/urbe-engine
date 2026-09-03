import { HydrologyAdapter } from './HydrologyAdapter.js';

const BINDING_DOCUMENT = 'atlas-hydrology';

/** Owns the optional water runtime inside the live scene. */
export class HydrologyHost {

	static async install( { blueprint, factory, scene } ) {

		if ( ! Object.hasOwn( blueprint, 'hydrology' ) || blueprint.hydrology == null ) {

			return new HydrologyHost( scene, null );

		}
		const bindings = await factory.resolver.loadBindings( BINDING_DOCUMENT );
		const runtime = HydrologyAdapter.build( blueprint, { factory, bindings } );
		scene.add( runtime.group );
		return new HydrologyHost( scene, runtime );

	}

	constructor( scene, runtime ) {

		this.scene = scene;
		this.runtime = runtime;

	}

	get group() {

		return this.runtime?.group ?? null;

	}

	get handoff() {

		return this.runtime?.handoff ?? null;

	}

	get summary() {

		return this.runtime?.summary ?? null;

	}

	update( elapsedSeconds ) {

		this.runtime?.update( { elapsedSeconds } );

	}

	dispose() {

		if ( ! this.runtime ) return;
		this.scene.remove( this.runtime.group );
		this.runtime.dispose();
		this.runtime = null;

	}

}
