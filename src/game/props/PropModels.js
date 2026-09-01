import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// The database has one poor plastic entry and its only variant is the bin bag:
// black and glossy, the cheap object that sells under a good lamp. The moulded
// box wears the same plastic, because that is what a kerbside bin is made of.
const PLASTIC_KEY = 'cyberpunk/plastic/poor';
const PLASTIC_VARIANT = 'bag';
const WOOD_KEY = 'cyberpunk/wood/poor';

const CRATE_SIZE = 0.6;
const BOX = { w: 0.5, h: 0.4, d: 0.44 };

/**
 * The three things a city leaves against a wall, as geometry: a bin bag, a
 * wooden crate and a moulded plastic box. Each is one merged geometry wearing
 * one material, so however many of them the city ends up holding, the dressing
 * is three instanced draws.
 *
 * UVs are metres in model space. An instanced prop is drawn from its own
 * geometry at every one of its positions, so model metres are the only metres
 * its UVs can carry, and they are what the tiled entries expect.
 */
export class PropModels {

	/** @param factory PbrMaterialFactory */
	constructor( factory ) {

		this.entries = new Map( [
			[ 'bag', {
				geometry: bagGeometry(),
				material: factory.build( PLASTIC_KEY, PLASTIC_VARIANT ),
				collider: null
			} ],
			[ 'crate', {
				geometry: crateGeometry(),
				material: factory.build( WOOD_KEY ),
				collider: colliderBox( CRATE_SIZE, CRATE_SIZE, CRATE_SIZE )
			} ],
			[ 'box', {
				geometry: boxGeometry(),
				material: factory.build( PLASTIC_KEY, PLASTIC_VARIANT ),
				collider: colliderBox( BOX.w, BOX.h + 0.05, BOX.d )
			} ]
		] );

	}

	/** Model ids in the order the group draws them. */
	get ids() {

		return [ ...this.entries.keys() ];

	}

	/** @returns an InstancedMesh sized for exactly `count` of this model. */
	mesh( id, count ) {

		const entry = this.entries.get( id );
		const mesh = new THREE.InstancedMesh( entry.geometry, entry.material, count );
		mesh.name = `props:${id}`;
		// One mesh per model spans the whole city, so its bounding sphere is the
		// city and the culling test could only ever cost what it saves.
		mesh.frustumCulled = false;

		return mesh;

	}

	/**
	 * The solid volume of one prop, position only, at the origin, or null for a
	 * prop that is not solid. A bag has none: a sack of rubbish gives way, and a
	 * collider on it would turn a pile of it into a wall.
	 */
	collider( id ) {

		return this.entries.get( id ).collider;

	}

}

/**
 * A sack, not a ball: every vertex is pushed in or out by a hash of where it
 * already is, so duplicated corners move together and the surface stays closed,
 * and the lumps are the same lumps on every run.
 */
function bagGeometry() {

	const sack = new THREE.IcosahedronGeometry( 0.27, 1 );
	const position = sack.getAttribute( 'position' );

	for ( let i = 0; i < position.count; i ++ ) {

		const x = position.getX( i );
		const y = position.getY( i );
		const z = position.getZ( i );
		const wobble = 0.86 + 0.3 * noise( x, y, z );

		position.setXYZ( i, x * wobble * 1.05, y * wobble * 0.82, z * wobble * 1.15 );

	}

	sack.computeVertexNormals();
	sack.translate( 0, 0.23, 0 );

	const neck = new THREE.ConeGeometry( 0.08, 0.14, 5, 1 );
	neck.translate( 0, 0.43, 0 );

	return merge( [ sack, neck ] );

}

/** A slatted crate: the body, with a corner post standing proud on each edge. */
function crateGeometry() {

	const post = 0.075;
	const offset = CRATE_SIZE / 2 - post / 2 + 0.015;
	const parts = [ box( CRATE_SIZE, CRATE_SIZE, CRATE_SIZE, 0, CRATE_SIZE / 2, 0 ) ];

	for ( const sx of [ - 1, 1 ] ) {

		for ( const sz of [ - 1, 1 ] ) {

			parts.push( box( post, CRATE_SIZE + 0.02, post, sx * offset, CRATE_SIZE / 2, sz * offset ) );

		}

	}

	return merge( parts );

}

/** A moulded box: the tub and the rim that lets the next one stack on it. */
function boxGeometry() {

	return merge( [
		box( BOX.w, BOX.h, BOX.d, 0, BOX.h / 2, 0 ),
		box( BOX.w + 0.04, 0.05, BOX.d + 0.04, 0, BOX.h + 0.02, 0 )
	] );

}

function box( w, h, d, x, y, z ) {

	const geometry = new THREE.BoxGeometry( w, h, d );
	geometry.translate( x, y, z );

	return geometry;

}

/** Non-indexed, uv1 dropped, metre UVs written over whatever the primitives had. */
function merge( parts ) {

	const geometry = BufferGeometryUtils.mergeGeometries(
		parts.map( ( part ) => {

			part.deleteAttribute( 'uv1' );

			return part.index ? part.toNonIndexed() : part;

		} ),
		false
	);

	return metreUvs( geometry );

}

/** Metre UVs, projected on the dominant axis of each vertex's own normal. */
function metreUvs( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const normal = geometry.getAttribute( 'normal' );
	const uv = new Float32Array( position.count * 2 );

	for ( let i = 0; i < position.count; i ++ ) {

		const x = position.getX( i );
		const y = position.getY( i );
		const z = position.getZ( i );
		const nx = Math.abs( normal.getX( i ) );
		const ny = Math.abs( normal.getY( i ) );
		const nz = Math.abs( normal.getZ( i ) );
		const [ u, v ] = ny >= nx && ny >= nz ? [ x, z ] : nx >= nz ? [ z, y ] : [ x, y ];

		uv[ i * 2 ] = u;
		uv[ i * 2 + 1 ] = v;

	}

	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );

	return geometry;

}

/** The template a solid prop hands the physics world: position only, no index. */
function colliderBox( w, h, d ) {

	const geometry = new THREE.BoxGeometry( w, h, d ).toNonIndexed();
	geometry.translate( 0, h / 2, 0 );
	geometry.deleteAttribute( 'normal' );
	geometry.deleteAttribute( 'uv' );
	geometry.deleteAttribute( 'uv1' );

	return geometry;

}

/** Float in [0, 1) from a position, quantised so equal corners hash equally. */
function noise( x, y, z ) {

	let h = 2166136261;

	for ( const v of [ x, y, z ] ) h = Math.imul( h ^ Math.round( v * 1000 ), 16777619 );

	return ( h >>> 0 ) / 4294967296;

}
