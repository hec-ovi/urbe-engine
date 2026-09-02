import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { doorFrame } from './DoorGeometry.js';
import { takeTriangles, centroidAt } from './Triangles.js';
import { kelvinColor } from '../light/Color.js';
import { bucketFor, splitBucket, variantFor } from './Variety.js';

// The GLB names its nodes `merged:<key>` and `interior:<key>`, but GLTFLoader
// runs node names through PropertyBinding.sanitizeNodeName, which strips the
// animation-path reserved characters `[].:/`. The leading word is all that
// survives intact, so that is what the split matches on. Material names are
// not sanitized, so the material key still arrives whole.
const EXTERIOR = 'merged';
export const INTERIOR_PREFIX = 'interior';
// Each entrance leaf is its own node, `door:entrance/leaf:N`, sitting on its
// hinge (../../../exterior/CONTRACT.md): the node's origin is where it swings.
const DOOR = 'door';

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

				// a building wears one variant of each material; buildings of the same variant merge together
				const bucket = bucketFor( key, variantFor( this.factory.resolver.resolve( key ), building.parcelId ) );
				if ( ! shellByKey.has( bucket ) ) shellByKey.set( bucket, [] );
				shellByKey.get( bucket ).push( ...geometries );

			}

			shellColliders.set( building.parcelId, building.exteriorFlat );
			centers.set( building.parcelId, building.center );

			if ( building.door ) {

				for ( const { pivot } of building.door.pivots ) group.add( pivot );

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

	/** The material for a merge bucket (key and the variant it wears); a lit diffuser reads as its own lamp. */
	#material( bucket ) {

		const { key, variantId } = splitBucket( bucket );

		return key.includes( FIXTURE )
			? this.factory.variant( key, {
				variantId,
				emissiveScale: FIXTURE_EMISSIVE,
				emissive: kelvinColor( FIXTURE_KELVIN )
			} )
			: this.factory.build( key, variantId );

	}

	async #loadOne( { parcelId, blueprint, shellUrl } ) {

		const gltf = await this.loader.loadAsync( shellUrl );
		gltf.scene.updateMatrixWorld( true );

		const exterior = new Map();
		const door = doorFrame( blueprint );
		const doorParts = [];
		const exteriorFlat = [];

		gltf.scene.traverse( ( node ) => {

			if ( ! node.isMesh ) return;

			const name = node.name ?? '';
			const key = node.material?.name ?? '';

			if ( door && name.startsWith( DOOR ) ) {

				doorParts.push( { key, geometry: bake( node ), hinge: node.getWorldPosition( new THREE.Vector3() ) } );

				return;

			}

			if ( ! name.startsWith( EXTERIOR ) ) return;

			const geometry = bake( node );

			// Older shells merged the leaf into the door material's own mesh.
			const [ leaf, rest ] = door && isDoorMaterial( key )
				? splitAt( geometry, door.box )
				: [ null, geometry ];

			if ( leaf ) doorParts.push( { key, geometry: leaf, hinge: door.hinge } );

			if ( rest ) {

				push( exterior, key, rest );
				exteriorFlat.push( positionsOnly( rest ) );

			}

		} );

		if ( door && doorParts.length ) attachLeaves( door, doorParts, ( key ) => this.#material( key ) );

		return {
			parcelId,
			exterior,
			exteriorFlat: exteriorFlat.length ? BufferGeometryUtils.mergeGeometries( exteriorFlat, false ) : null,
			center: centerOf( blueprint ),
			door: door?.pivots.length ? door : null
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
/**
 * Hangs every leaf on the hinge it was delivered on. A leaf whose body lies
 * ahead of its hinge along the opening swings one way, one hung on the far
 * jamb swings the other, so a pair or a triple parts as it opens.
 */
function attachLeaves( door, parts, material ) {

	door.pivots = [];

	for ( const { key, geometry, hinge } of parts ) {

		geometry.computeBoundingBox();
		const side = geometry.boundingBox.getCenter( _centroid ).sub( hinge ).dot( door.along ) >= 0 ? 1 : - 1;
		geometry.translate( - hinge.x, - hinge.y, - hinge.z );

		const pivot = new THREE.Group();
		pivot.position.copy( hinge );
		pivot.name = `door:${door.parcelId}:${door.pivots.length}`;
		pivot.add( new THREE.Mesh( geometry, material( key ) ) );
		door.pivots.push( { pivot, sign: side } );

	}

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
