import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { PropModels, PROP_SIZE } from './PropModels.js';
import { Sites } from './Sites.js';
import { Clearance } from './Clearance.js';

// How often a site is used at all. An alley is where a block puts its rubbish,
// a gap between two buildings is narrow and awkward and only sometimes worth
// it, a back corner is a delivery corner.
const TAKEN = { alley: 0.62, gap: 0.26, corner: 0.34 };
// And what stands there: bags down the alleys, crates at the corners where the
// deliveries come in, either in between.
const BAGS = { alley: 0.74, gap: 0.5, corner: 0.22 };
/** How far a whole pile reaches from the site it stands on. */
const PILE_RADIUS = 0.85;

/**
 * The dressing pass: reads the city's own sites, then decides with one seeded
 * stream what stands at each of them. Same atlas, same rubbish, in the same
 * places, every run.
 *
 * The result is three instanced meshes for the whole city and one merged
 * collider mesh for the things that are solid.
 */
export class Dressing {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param walk `networks.walk` per ../../../../connections/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, walk, factory ) {

		this.atlas = atlas;
		this.walk = walk;
		this.factory = factory;

	}

	/** @returns { group, colliders, counts } */
	build() {

		const models = new PropModels( this.factory );
		const rng = new Rng( seedOf( this.atlas ) );
		const clearance = new Clearance( this.atlas, this.walk );
		const piles = new Map( models.ids.map( ( id ) => [ id, [] ] ) );

		for ( const site of new Sites( this.atlas ).all() ) {

			if ( rng.next() > TAKEN[ site.kind ] ) continue;
			if ( ! clearance.claim( site.x, site.z, PILE_RADIUS ) ) continue;

			if ( rng.next() < BAGS[ site.kind ] ) bagPile( rng, site, piles );
			else crateStack( rng, site, piles );

		}

		return assemble( models, piles );

	}

}

/** One to four bags slumped against the wall, the fourth thrown on top. */
function bagPile( rng, site, piles ) {

	const count = 1 + Math.floor( rng.next() * 4 );
	const out = piles.get( 'bag' );

	for ( let i = 0; i < count; i ++ ) {

		const stacked = i === 3;
		const scale = rng.range( 0.85, 1.2 );
		const along = stacked ? rng.range( - 0.12, 0.12 ) : ( i - ( count - 1 ) / 2 ) * 0.42 + rng.range( - 0.06, 0.06 );
		const outward = rng.range( 0, 0.16 ) + ( stacked ? 0.08 : 0 );
		const rotation = new THREE.Euler( rng.range( - 0.12, 0.12 ), rng.range( 0, Math.PI * 2 ), rng.range( - 0.12, 0.12 ) );

		out.push( place( site, along, outward, stacked ? 0.3 * scale : 0, rotation, scale ) );

	}

}

/** A stack of crates squared up to the wall, with a box or two beside it. */
function crateStack( rng, site, piles ) {

	const facing = Math.atan2( site.nx, site.nz );
	const height = 1 + Math.floor( rng.next() * 3 );
	const crates = piles.get( 'crate' );

	for ( let i = 0; i < height; i ++ ) {

		const rotation = new THREE.Euler( 0, facing + rng.range( - 0.22, 0.22 ), 0 );

		crates.push( place( site, rng.range( - 0.07, 0.07 ), rng.range( - 0.05, 0.05 ), i * PROP_SIZE.crate, rotation, 1 ) );

	}

	const boxes = piles.get( 'box' );
	const beside = Math.floor( rng.next() * 3 );

	for ( let i = 0; i < beside; i ++ ) {

		const rotation = new THREE.Euler( 0, facing + rng.range( - 0.5, 0.5 ), 0 );
		const lifted = i === 2 ? PROP_SIZE.box : 0;

		boxes.push( place( site, 0.62 + i * 0.1, rng.range( - 0.12, 0.12 ), lifted, rotation, 1 ) );

	}

}

/**
 * A prop's transform, in the site's own frame: `along` runs down the wall,
 * `outward` away from it, `lift` up from the pavement it stands on.
 */
function place( site, along, outward, lift, rotation, scale ) {

	const tx = - site.nz;
	const tz = site.nx;

	return new THREE.Matrix4().compose(
		new THREE.Vector3(
			site.x + tx * along + site.nx * outward,
			SIDEWALK_HEIGHT + lift,
			site.z + tz * along + site.nz * outward
		),
		new THREE.Quaternion().setFromEuler( rotation ),
		new THREE.Vector3( scale, scale, scale )
	);

}

/** Every pile of one model into one instanced mesh, and its solids into one trimesh. */
function assemble( models, piles ) {

	const group = new THREE.Group();
	group.name = 'props';

	const solids = [];
	const counts = { total: 0 };

	for ( const id of models.ids ) {

		const matrices = piles.get( id );
		counts[ id ] = matrices.length;
		counts.total += matrices.length;

		if ( ! matrices.length ) continue;

		const mesh = models.mesh( id, matrices.length );

		matrices.forEach( ( matrix, i ) => mesh.setMatrixAt( i, matrix ) );
		group.add( mesh );

		const collider = models.collider( id );

		if ( collider ) {

			for ( const matrix of matrices ) solids.push( collider.clone().applyMatrix4( matrix ) );

		}

	}

	const colliders = new Map();

	if ( solids.length ) colliders.set( 'props', BufferGeometryUtils.mergeGeometries( solids, false ) );

	return { group, colliders, counts };

}

/** The world's seed, whatever shape it arrives in, as one number. */
function seedOf( atlas ) {

	const seed = atlas.meta.seed;

	if ( typeof seed === 'number' ) return seed >>> 0;

	let h = 2166136261;

	for ( let i = 0; i < String( seed ).length; i ++ ) h = Math.imul( h ^ String( seed ).charCodeAt( i ), 16777619 );

	return h >>> 0;

}
