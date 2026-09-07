import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buffersOf } from './InteriorRooms.js';
import { cutInterior } from './InteriorSurfaces.js';

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
 * The structured-clone wire types are in schema/interior-cut.d.ts.
 */
const loader = new GLTFLoader();

self.onmessage = async ( { data: { id, url, outlines } } ) => {

	let scene;
	let transferred = new Set();
	try {

		const marks = [ performance.now() ];
		const response = await fetch( url );

		if ( ! response.ok ) throw new Error( `${response.status} fetching ${url}` );

		const bytes = await response.arrayBuffer();
		marks.push( performance.now() );

		const gltf = await loader.parseAsync( bytes, '' );
		scene = gltf.scene;
		marks.push( performance.now() );

		const cut = cutInterior( scene, outlines );
		marks.push( performance.now() );

		const buffers = buffersOf( cut );
		self.postMessage( { id, cut, bytes: bytes.byteLength, cost: costOf( marks ) }, buffers );
		transferred = new Set( buffers );

	} catch ( error ) {

		self.postMessage( { id, error: error?.message ?? String( error ) } );

	} finally {

		const resources = new Set();
		const images = new Set();
		scene?.traverse( node => {

			if ( ! node.isMesh ) return;
			resources.add( node.geometry );
			for ( const material of Array.isArray( node.material ) ? node.material : [ node.material ] ) {

				resources.add( material );
				for ( const texture of Object.values( material ).filter( value => value?.isTexture ) ) {

					resources.add( texture ); images.add( texture.source.data );

				}

			}

		} );
		for ( const resource of resources ) resource.dispose();
		for ( const image of images ) if ( ! transferred.has( image ) ) image?.close?.();

	}

};

function costOf( [ start, fetched, parsed, cut ] ) {

	return {
		fetch: Math.round( fetched - start ),
		parse: Math.round( parsed - fetched ),
		cut: Math.round( cut - parsed )
	};

}
