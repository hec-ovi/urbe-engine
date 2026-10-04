import { Float32BufferAttribute } from 'three';
import { bake } from './GeometryBake.js';

/**
 * The picture screens on the facades, and what a city draws where they hung.
 *
 * Exterior has published three kinds: the landscape ad plate (`ad-screen`)
 * standing off a commercial wall, the corporate portrait standing off a
 * corporate tower in a node of its own with its frame and posts
 * (`corporate:portrait-screen`), and the portrait screens set into the panel
 * field of a faceted tower or beside a corporate entrance (`corporate-screen`).
 * The city hangs a fourth itself ([Neon.js](Neon.js)). None of them is part of
 * the building, and a city leaves them all out unless a run asks for them
 * (`?screens=on`, which the game sets as `factory.pictureScreens`).
 *
 * Leaving one out opens nothing in the facade:
 * - `drop`: a plate standing off the wall goes, and the wall behind it was
 *   never cut for it; a screen node of its own goes with its frame and posts,
 *   off a wall section that is whole behind it;
 * - `fill`: a screen set into a frame on the facade keeps its face, worn in the
 *   facade's own field material at metre UVs, so the frame holds a panel of the
 *   wall instead of a picture.
 */

/** Material kinds of a plate hung off the wall: the ad art, branded or not, and its alias. */
const PLATES = new Set( [ 'ad-screen', 'ad-screen-tall', 'screen' ] );
/** Material kinds of a screen set into a frame on the facade. */
const SET_IN = new Set( [ 'corporate-screen' ] );
/** Exterior's node for a screen standing off the wall with its own frame and posts. */
const ASSEMBLY = /(^|:)portrait-screen$/;

/** Whether this run draws the facades' picture screens. */
export function screensShown( factory ) {

	return factory?.pictureScreens === true;

}

/**
 * What a shell does with one of its mesh nodes: `keep` it, `drop` it, or
 * `fill` its face with the facade's own material.
 * @param key the material key the node wears
 * @param shown whether this run draws picture screens
 */
export function facadeScreen( node, key, shown = false ) {

	if ( shown ) return 'keep';
	if ( inAssembly( node ) ) return 'drop';

	const kind = String( key ).split( '/' )[ 1 ];

	return PLATES.has( kind ) ? 'drop' : SET_IN.has( kind ) ? 'fill' : 'keep';

}

/**
 * A set-in screen's face in the facade's own field material: its geometry in
 * metres along the face and up it, the way Exterior lays a panel field, or
 * null when the blueprint publishes no field material (the face is then left
 * out, over the frame it sat in).
 * @returns { key, variantId, geometry } | null
 */
export function screenFill( node, blueprint, { indexed = false } = {} ) {

	const field = blueprint?.facade?.materialPlan?.field;

	if ( ! field?.key ) return null;

	const geometry = bake( node, { indexed } );
	metreUv( geometry );

	return { key: field.key, variantId: field.variantId, geometry };

}

/** The node or any node above it is a screen standing with its own frame. */
function inAssembly( node ) {

	for ( let current = node; current; current = current.parent ) {

		// GLTFLoader strips `:` from `name` and keeps the authored one in userData.
		if ( ASSEMBLY.test( current.userData?.name ?? current.name ?? '' ) ) return true;

	}

	return false;

}

/**
 * U runs along the face to its right as Exterior lays it (the outward normal
 * turned a quarter about up), V down the face in metres, as glTF reads it.
 */
function metreUv( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const normal = geometry.getAttribute( 'normal' );
	const uv = new Float32Array( position.count * 2 );

	for ( let i = 0; i < position.count; i ++ ) {

		const nx = normal.getX( i ), nz = normal.getZ( i );
		const across = Math.hypot( nx, nz ) || 1;

		uv[ i * 2 ] = ( position.getX( i ) * nz - position.getZ( i ) * nx ) / across;
		uv[ i * 2 + 1 ] = - position.getY( i );

	}

	geometry.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );

}
