import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { doorFrame } from './DoorGeometry.js';

// The GLB names its nodes `merged:<key>` and `interior:<key>`, but GLTFLoader
// runs node names through PropertyBinding.sanitizeNodeName, which strips the
// animation-path reserved characters `[].:/`. The leading word is all that
// survives intact, so that is what the split matches on. Material names are
// not sanitized, so the material key still arrives whole.
const EXTERIOR = 'merged';
const INTERIOR = 'interior';

/**
 * Every assembled building in the city, loaded once and arranged for the two
 * things the renderer cares about: the shells merge across the whole city by
 * material key, so the skyline costs one draw call per key; each building's
 * interior stays its own group at its real world position, so walking through
 * a door is continuous and the interior can be shown or hidden by distance.
 *
 * The entrance door leaf is lifted out of the shell into its own pivoted mesh
 * so it can swing. Exterior meshes arrive without normals, so they get them.
 */
export class BuildingsLoader {

	constructor( factory ) {

		this.factory = factory;
		this.loader = new GLTFLoader();

	}

	/**
	 * @param buildings Map<parcelId, { blueprint, glbUrl }> from WorldSource
	 * @returns { group, shells, interiors, doors, triangles }
	 */
	async load( buildings ) {

		const loaded = await Promise.all(
			[ ...buildings.values() ].map( ( entry ) => this.#loadOne( entry ) )
		);

		const group = new THREE.Group();
		group.name = 'city';

		const shellByKey = new Map();
		const interiors = new Map();
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

			for ( const [ key, geometries ] of building.interior ) {

				const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
				triangles += merged.getAttribute( 'position' ).count / 3;
				interior.add( new THREE.Mesh( merged, this.factory.build( key ) ) );

			}

			interiors.set( building.parcelId, {
				group: interior,
				geometry: building.interiorFlat,
				center: building.center
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
			const mesh = new THREE.Mesh( merged, this.factory.build( key ) );
			mesh.name = `shell:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		return { group, interiors, doors, shellColliders, triangles };

	}

	async #loadOne( { parcelId, blueprint, glbUrl } ) {

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

		if ( door && doorParts.length ) attachLeaf( door, doorParts, this.factory );
		else if ( door ) door.pivot = null;

		return {
			parcelId,
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
function attachLeaf( door, parts, factory ) {

	const pivot = new THREE.Group();
	pivot.position.copy( door.hinge );
	pivot.name = `door:${door.parcelId}`;

	for ( const { key, geometry } of parts ) {

		geometry.translate( - door.hinge.x, - door.hinge.y, - door.hinge.z );
		pivot.add( new THREE.Mesh( geometry, factory.build( key ) ) );

	}

	door.pivot = pivot;

}

/** Footprint centroid: what distance-based interior loading and culling measure from. */
function centerOf( blueprint ) {

	const ring = blueprint.bounds.footprint;
	const sum = ring.reduce( ( acc, [ x, z ] ) => [ acc[ 0 ] + x, acc[ 1 ] + z ], [ 0, 0 ] );

	return new THREE.Vector3( sum[ 0 ] / ring.length, 0, sum[ 1 ] / ring.length );

}
