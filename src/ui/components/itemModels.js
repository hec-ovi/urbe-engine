import * as THREE from 'three';

/**
 * Small still models for the item, person and place previews: a few shared
 * unit shapes scaled into an object, lit by Phong, never a texture. A model
 * is either one of the SHAPES by name, or the exact boxes a quest item is
 * built from (`parts`), coloured by the host.
 */
export const SHAPES = Object.freeze( [ 'scanner', 'radio', 'card', 'book', 'map', 'key', 'battery', 'parcel', 'portrait', 'building', 'station' ] );

const PALETTE = {
	shell: '#3f5156', dark: '#18262c', metal: '#a4b0ae', brass: '#bc9d64', paper: '#d5c8a9',
	red: '#a75246', accent: '#74a99b', screen: '#82cab9', skin: '#ad8066', hair: '#332d2b'
};
const SKINS = [ '#ad8066', '#c39476', '#765748', '#bb9b80' ];
const HAIRS = [ '#312c29', '#646058', '#242e31', '#6b4a33' ];
const COATS = [ '#74a99b', '#8a7b5c', '#5c6f8a', '#8a5c5c', '#6f8a5c' ];

/** Unit shapes, made once per preview and released with it. */
export class ShapePool {

	constructor() {

		this.shapes = new Map();

	}

	get( kind ) {

		if ( ! this.shapes.has( kind ) ) this.shapes.set( kind, {
			box: () => new THREE.BoxGeometry( 1, 1, 1 ),
			cylinder: () => new THREE.CylinderGeometry( 1, 1, 1, 24 ),
			sphere: () => new THREE.SphereGeometry( 1, 20, 12 ),
			ring: () => new THREE.TorusGeometry( 1, 0.13, 8, 32 )
		}[ kind ]() );
		return this.shapes.get( kind );

	}

	dispose() {

		for ( const geometry of this.shapes.values() ) geometry.dispose();
		this.shapes.clear();

	}

}

/** A stable small number from text, so one person keeps one look. */
export function seedOf( text ) {

	let seed = 0;
	for ( const letter of String( text ) ) seed = ( seed * 31 + letter.charCodeAt( 0 ) ) >>> 0;
	return seed;

}

/**
 * Builds the model: { root, dispose() }. `model` is { shape?, parts?, color?, seed? };
 * `parts` wins: [{ size: [w, h, d], position: [x, y, z], rotation?: [x, y, z], color }].
 * The materials belong to the result, the shapes to the pool.
 */
export function buildModel( model, pool ) {

	const root = new THREE.Group();
	const materials = new Map();
	const colors = { ...PALETTE, accent: /^#[\da-f]{6}$/i.test( model.color ?? '' ) ? model.color : PALETTE.accent };
	const material = ( name ) => {

		if ( ! materials.has( name ) ) {

			const color = colors[ name ] ?? name;
			const metallic = name === 'metal' || name === 'brass';
			materials.set( name, new THREE.MeshPhongMaterial( {
				color, shininess: metallic ? 43 : 12, specular: metallic ? '#8e938e' : '#303c3c',
				...( name === 'screen' ? { emissive: color, emissiveIntensity: 0.28 } : {} )
			} ) );

		}
		return materials.get( name );

	};
	const part = ( shape, size, position = [ 0, 0, 0 ], paint = 'shell', rotation = [ 0, 0, 0 ] ) => {

		const mesh = new THREE.Mesh( pool.get( shape ), material( paint ) );
		mesh.scale.set( ...size );
		mesh.position.set( ...position );
		mesh.rotation.set( ...rotation );
		root.add( mesh );
		return mesh;

	};
	const box = ( size, position, paint, rotation ) => part( 'box', size, position, paint, rotation );
	const cylinder = ( radius, height, position, paint, rotation ) => part( 'cylinder', [ radius, height, radius ], position, paint, rotation );
	const ring = ( radius, position, paint, rotation ) => part( 'ring', [ radius, radius, radius ], position, paint, rotation );
	const sphere = ( size, position, paint ) => part( 'sphere', size, position, paint );
	const front = [ Math.PI / 2, 0, 0 ];

	if ( Array.isArray( model.parts ) && model.parts.length ) {

		for ( const each of model.parts ) box( each.size, each.position, each.color ?? 'shell', each.rotation ?? [ 0, 0, 0 ] );

	} else switch ( model.shape ) {

		case 'scanner':
			box( [ 1.12, 1.65, 0.42 ], [ 0, 0, 0 ], 'shell' );
			box( [ 0.93, 1.31, 0.04 ], [ 0, 0.05, 0.235 ], 'dark' );
			box( [ 0.73, 0.69, 0.035 ], [ 0, 0.28, 0.267 ], 'screen' );
			for ( let i = 0; i < 3; i ++ ) box( [ 0.51 - i * 0.1, 0.025, 0.018 ], [ - 0.045, 0.43 - i * 0.13, 0.294 ], 'dark' );
			cylinder( 0.1, 0.07, [ - 0.25, - 0.39, 0.29 ], 'brass', front );
			box( [ 0.34, 0.09, 0.05 ], [ 0.2, - 0.4, 0.27 ], 'metal' );
			cylinder( 0.06, 0.5, [ 0.36, 1.05, 0 ], 'metal' );
			box( [ 0.89, 0.1, 0.48 ], [ 0, - 0.65, 0 ], 'accent' );
			break;

		case 'radio':
			box( [ 1.04, 1.53, 0.48 ], [ 0, - 0.12, 0 ], 'shell' );
			box( [ 0.81, 0.45, 0.035 ], [ 0, 0.34, 0.26 ], 'dark' );
			box( [ 0.65, 0.28, 0.02 ], [ 0, 0.36, 0.288 ], 'screen' );
			for ( let i = 0; i < 5; i ++ ) box( [ 0.66, 0.036, 0.025 ], [ 0, - 0.12 - i * 0.115, 0.267 ], 'dark' );
			cylinder( 0.11, 0.18, [ 0.26, 0.73, 0 ], 'brass' );
			cylinder( 0.045, 0.9, [ - 0.3, 1.02, 0 ], 'metal' );
			box( [ 0.12, 0.3, 0.23 ], [ - 0.56, 0.06, 0 ], 'accent' );
			break;

		case 'card':
			box( [ 1.54, 0.97, 0.065 ], [ 0, 0, 0 ], 'paper' );
			box( [ 1.54, 0.16, 0.02 ], [ 0, 0.33, 0.04 ], 'accent' );
			box( [ 0.39, 0.49, 0.018 ], [ - 0.42, - 0.02, 0.045 ], 'shell' );
			sphere( [ 0.1, 0.13, 0.025 ], [ - 0.42, 0.06, 0.072 ], 'metal' );
			for ( let i = 0; i < 3; i ++ ) box( [ 0.57 - i * 0.07, 0.035, 0.02 ], [ 0.24, 0.09 - i * 0.13, 0.05 ], 'dark' );
			box( [ 0.19, 0.14, 0.02 ], [ 0.58, - 0.31, 0.05 ], 'brass' );
			break;

		case 'book':
			box( [ 1.12, 1.48, 0.4 ], [ 0, 0, 0 ], 'paper' );
			box( [ 1.22, 1.6, 0.08 ], [ 0, 0, 0.23 ], 'accent' );
			box( [ 1.22, 1.6, 0.08 ], [ 0, 0, - 0.23 ], 'accent' );
			box( [ 0.13, 1.6, 0.52 ], [ - 0.57, 0, 0 ], 'shell' );
			box( [ 0.69, 0.07, 0.025 ], [ 0.03, 0.37, 0.284 ], 'brass' );
			box( [ 0.44, 0.04, 0.025 ], [ 0.03, 0.22, 0.284 ], 'brass' );
			box( [ 0.46, 0.44, 0.025 ], [ 0.03, - 0.16, 0.284 ], 'dark' );
			box( [ 0.12, 0.38, 0.03 ], [ 0.27, - 0.69, 0.16 ], 'red' );
			break;

		case 'map':
			for ( let i = - 1; i <= 1; i ++ ) {

				box( [ 0.63, 1.35, 0.035 ], [ i * 0.59, 0, Math.abs( i ) * 0.08 ], i === 0 ? 'paper' : '#b9ae91', [ 0, i * - 0.26, 0 ] );
				for ( const y of [ - 0.36, 0.14, 0.43 ] ) box( [ 0.45, 0.025, 0.02 ], [ i * 0.59, y, Math.abs( i ) * 0.08 + 0.03 ], 'shell', [ 0, i * - 0.26, - 0.12 ] );

			}
			cylinder( 0.09, 0.035, [ 0.46, - 0.15, 0.14 ], 'red', front );
			break;

		case 'key':
			ring( 0.39, [ 0, 0.62, 0 ], 'brass' );
			box( [ 0.15, 1.11, 0.13 ], [ 0, - 0.11, 0 ], 'brass' );
			box( [ 0.43, 0.16, 0.13 ], [ 0.15, - 0.48, 0 ], 'brass' );
			box( [ 0.33, 0.17, 0.13 ], [ 0.1, - 0.73, 0 ], 'brass' );
			break;

		case 'battery':
			cylinder( 0.42, 1.53, [ 0, 0, 0 ], 'accent' );
			cylinder( 0.43, 0.25, [ 0, 0.64, 0 ], 'metal' );
			cylinder( 0.43, 0.15, [ 0, - 0.73, 0 ], 'dark' );
			cylinder( 0.15, 0.12, [ 0, 0.82, 0 ], 'brass' );
			box( [ 0.39, 0.05, 0.035 ], [ 0, - 0.42, 0.413 ], 'dark' );
			break;

		case 'portrait': {

			const seed = model.seed ?? 0;
			colors.skin = SKINS[ seed % SKINS.length ];
			colors.hair = HAIRS[ ( seed >>> 3 ) % HAIRS.length ];
			colors.accent = /^#[\da-f]{6}$/i.test( model.color ?? '' ) ? model.color : COATS[ ( seed >>> 6 ) % COATS.length ];
			sphere( [ 0.8, 0.62, 0.36 ], [ 0, - 0.62, 0 ], 'accent' );
			cylinder( 0.21, 0.38, [ 0, - 0.11, 0 ], 'skin' );
			sphere( [ 0.42, 0.55, 0.38 ], [ 0, 0.5, 0 ], 'skin' );
			sphere( [ 0.46, 0.33, 0.395 ], [ 0, 0.83, - 0.04 ], 'hair' );
			if ( seed % 3 === 1 ) box( [ 0.54, 0.21, 0.31 ], [ - 0.1, 0.93, 0.23 ], 'hair', [ 0, 0, - 0.2 ] );
			sphere( [ 0.08, 0.16, 0.1 ], [ 0, 0.42, 0.366 ], 'skin' );
			for ( const x of [ - 0.17, 0.17 ] ) {

				box( [ 0.12, 0.024, 0.032 ], [ x, 0.59, 0.353 ], 'hair' );
				sphere( [ 0.025, 0.024, 0.02 ], [ x, 0.54, 0.365 ], 'dark' );

			}
			box( [ 0.15, 0.02, 0.03 ], [ 0, 0.26, 0.333 ], 'hair' );
			box( [ 0.14, 0.45, 0.052 ], [ 0, - 0.58, 0.359 ], 'dark' );
			box( [ 0.16, 0.11, 0.045 ], [ - 0.36, - 0.51, 0.33 ], 'brass' );
			break;

		}

		case 'station':
			box( [ 2.35, 0.13, 1.72 ], [ 0, - 0.7, 0 ], 'dark' );
			box( [ 1.84, 0.62, 0.79 ], [ 0, - 0.27, - 0.34 ], 'paper' );
			box( [ 2.13, 0.13, 1.48 ], [ 0, 0.3, - 0.02 ], 'accent' );
			for ( const x of [ - 0.89, 0.89 ] ) cylinder( 0.045, 0.88, [ x, - 0.2, 0.57 ], 'metal' );
			for ( const x of [ - 0.61, 0, 0.61 ] ) box( [ 0.32, 0.37, 0.04 ], [ x, - 0.25, 0.08 ], 'dark' );
			box( [ 0.68, 0.21, 0.05 ], [ 0, 0.46, 0.42 ], 'dark' );
			for ( const x of [ - 0.75, 0.75 ] ) box( [ 0.05, 0.03, 1.68 ], [ x, - 0.607, 0 ], 'brass' );
			break;

		case 'building': {

			const seed = model.seed ?? 0;
			const floors = 3 + seed % 3;
			const height = 0.42 * floors;
			box( [ 2.35, 0.13, 1.72 ], [ 0, - 0.7, 0 ], 'dark' );
			box( [ 1.34, height, 1.02 ], [ 0, - 0.63 + height / 2, - 0.13 ], 'paper' );
			box( [ 1.51, 0.12, 1.16 ], [ 0, - 0.57 + height, - 0.13 ], 'shell' );
			box( [ 0.52, 0.32, 0.63 ], [ - 0.28, - 0.35 + height, - 0.25 ], 'accent' );
			for ( const x of [ - 0.41, 0, 0.41 ] ) for ( let y = 0; y < floors - 1; y ++ ) box( [ 0.19, 0.24, 0.025 ], [ x, - 0.08 + y * 0.42, 0.393 ], 'dark' );
			box( [ 0.28, 0.36, 0.04 ], [ 0, - 0.43, 0.41 ], 'accent' );
			box( [ 1.66, 0.08, 0.29 ], [ 0, - 0.06, 0.48 ], 'brass' );
			break;

		}

		default:
			box( [ 1.24, 1.05, 0.89 ], [ 0, 0, 0 ], 'paper' );
			box( [ 0.14, 1.07, 0.91 ], [ 0, 0, 0 ], 'shell' );
			box( [ 1.26, 0.14, 0.91 ], [ 0, 0, 0 ], 'shell' );
			box( [ 0.37, 0.28, 0.02 ], [ - 0.3, 0.24, 0.46 ], '#e4dcca' );
			for ( let i = 0; i < 3; i ++ ) box( [ 0.2, 0.02, 0.01 ], [ - 0.3, 0.3 - i * 0.06, 0.476 ], 'dark' );

	}

	return {
		root,
		dispose() {

			root.removeFromParent();
			for ( const each of materials.values() ) each.dispose();
			materials.clear();

		}
	};

}

/** Centres the model and scales its longest side to 2 inside a pivot that turns it. */
export function frame( model ) {

	const pivot = new THREE.Group();
	const holder = new THREE.Group();
	holder.add( model.root );
	const bounds = new THREE.Box3().setFromObject( holder );
	const size = bounds.getSize( new THREE.Vector3() );
	const length = Math.max( size.x, size.y, size.z );
	if ( ! ( length > 0 ) ) throw new TypeError( 'a preview model has no visible geometry' );
	holder.position.copy( bounds.getCenter( new THREE.Vector3() ) ).multiplyScalar( - 1 );
	pivot.add( holder );
	pivot.scale.setScalar( 2 / length );
	return pivot;

}
