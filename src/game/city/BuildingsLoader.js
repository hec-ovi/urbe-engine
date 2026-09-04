import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { doorFrames, doorLeafOwner } from './DoorGeometry.js';
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
// Each moving leaf is its own node, `door:<id>/leaf:N` or
// `balcony:<id>/leaf:N`, sitting on its hinge
// (../../../exterior/CONTRACT.md): the node's origin is where it swings.
const DOOR = 'door';
const BALCONY = 'balcony';

const FIXTURE = '/light-fixture/';
/**
 * A lit diffuser is looked at directly, so it sits well above road exposure.
 * This is the level the night grade was tuned at, stated outright rather than
 * multiplied onto whatever strength the database authored the map with.
 */
const FIXTURE_EMISSIVE = 180;
const FIXTURE_KELVIN = 2700;
const LOAD_CONCURRENCY = 8;
const MAIN_THREAD_SLICE_MS = 8;
// Only surfaces that can stop or support a person enter Rapier. Window frames,
// signs, lamps and trim still render, but cooking their small relief geometry
// duplicates millions of triangles without changing the walkable shell.
const COLLIDER_KINDS = new Set( [
	'concrete', 'wall', 'column', 'window-glass', 'door', 'door-glass',
	'floor-slab', 'roof', 'parapet', 'balcony-slab', 'balcony-rail',
	'roof-artifact', 'ac-unit', 'metal'
] );

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
	constructor( factory, loader = new GLTFLoader() ) {

		this.factory = factory;
		this.loader = loader;

	}

	/**
	 * @param buildings Map<parcelId, { blueprint, shellUrl }> from WorldSource
	 * @returns { group, doors, shellColliders, centers, triangles }
	 */
	async load( buildings ) {

		const loaded = await mapConcurrent(
			[ ...buildings.values() ], LOAD_CONCURRENCY, ( entry ) => this.#loadOne( entry )
		);

		const group = new THREE.Group();
		group.name = 'city';

		const shellByKey = new Map();
		const doors = [];
		const entrances = [];
		const shellColliders = new Map();
		const centers = new Map();
		let triangles = 0;

		for ( const building of loaded ) {

			for ( const [ surface, geometries ] of building.exterior ) {

				const { key, variantId: authoredVariant, doubleSided } = splitBucket( surface );
				// An authored surface keeps its exact look. Otherwise the building
				// wears one seeded pattern variant of the material.
				const bucket = bucketFor( key, authoredVariant ?? variantFor(
					this.factory.resolver.resolve( key ), building.parcelId, this.factory.patternVariants
				), doubleSided );
				if ( ! shellByKey.has( bucket ) ) shellByKey.set( bucket, [] );
				shellByKey.get( bucket ).push( ...geometries );

			}

			shellColliders.set( building.parcelId, building.exteriorFlat );
			centers.set( building.parcelId, building.center );

			for ( const door of building.doors ) {

				for ( const { pivot } of door.pivots ) group.add( pivot );

				doors.push( door );
				if ( door.role === 'main' ) entrances.push( door );

			}

		}

		let sliceStarted = performance.now();
		for ( const [ key, geometries ] of shellByKey ) {

			const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
			geometries.forEach( ( g ) => g.dispose() );
			triangles += merged.getAttribute( 'position' ).count / 3;
			const mesh = new THREE.Mesh( merged, this.#material( key ) );
			mesh.name = `shell:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );
			if ( performance.now() - sliceStarted >= MAIN_THREAD_SLICE_MS ) {

				await taskYield();
				sliceStarted = performance.now();

			}

		}

		return { group, doors, entrances, shellColliders, centers, triangles };

	}

	/** The material for a merge bucket (key and the variant it wears); a lit diffuser reads as its own lamp. */
	#material( bucket ) {

		const { key, variantId, doubleSided } = splitBucket( bucket );
		const side = doubleSided ? THREE.DoubleSide : undefined;

		return key.includes( FIXTURE )
			? this.factory.variant( key, {
				variantId,
				emissiveLevel: FIXTURE_EMISSIVE,
				emissive: kelvinColor( FIXTURE_KELVIN ),
				...( side !== undefined ? { side } : {} )
			} )
			: side === undefined
				? this.factory.build( key, variantId )
				: this.factory.variant( key, { variantId, side } );

	}

	async #loadOne( { parcelId, blueprint, shellUrl, hasInterior = true } ) {

		const gltf = await this.loader.loadAsync( shellUrl );
		gltf.scene.updateMatrixWorld( true );

		const exterior = new Map();
		const doors = hasInterior ? doorFrames( blueprint ) : [];
		const doorParts = new Map( doors.map( ( door ) => [ door, [] ] ) );
		const exteriorFlat = [];

		const meshes = [];
		gltf.scene.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		let sliceStarted = performance.now();

		for ( const node of meshes ) {

			const name = node.name ?? '';
			const key = node.material?.name ?? '';
			const surface = bucketFor(
				key,
				node.material?.userData?.materialVariant ?? blueprint.materialVariants?.[ key ],
				node.material?.side === THREE.DoubleSide
			);
			if ( ! hasInterior && isDoorLeaf( name ) ) {

				const geometry = bake( node );
				push( exterior, surface, geometry );
				if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( geometry ) );
				continue;

			}

			if ( doors.length && isDoorLeaf( name ) ) {

				const owner = doorLeafOwner( name, doors );
				const geometry = bake( node );
				if ( owner ) doorParts.get( owner ).push( {
					key: surface,
					geometry,
					hinge: node.getWorldPosition( new THREE.Vector3() )
				} );
				else {

					push( exterior, surface, geometry );
					if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( geometry ) );

				}

				continue;

			}

			if ( ! name.startsWith( EXTERIOR ) ) continue;

			const geometry = bake( node );

			// Older shells merged the leaf into the door material's own mesh.
			let rest = geometry;
			if ( doors.length && isDoorMaterial( key ) ) for ( const door of doors ) {

				const [ leaf, remainder ] = splitAt( rest, door.box );
				if ( leaf ) doorParts.get( door ).push( { key: surface, geometry: leaf, hinge: door.hinge } );
				rest = remainder;
				if ( ! rest ) break;

			}

			if ( rest ) {

				push( exterior, surface, rest );
				if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( rest ) );

			}
			if ( performance.now() - sliceStarted >= MAIN_THREAD_SLICE_MS ) {

				await taskYield();
				sliceStarted = performance.now();

			}

		}

		for ( const door of doors ) {

			const parts = doorParts.get( door );
			if ( parts.length ) attachLeaves( door, parts, ( key ) => this.#material( key ) );

		}

		return {
			parcelId,
			exterior,
			exteriorFlat: exteriorFlat.length ? BufferGeometryUtils.mergeGeometries( exteriorFlat, false ) : null,
			center: centerOf( blueprint ),
			doors: doors.filter( ( door ) => door.pivots.length )
		};

	}

}

/** Ordered concurrent map with a fixed resource ceiling. */
export async function mapConcurrent( values, concurrency, operation ) {

	const results = new Array( values.length );
	let next = 0;

	async function worker() {

		for ( let index = next ++; index < values.length; index = next ++ ) {

			results[ index ] = await operation( values[ index ], index );

		}

	}

	await Promise.all( Array.from( { length: Math.min( concurrency, values.length ) }, worker ) );

	return results;

}

/** Material keys whose rendered surface is also a structural player barrier. */
export function isColliderMaterial( key ) {

	return COLLIDER_KINDS.has( String( key ).split( '/' )[ 1 ] );

}

function taskYield() {

	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

}

function isDoorMaterial( key ) {

	return key.includes( '/door-glass/' ) || key.includes( '/door/' );

}

function isDoorLeaf( name ) {

	return name.startsWith( DOOR ) || name.startsWith( BALCONY );

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
	const leaves = new Map();

	for ( const { key, geometry, hinge } of parts ) {

		const leafKey = hinge.toArray().join( '/' );
		if ( ! leaves.has( leafKey ) ) leaves.set( leafKey, { hinge: hinge.clone(), parts: [] } );
		leaves.get( leafKey ).parts.push( { key, geometry } );

	}

	for ( const { hinge, parts: leafParts } of leaves.values() ) {

		const bounds = new THREE.Box3();
		const pivot = new THREE.Group();
		const colliderParts = [];
		pivot.position.copy( hinge );
		pivot.name = `door:${door.parcelId}:${door.id}:${door.pivots.length}`;

		for ( const { key, geometry } of leafParts ) {

			geometry.computeBoundingBox();
			bounds.union( geometry.boundingBox );
			geometry.translate( - hinge.x, - hinge.y, - hinge.z );
			colliderParts.push( positionsOnly( geometry ) );
			pivot.add( new THREE.Mesh( geometry, material( key ) ) );

		}

		const sign = bounds.getCenter( _centroid ).sub( hinge ).dot( door.along ) >= 0 ? 1 : - 1;
		const colliderGeometry = BufferGeometryUtils.mergeGeometries( colliderParts, false );
		colliderParts.forEach( ( geometry ) => geometry.dispose() );
		door.pivots.push( { pivot, sign, colliderGeometry } );

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
