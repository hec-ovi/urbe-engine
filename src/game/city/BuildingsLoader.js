import { bake } from './GeometryBake.js';
import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { FrameBudget } from '../../app/FrameBudget.js';
import { HitchLog } from '../debug/HitchLog.js';
import { cityGltfLoader } from '../data/CityGltfLoader.js';
import { doorFrames, doorLeafFrame } from './DoorGeometry.js';
import { takeTriangles, centroidAt } from './Triangles.js';
import { bucketFor, splitBucket } from './Variety.js';
import { ScenicSurface } from './ScenicSurface.js';
import { isSceneryNode, shellMaterial, shellScenery, shellVariant } from './ShellSurface.js';
import { cutPlate, interiorStoreys, storeyIndex } from './StoreyPlates.js';
import { BuildingModels } from './BuildingModels.js';
import { ShellBatches } from './ShellBatches.js';

// A moving leaf is the one thing a node name still answers for: each is its
// own node, `door:<id>/leaf:N` or `balcony:<id>/leaf:N`, with an authored
// closed-pose origin. GLTFLoader runs node names through
// PropertyBinding.sanitizeNodeName, which strips the animation-path reserved
// characters `[].:/`, so the leading word is all that survives to match on.
// Material names are not sanitized, so the material key still arrives whole.
const DOOR = 'door';
const BALCONY = 'balcony';
const LOAD_CONCURRENCY = 8;
// Only surfaces that can stop or support a person enter Rapier. Window frames,
// signs, lamps and trim still render, but cooking their small relief geometry
// duplicates millions of triangles without changing the walkable shell.
const COLLIDER_KINDS = new Set( [
	'concrete', 'wall', 'column', 'window-glass', 'door', 'door-glass',
	'concrete-monolith', 'concrete-large-panel',
	'paired-cladding',
	'paired-cladding-metal', 'paired-window-glass',
	'paired-window-black', 'garden-concrete',
	'corporate-panel', 'ivory-panel', 'facade-chrome', 'exterior-cast-concrete',
	'window-glass-opaque', 'window-glass-office',
	'floor-slab', 'roof', 'parapet', 'balcony-slab', 'balcony-rail',
	'roof-artifact', 'ac-unit', 'metal'
] );

/**
 * Loads the requested original shells, merging compatible material and shading
 * batches. Moving leaves keep their authored identities and closed-pose origins.
 * Furnished interiors load separately through InteriorStream.
 */
export class BuildingsLoader {

	/**
	 * @param factory PbrMaterialFactory
	 * @param slice the frame budget reading a shell is paced by
	 * @param hitches the log each step of reading a shell is named in
	 */
	constructor( factory, loader = cityGltfLoader(), modelOptions = {}, slice = new FrameBudget( { paced: false } ), hitches = new HitchLog() ) {

		this.factory = factory;
		this.loader = loader;
		this.modelOptions = modelOptions;
		this.slice = slice;
		this.hitches = hitches;

	}

	/**
	 * @param buildings Map<parcelId, { blueprint, shellUrl }> from WorldSource
	 * @returns { group, doors, shellColliders, centers, triangles }
	 */
	async load( buildings ) {

		const models = await new BuildingModels( url => this.loader.loadAsync( url ), this.modelOptions ).load( buildings );
		try {

			const city = await this.#loadShells( buildings );
			if ( models.group.children.length ) city.group.add( models.group );
			city.triangles += models.triangles;
			return { ...city, unresolvedModelInstances: models.unresolved, disposeModelInstances: () => models.dispose() };

		} catch ( error ) {

			models.dispose();
			throw error;

		}

	}

	async #loadShells( buildings ) {

		const loaded = await mapConcurrent(
			[ ...buildings.values() ], LOAD_CONCURRENCY, ( entry ) => this.#loadOne( entry )
		);

		const group = new THREE.Group();
		group.name = 'city';

		const shellBatches = new ShellBatches();
		const doors = [];
		const entrances = [];
		const unsupportedDoors = [];
		const shellColliders = new Map();
		const centers = new Map();
		let triangles = 0;

		for ( const building of loaded ) {

			unsupportedDoors.push( ...building.unsupportedDoors );

			for ( const [ surface, geometries ] of building.exterior ) {

				const { key, variantId: authoredVariant, doubleSided } = splitBucket( surface );
				const bucket = bucketFor( key, shellVariant( this.factory, {
					key, authored: authoredVariant, parcelId: building.parcelId
				} ), doubleSided );
				shellBatches.add( bucket, geometries );

			}

			shellColliders.set( building.parcelId, building.exteriorFlat );
			centers.set( building.parcelId, building.center );

			for ( const door of building.doors ) {

				for ( const { pivot } of door.pivots ) group.add( pivot );

				doors.push( door );
				if ( door.role === 'main' ) entrances.push( door );

			}

		}

		for ( const { key, scenic, geometries } of shellBatches.values() ) {

			await this.slice.step();

			this.hitches.time( 'shell merge', () => {

				const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
				geometries.forEach( ( g ) => g.dispose() );
				triangles += merged.getAttribute( 'position' ).count / 3;
				const baseMaterial = shellMaterial( this.factory, splitBucket( key ) );
				const mesh = new THREE.Mesh( merged, scenic ? ScenicSurface.material( baseMaterial ) : baseMaterial );
				mesh.name = `shell:${key}`;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				group.add( mesh );

			} );

		}

		return { group, doors, entrances, shellColliders, centers, triangles, unsupportedDoors };

	}

	async #loadOne( { parcelId, blueprint, shellUrl, interior = null, hasInterior = true } ) {

		const gltf = await this.loader.loadAsync( shellUrl );
		const scenic = new ScenicSurface( blueprint );
		gltf.scene.updateMatrixWorld( true );

		const exterior = new Map();
		const frames = doorFrames( blueprint );
		const doors = hasInterior ? frames.filter( door => door.motion.supported ) : [];
		const unsupportedDoors = ( hasInterior ? frames : [] ).filter( door => ! door.motion.supported ).map( door => ( {
			parcelId, id: door.id, kind: door.motion.kind
		} ) );
		const doorParts = new Map( doors.map( ( door ) => [ door, [] ] ) );
		const exteriorFlat = [];
		// What this building's own floors cover, so its storey plates keep the
		// band around them and give up the rest.
		const storeys = hasInterior ? interiorStoreys( parcelId, interior ) : new Map();

		const meshes = [];
		gltf.scene.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );

		for ( const node of meshes ) {

			// Ahead of the branches, because the window scenery a node can carry
			// is the most expensive of them and every branch leaves the loop.
			await this.slice.step();

			this.hitches.time( 'shell surface', () => this.#readNode( node, { frames, doors, doorParts, exterior, exteriorFlat, scenic, hasInterior, storeys, blueprint } ) );

		}

		for ( const door of doors ) {

			const parts = doorParts.get( door );
			if ( parts.length ) attachLeaves( door, parts, ( key ) => shellMaterial( this.factory, splitBucket( key ) ) );
			door.motion.validateLeaves( door.pivots );

		}

		return {
			parcelId,
			unsupportedDoors,
			exterior,
			exteriorFlat: exteriorFlat.length ? BufferGeometryUtils.mergeGeometries( exteriorFlat, false ) : null,
			center: centerOf( blueprint ),
			doors: doors.filter( ( door ) => door.pivots.length )
		};

	}

	/** One mesh node of a shell into the surface, leaf, plate or scenery it stands as. */
	#readNode( node, { frames, doors, doorParts, exterior, exteriorFlat, scenic, hasInterior, storeys, blueprint } ) {

		const name = node.name ?? '';
		const key = node.material?.name ?? '';
		const leafFrame = doorLeafFrame( node, frames );
		const surface = bucketFor(
			key,
			shellVariant( this.factory, { key, authored: node.material?.userData?.materialVariant, blueprint } ),
			node.material?.side === THREE.DoubleSide
		);
		if ( isSceneryNode( node ) ) {

			const geometry = shellScenery( node, this.factory, { key, hasInterior, scenic } );
			if ( geometry ) push( exterior, surface, geometry );
			return;

		}

		const storey = storeyIndex( node );

		if ( storey !== null ) {

			// A furnished floor draws and stands its own slab, so the plate keeps
			// only the band outside it: coplanar with it they flicker, and over
			// its stair and lift wells the plate seals them both ways.
			const whole = bake( node );
			const envelope = storeys.get( storey )?.rect ?? null;
			const plate = envelope ? cutPlate( whole, envelope ) : whole;

			if ( plate !== whole ) whole.dispose();
			if ( ! plate ) return;

			push( exterior, surface, plate );
			if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( plate ) );
			return;

		}
		if ( ( ! hasInterior && ( leafFrame || isDoorLeaf( name ) ) ) || ( leafFrame && ! leafFrame.owner.motion.supported ) ) {

			const geometry = bake( node );
			push( exterior, surface, geometry );
			if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( geometry ) );
			return;

		}

		if ( doors.length && ( leafFrame || isDoorLeaf( name ) ) ) {

			const geometry = bake( node );
			if ( leafFrame ) doorParts.get( leafFrame.owner ).push( {
				key: surface,
				geometry,
				index: leafFrame.index,
				hinge: leafFrame.node.getWorldPosition( new THREE.Vector3() )
			} );
			else {

				push( exterior, surface, geometry );
				if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( geometry ) );

			}

			return;

		}

		// Everything else the shell publishes, whatever the producer called
		// it: a family signs itself with parts named after itself, and a
		// name has never said whether a surface is part of the building.
		const geometry = bake( node );

		// Older shells merged the leaf into the door material's own mesh.
		let rest = geometry;
		if ( doors.length && isDoorMaterial( key ) ) for ( const door of doors ) {

			if ( door.motion.kind === 'pocket' ) continue;

			const [ leaf, remainder ] = splitAt( rest, door.box );
			if ( leaf ) doorParts.get( door ).push( { key: surface, geometry: leaf, hinge: door.hinge } );
			rest = remainder;
			if ( ! rest ) break;

		}

		if ( rest ) {

			push( exterior, surface, rest );
			if ( isColliderMaterial( key ) ) exteriorFlat.push( positionsOnly( rest ) );

		}


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
 * Named leaf indices own every moving material part. Closed-pose geometry is
 * local to its authored origin; metadata-free merged leaves group by hinge.
 */
function attachLeaves( door, parts, material ) {

	door.pivots = [];
	const leaves = new Map();

	for ( const { key, geometry, hinge, index } of parts ) {

		const leafKey = index ?? hinge.toArray().join( '/' );
		if ( ! leaves.has( leafKey ) ) leaves.set( leafKey, { index, hinge: hinge.clone(), parts: [] } );
		leaves.get( leafKey ).parts.push( { key, geometry } );

	}

	for ( const { index, hinge, parts: leafParts } of leaves.values() ) {

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
		const leaf = { pivot, index, sign, colliderGeometry };
		door.motion.prepare( leaf, door.along );
		door.pivots.push( leaf );

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
