import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { doorFrame } from './DoorGeometry.js';
import { buildRooms, reflectanceOf } from './InteriorRooms.js';
import { kelvinColor } from '../light/Kelvin.js';

// The GLB names its nodes `merged:<key>` and `interior:<key>`, but GLTFLoader
// runs node names through PropertyBinding.sanitizeNodeName, which strips the
// animation-path reserved characters `[].:/`. The leading word is all that
// survives intact, so that is what the split matches on. Material names are
// not sanitized, so the material key still arrives whole.
const EXTERIOR = 'merged';
const INTERIOR = 'interior';

const FIXTURE = '/light-fixture/';
/** A lit diffuser is looked at directly, so it sits well above road exposure. */
const FIXTURE_EMISSIVE = 60;
const FIXTURE_KELVIN = 2700;

/**
 * Every assembled building in the city, loaded once and arranged for the two
 * things the renderer cares about: the shells merge across the whole city by
 * material key, so the skyline costs one draw call per key; each building's
 * interior stays its own group at its real world position, so walking through
 * a door is continuous and the interior can be shown or hidden by distance.
 *
 * Inside that group the interior is cut into the rooms the interior box
 * published (InteriorRooms), so each room can be lit by its own fixtures and
 * shown on its own. Geometry belonging to no room (cores, stairs, the inside
 * of the facade) stays one mesh per material key.
 *
 * The entrance door leaf is lifted out of the shell into its own pivoted mesh
 * so it can swing. Exterior meshes arrive without normals, so they get them.
 */
export class BuildingsLoader {

	/**
	 * @param factory PbrMaterialFactory
	 * @param rooms RoomLights, which owns every interior material: what belongs
	 * to no room takes the dim set, so a stairwell is lit air rather than a hole.
	 */
	constructor( factory, rooms ) {

		this.factory = factory;
		this.rooms = rooms;
		this.loader = new GLTFLoader();

	}

	/**
	 * @param buildings Map<parcelId, { blueprint, floors, glbUrl }> from WorldSource
	 * @returns { group, interiors, rooms, doors, shellColliders, triangles }
	 */
	async load( buildings ) {

		const loaded = await Promise.all(
			[ ...buildings.values() ].map( ( entry ) => this.#loadOne( entry ) )
		);

		const reflectance = await this.#reflectance( loaded );

		const group = new THREE.Group();
		group.name = 'city';

		const shellByKey = new Map();
		const interiors = new Map();
		const rooms = [];
		const doors = [];
		const shellColliders = new Map();
		let triangles = 0;

		for ( const building of loaded ) {

			for ( const [ key, geometries ] of building.exterior ) {

				if ( ! shellByKey.has( key ) ) shellByKey.set( key, [] );

				shellByKey.get( key ).push( ...geometries );

			}

			shellColliders.set( building.parcelId, building.exteriorFlat );

			const interior = new THREE.Group();
			interior.name = `interior:${building.parcelId}`;

			const cut = buildRooms( building.parcelId, building.interior, building.floors, reflectance );

			for ( const [ key, geometries ] of cut.shared ) {

				const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
				geometries.forEach( ( g ) => g.dispose() );
				triangles += merged.getAttribute( 'position' ).count / 3;
				interior.add( new THREE.Mesh( merged, this.rooms.materialFor( this.rooms.dim, key ) ) );

			}

			for ( const room of cut.rooms ) {

				triangles += room.triangles;
				room.group.visible = false;
				interior.add( room.group );
				rooms.push( room );

			}

			interiors.set( building.parcelId, {
				group: interior,
				geometry: building.interiorFlat,
				center: building.center,
				rooms: cut.rooms
			} );
			group.add( interior );

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

		return { group, interiors, rooms, doors, shellColliders, triangles };

	}

	/**
	 * Reflectance per interior material key: the level from what the surface
	 * is, the hue measured off its own base colour map. The room fill light
	 * needs both, and one pass over the union of keys pays for the whole city.
	 */
	async #reflectance( loaded ) {

		const keys = new Set();

		for ( const building of loaded ) {

			for ( const key of building.interior.keys() ) keys.add( key );

		}

		const tints = new Map( await Promise.all(
			[ ...keys ].map( async ( key ) => [ key, await this.factory.tint( key ) ] )
		) );

		return ( key ) => reflectanceOf( key, tints.get( key ) );

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

	async #loadOne( { parcelId, blueprint, floors, glbUrl } ) {

		const gltf = await this.loader.loadAsync( glbUrl );
		gltf.scene.updateMatrixWorld( true );

		const exterior = new Map();
		const interior = new Map();
		const door = doorFrame( blueprint );
		const doorParts = [];
		const exteriorFlat = [];
		const interiorFlat = [];

		gltf.scene.traverse( ( node ) => {

			if ( ! node.isMesh ) return;

			const name = node.name ?? '';
			const key = node.material?.name ?? '';
			const geometry = bake( node );

			if ( name.startsWith( INTERIOR ) ) {

				push( interior, key, geometry );
				interiorFlat.push( positionsOnly( geometry ) );

				return;

			}

			if ( ! name.startsWith( EXTERIOR ) ) return;

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
			floors,
			exterior,
			interior,
			exteriorFlat: exteriorFlat.length ? BufferGeometryUtils.mergeGeometries( exteriorFlat, false ) : null,
			interiorFlat: interiorFlat.length ? BufferGeometryUtils.mergeGeometries( interiorFlat, false ) : null,
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
function bake( mesh ) {

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

function positionsOnly( geometry ) {

	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

	return copy;

}

/** Splits triangles whose centroid falls inside `box` off into their own geometry. */
function splitAt( geometry, box ) {

	const position = geometry.getAttribute( 'position' );
	const inside = [];
	const outside = [];
	const centroid = new THREE.Vector3();
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();

	for ( let i = 0; i < position.count; i += 3 ) {

		a.fromBufferAttribute( position, i );
		b.fromBufferAttribute( position, i + 1 );
		c.fromBufferAttribute( position, i + 2 );
		centroid.copy( a ).add( b ).add( c ).multiplyScalar( 1 / 3 );
		( box.containsPoint( centroid ) ? inside : outside ).push( i );

	}

	if ( ! inside.length ) return [ null, geometry ];

	const take = ( indices ) => {

		if ( ! indices.length ) return null;

		const out = new THREE.BufferGeometry();

		for ( const name of [ 'position', 'normal', 'uv' ] ) {

			const source = geometry.getAttribute( name );

			if ( ! source ) continue;

			const size = source.itemSize;
			const data = new Float32Array( indices.length * 3 * size );
			let write = 0;

			for ( const start of indices ) {

				for ( let v = 0; v < 3; v ++ ) {

					for ( let k = 0; k < size; k ++ ) {

						data[ write ++ ] = source.array[ ( start + v ) * size + k ];

					}

				}

			}

			out.setAttribute( name, new THREE.BufferAttribute( data, size ) );

		}

		return out;

	};

	const result = [ take( inside ), take( outside ) ];
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
