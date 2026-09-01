import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bake, INTERIOR_PREFIX } from './BuildingsLoader.js';
import { buffersOf, materialKey, partition } from './InteriorRooms.js';

/**
 * The interior worker: everything about landing one furnished floor that
 * needs no scene runs here, off the frame. The floor's GLB is fetched, parsed,
 * baked to world space and cut into the rooms the interior box published, and
 * what goes back is plain typed arrays, transferred rather than copied, so the
 * frame that receives them only wraps them in geometry.
 *
 * In: { id, url, outlines } per floor, the outlines being the whole building's
 * so a room is found whichever floor's file its triangles arrive in. Out:
 * { id, cut, bytes, cost } with the milliseconds each step took, or { id, error }.
 */
const loader = new GLTFLoader();

self.onmessage = async ( { data: { id, url, outlines } } ) => {

	try {

		const marks = [ performance.now() ];
		const response = await fetch( url );

		if ( ! response.ok ) throw new Error( `${response.status} fetching ${url}` );

		const bytes = await response.arrayBuffer();
		marks.push( performance.now() );

		const gltf = await loader.parseAsync( bytes, '' );
		gltf.scene.updateMatrixWorld( true );
		marks.push( performance.now() );

		const surfaces = surfacesOf( gltf.scene );
		marks.push( performance.now() );

		const cut = partition( surfaces, outlines );
		marks.push( performance.now() );

		self.postMessage( { id, cut, bytes: bytes.byteLength, cost: costOf( marks ) }, buffersOf( cut ) );

	} catch ( error ) {

		self.postMessage( { id, error: error?.message ?? String( error ) } );

	}

};

/** Every interior mesh baked to world space, as the arrays the partition reads. */
function surfacesOf( scene ) {

	const surfaces = [];

	scene.traverse( ( node ) => {

		if ( ! node.isMesh || ! node.name?.startsWith( INTERIOR_PREFIX ) ) return;

		const geometry = bake( node );

		surfaces.push( {
			key: materialKey( node.material ),
			position: geometry.getAttribute( 'position' ).array,
			normal: geometry.getAttribute( 'normal' ).array,
			uv: geometry.getAttribute( 'uv' ).array
		} );

	} );

	return surfaces;

}

function costOf( [ start, fetched, parsed, baked, cut ] ) {

	return {
		fetch: Math.round( fetched - start ),
		parse: Math.round( parsed - fetched ),
		bake: Math.round( baked - parsed ),
		cut: Math.round( cut - baked )
	};

}
