import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { doorFrame } from './DoorGeometry.js';
import { takeTriangles, centroidAt } from './Triangles.js';
import { kelvinColor } from '../light/Color.js';

// The GLB names its nodes `merged:<key>` and `interior:<key>`, but GLTFLoader
// runs node names through PropertyBinding.sanitizeNodeName, which strips the
// animation-path reserved characters `[].:/`. The leading word is all that
// survives intact, so that is what the split matches on. Material names are
// not sanitized, so the material key still arrives whole.
const EXTERIOR = 'merged';
export const INTERIOR_PREFIX = 'interior';

const FIXTURE = '/light-fixture/';
/** A lit diffuser is looked at directly, so it sits well above road exposure. */
const FIXTURE_EMISSIVE = 60;
const FIXTURE_KELVIN = 2700;

/**
 * Every building's shell, loaded once for the whole city: the skyline is
 * visible from everywhere, so it is one merge by material key and one draw
 * call per key.
 *
 * The shell comes from the parcel's own exterior GLB, which is under a
 * megabyte, and not from the furnished interior GLB, which is tens of them and
 * carries the identical shell. Interiors stream separately and only near the
 * player (InteriorStream).
 *
 * The entrance door leaf is lifted out of the shell into its own pivoted mesh
 * so it can swing. Exterior meshes arrive without normals, so they get them.
 */
export class BuildingsLoader {

	/** @param factory PbrMaterialFactory */
	constructor( factory ) {

		this.factory = factory;
		this.loader = new GLTFLoader();

	}

	/**
	 * @param buildings Map<parcelId, { blueprint, shellUrl }> from WorldSource
	 * @returns { group, doors, shellColliders, centers, triangles }
	 */
	async load( buildings ) {

		const loaded = await Promise.all(
			[ ...buildings.values() ].map( ( entry ) => this.#loadOne( entry ) )
		);

		const group = new THREE.Group();
		group.name = 'city';

		const shellByKey = new Map();
		const doors = [];
		const shellColliders = new Map();
		const centers = new Map();
		let triangles = 0;

		for ( const building of loaded ) {

			for ( const [ key, geometries ] of building.exterior ) {

				if ( ! shellByKey.has( key ) ) shellByKey.set( key, [] );

				shellByKey.get( key ).push( ...geometries );

			}

			shellColliders.set( building.parcelId, building.exteriorFlat );
			centers.set( building.parcelId, building.center );

			if ( building.door ) {

				group.add( building.door.pivot );
				doors.push( building.door );

			}

		}

		for ( const [ key, geometries ] of shellByKey ) {

			const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
			geometries.forEach( ( g ) => g.dispose() );
			triangles += merged.getAttribute( 'position' ).count / 3;
			const mesh = new THREE.Mesh( merged, this.#material( key ) );
			mesh.name = `shell:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		return { group, doors, shellColliders, centers, triangles };

	}

	/** The material for a shell key; a lit diffuser reads as its own lamp. */
	#material( key ) {

		return key.includes( FIXTURE )
			? this.factory.variant( key, {
				emissiveScale: FIXTURE_EMISSIVE,
				emissive: kelvinColor( FIXTURE_KELVIN )
			} )
			: this.factory.build( key );

	}

	async #loadOne( { parcelId, blueprint, shellUrl } ) {

		const gltf = await this.loader.loadAsync( shellUrl );
		gltf.scene.updateMatrixWorld( true );

		const exterior = new Map();
		const door = doorFrame( blueprint );
		const doorParts = [];
		const exteriorFlat = [];

		gltf.scene.traverse( ( node ) => {

			if ( ! node.isMesh || ! node.name?.startsWith( EXTERIOR ) ) return;

			const key = node.material?.name ?? '';
			const geometry = bake( node );

			// The entrance leaf hides inside the door material's merged mesh.
			const [ leaf, rest ] = door && isDoorMaterial( key )
				? splitAt( geometry, door.box )
				: [ null, geometry ];

			if ( leaf ) doorParts.push( { key, geometry: leaf } );

			if ( rest ) {

				push( exterior, key, rest );
				exteriorFlat.push( positionsOnly( rest ) );

			}

		} );

		if ( door && doorParts.length ) attachLeaf( door, doorParts, ( key ) => this.#material( key ) );
		else if ( door ) door.pivot = null;

		return {
			parcelId,
			exterior,
			exteriorFlat: exteriorFlat.length ? BufferGeometryUtils.mergeGeometries( exteriorFlat, false ) : null,
			center: centerOf( blueprint ),
			door: door?.pivot ? door : null
		};

	}

}

function isDoorMaterial( key ) {

	return key.includes( '/door-glass/' ) || key.includes( '/door/' );

}

function push( map, key, geometry ) {

	if ( ! map.has( key ) ) map.set( key, [] );

	map.get( key ).push( geometry );

}

/** World-space, non-indexed, always with normals. Merging needs one layout. */
export function bake( mesh ) {

	const geometry = ( mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone() );
	geometry.applyMatrix4( mesh.matrixWorld );

	if ( ! geometry.getAttribute( 'normal' ) ) geometry.computeVertexNormals();
	if ( ! geometry.getAttribute( 'uv' ) ) {

		const count = geometry.getAttribute( 'position' ).count;
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( count * 2 ), 2 ) );

	}

	geometry.deleteAttribute( 'tangent' );
	geometry.deleteAttribute( 'uv1' );
	geometry.deleteAttribute( 'color' );

	return geometry;

}

export function positionsOnly( geometry ) {

	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

	return copy;

}

/** Splits triangles whose centroid falls inside `box` off into their own geometry. */
function splitAt( geometry, box ) {

	const position = geometry.getAttribute( 'position' );
	const inside = [];
	const outside = [];

	for ( let i = 0; i < position.count; i += 3 ) {

		centroidAt( position, i, _centroid, _a, _b, _c );
		( box.containsPoint( _centroid ) ? inside : outside ).push( i );

	}

	if ( ! inside.length ) return [ null, geometry ];

	const result = [ takeTriangles( geometry, inside ), takeTriangles( geometry, outside ) ];
	geometry.dispose();

	return result;

}

/**
 * Re-parents the leaf triangles under a pivot at the hinge edge, so opening
 * the door is a rotation on the pivot and the geometry never moves in place.
 */
function attachLeaf( door, parts, material ) {

	const pivot = new THREE.Group();
	pivot.position.copy( door.hinge );
	pivot.name = `door:${door.parcelId}`;

	for ( const { key, geometry } of parts ) {

		geometry.translate( - door.hinge.x, - door.hinge.y, - door.hinge.z );
		pivot.add( new THREE.Mesh( geometry, material( key ) ) );

	}

	door.pivot = pivot;

}

/** Footprint centroid: what distance-based interior loading and culling measure from. */
function centerOf( blueprint ) {

	const ring = blueprint.bounds.footprint;
	const sum = ring.reduce( ( acc, [ x, z ] ) => [ acc[ 0 ] + x, acc[ 1 ] + z ], [ 0, 0 ] );

	return new THREE.Vector3( sum[ 0 ] / ring.length, 0, sum[ 1 ] / ring.length );

}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _centroid = new THREE.Vector3();
