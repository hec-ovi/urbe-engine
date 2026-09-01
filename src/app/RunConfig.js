import { VARIANTS } from '../variants/createVariant.js';

export const COUNTS = [ 1000, 2000, 5000, 10000, 20000, 50000 ];
export const BACKENDS = [ 'webgpu', 'webgl' ];

const DEFAULTS = { variant: 'mesh', count: 5000, backend: 'webgpu', seed: 1337 };

/**
 * One experiment run = one page load, described entirely by the URL query
 * (?variant=indirect&count=10000&backend=webgpu&seed=1337). Changing any
 * setting navigates, so every run starts from clean GPU state.
 */
export class RunConfig {

	static fromUrl() {

		const params = new URLSearchParams( window.location.search );

		const variant = VARIANTS.some( ( v ) => v.id === params.get( 'variant' ) )
			? params.get( 'variant' ) : DEFAULTS.variant;

		const count = Math.min( 50000, Math.max( 1000,
			parseInt( params.get( 'count' ), 10 ) || DEFAULTS.count ) );

		const backend = BACKENDS.includes( params.get( 'backend' ) )
			? params.get( 'backend' ) : DEFAULTS.backend;

		const seed = parseInt( params.get( 'seed' ), 10 ) || DEFAULTS.seed;

		return { variant, count, backend, seed };

	}

	static navigate( config ) {

		const params = new URLSearchParams( config );
		window.location.search = params.toString();

	}

}
