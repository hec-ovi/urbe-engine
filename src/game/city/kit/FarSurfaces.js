import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { simplifyFar } from './FarSimplify.js';

/**
 * Past this many metres from the player a copy draws its far surfaces. The
 * simplifier's error (FAR_ERROR, 0.1 m) is half a pixel there across a
 * 1080-line screen at the game's 72 degree view.
 */
export const FAR_DISTANCE = 150;
/** The grid, in metres, a far window room keeps its baked light on. */
export const FAR_ROOM_CELL = 4;
/** A far surface keeping more than this share of the triangles is not worth its room in a batch. */
const WORTH = 0.8;

/**
 * Simplifies surfaces on a worker, one at a time in the order asked, so a
 * plan read while the city is played never holds the frame for it. Where the
 * platform has no workers, as under Node, it simplifies in place. A worker
 * that fails answers every call with no far surface from then on, and the
 * city draws its near ones at every distance.
 */
export class FarSimplifier {

	/** @param open makes the worker, or answers null where there are none */
	constructor( { open = openWorker } = {} ) {

		this.open = open;
		/** undefined until the first call; then the worker, null to work in place, or false once it failed */
		this.worker = undefined;
		this.calls = new Map();
		this.next = 0;

	}

	/**
	 * @param index the surface's triangles, a copy the call may keep
	 * @param count its vertices
	 * @param attributes copies of its attributes, positions first ([FarSimplify.js](FarSimplify.js))
	 * @returns `{ index, attributes }`, the kept triangles over only the vertices
	 *   they draw ([FarSimplify.js](FarSimplify.js)), or null when there is no far surface
	 */
	simplify( index, count, attributes ) {

		if ( this.worker === undefined ) this.worker = this.#start();
		if ( this.worker === false ) return Promise.resolve( null );
		if ( this.worker === null ) return simplifyFar( index, count, attributes );

		const id = this.next ++;

		return new Promise( ( resolve ) => {

			this.calls.set( id, resolve );
			this.worker.postMessage( { id, index, count, attributes }, [ index.buffer, ...attributes.map( ( { array } ) => array.buffer ) ] );

		} );

	}

	dispose() {

		if ( this.worker ) this.worker.terminate();
		this.worker = false;
		this.#settle();

	}

	#start() {

		let worker;
		try {

			worker = this.open();

		} catch ( error ) {

			console.warn( `far surfaces: ${error.message}; buildings draw their near surfaces at every distance` );
			return false;

		}
		if ( ! worker ) return null;

		worker.onmessage = ( { data } ) => {

			const resolve = this.calls.get( data.id );
			this.calls.delete( data.id );
			resolve?.( data.error ? null : data.far );

		};
		worker.onerror = ( event ) => {

			event.preventDefault?.();
			console.warn( `far surfaces: ${event.message ?? 'the worker failed'}; buildings draw their near surfaces at every distance` );
			this.dispose();

		};

		return worker;

	}

	/** Every call still waiting answers with no far surface. */
	#settle() {

		for ( const resolve of this.calls.values() ) resolve( null );
		this.calls.clear();

	}

}

/**
 * Gives each of a plan's shell surfaces the far surface it draws past
 * FAR_DISTANCE, as `surface.far`: its `farSurface`.
 */
export async function farShells( surfaces, simplifier ) {

	await Promise.all( surfaces.map( async ( surface ) => {

		const far = await farSurface( surface.geometry, surface.material, simplifier );
		if ( far ) surface.far = far;

	} ) );

}

/**
 * The far surface of one surface: the vertices the simplifier's triangles draw,
 * with every attribute the surface wears, indexed whether the surface is or
 * not. A glowing surface has none, because a lit strip is what a far building shows at night,
 * and neither does one the simplifier cannot take far enough to be worth it. A
 * far surface with no triangles hides that surface past the distance.
 *
 * @returns the far geometry, or null
 */
export async function farSurface( geometry, material, simplifier ) {

	const position = geometry.getAttribute( 'position' );
	if ( ! ( position.array instanceof Float32Array ) || position.itemSize !== 3 || glows( material ) ) return null;

	const index = geometry.getIndex();
	const triangles = index ? Uint32Array.from( index.array.subarray( 0, index.count ) ) : Uint32Array.from( { length: position.count }, ( unused, vertex ) => vertex );
	const far = await simplifier.simplify( triangles, position.count, copies( geometry ) ).catch( () => null );
	if ( ! far || far.index.length > ( index?.count ?? position.count ) * WORTH ) return null;

	const surface = new BufferGeometry();
	names( geometry ).forEach( ( name, at ) => {

		const { itemSize, normalized } = geometry.getAttribute( name );
		surface.setAttribute( name, new BufferAttribute( far.attributes[ at ], itemSize, normalized ) );

	} );
	surface.setIndex( new BufferAttribute( far.index, 1 ) );

	return surface;

}

/**
 * Every attribute as a copy the worker may keep, positions first, in the layout
 * it has: a loader's interleaved buffer is copied whole with its stride, so the
 * main thread copies memory and reads no vertex.
 */
function copies( geometry ) {

	const count = geometry.getAttribute( 'position' ).count;

	return names( geometry ).map( ( name ) => {

		const attribute = geometry.getAttribute( name );
		const stride = attribute.isInterleavedBufferAttribute ? attribute.data.stride : attribute.itemSize;
		const offset = attribute.isInterleavedBufferAttribute ? attribute.offset : 0;

		return { array: attribute.array.slice( 0, count * stride ), itemSize: attribute.itemSize, stride, offset };

	} );

}

/** The attribute names, positions first, in the order the simplifier takes and answers them. */
function names( geometry ) {

	return [ 'position', ...Object.keys( geometry.attributes ).filter( ( name ) => name !== 'position' ) ];

}

function glows( material ) {

	return Boolean( material.emissiveMap || material.emissiveNode || ( material.emissive?.getHex() && material.emissiveIntensity > 0 ) );

}

function openWorker() {

	return typeof Worker === 'undefined' ? null : new Worker( new URL( './FarSimplify.worker.js', import.meta.url ), { type: 'module' } );

}
