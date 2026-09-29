/*
 * Carried over from the NPC Studio (codex_npcs, src/body-surface.js): the
 * one-time refinement of the source body's coarse waist, seat and upper thigh,
 * which the fitted trousers and the seat control rest on.
 */
import { BufferAttribute, Vector3 } from 'three/webgpu';

/** Triangles between yields: a few milliseconds of the loops below. */
const BATCH = 1024;

/**
 * The body's surface with its seat sampled off the authored smooth surface:
 * long source edges across the waist, seat and upper thigh are split at a
 * point on the cubic through their ends' normals, twice, so the rear reads
 * round instead of polygonal under trousers and with any seat setting. Every
 * source vertex, its UVs, skin and normal stay as they were; an inserted
 * vertex takes the mean UV and the blended skin of its edge, and adjacent
 * triangles share every split, so there are no T-junctions. The regular
 * bodies gain about a fifth more triangles, once per body for the run.
 *
 * @param body the source body, a SkinnedMesh whose skeleton names the bones
 * @returns the refined geometry, or the source one when it has nothing to refine
 */
export function* refineSurface( body ) {

	const source = body.geometry;
	if ( source.userData.seatSurface || ! source.index || ! source.attributes.normal || ! source.attributes.skinWeight ) return source;
	source.computeBoundingBox();
	const height = source.boundingBox.max.y - Math.min( 0, source.boundingBox.min.y );
	const lower = body.skeleton.bones.map( ( { name } ) => /^(pelvis|spine_|thigh_)/.test( name ) );
	let geometry = source;
	for ( const edgeLength of [ 0.013, 0.013 ] ) {

		const next = yield* refine( geometry, height, lower, edgeLength );
		if ( geometry !== source ) geometry.dispose();
		geometry = next;

	}
	geometry.userData.seatSurface = {
		originalVertices: source.attributes.position.count,
		originalTriangles: source.index.count / 3,
		vertices: geometry.attributes.position.count,
		triangles: geometry.index.count / 3
	};
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;

}

function* refine( source, height, lowerBones, minimumEdgeLength ) {

	const attributes = Object.entries( source.attributes );
	const data = Object.fromEntries( attributes.map( ( [ name, attribute ] ) => {

		const values = new Array( attribute.count * attribute.itemSize );
		for ( let i = 0; i < values.length; i ++ ) values[ i ] = attribute.getComponent( Math.floor( i / attribute.itemSize ), i % attribute.itemSize );
		return [ name, values ];

	} ) );
	const { position, normal, skinIndex, skinWeight } = source.attributes;
	const count = position.count;
	const points = Array.from( { length: count }, ( _, i ) => new Vector3().fromBufferAttribute( position, i ) );
	const lowerWeights = points.map( ( _, i ) => {

		let amount = 0;
		for ( let slot = 0; slot < 4; slot ++ ) if ( lowerBones[ skinIndex.getComponent( i, slot ) ] ) amount += skinWeight.getComponent( i, slot );
		return amount;

	} );
	// UV seams keep separate UV values but one geometric curve and one skin:
	// vertices at the same point weld for the curve.
	const welds = new Map();
	const welded = points.map( ( point ) => {

		const key = point.toArray().map( ( n ) => n.toFixed( 7 ) ).join( ',' );
		if ( ! welds.has( key ) ) welds.set( key, welds.size );
		return welds.get( key );

	} );
	const normalSums = Array.from( { length: welds.size }, () => new Vector3() );
	for ( let i = 0; i < count; i ++ ) normalSums[ welded[ i ] ].add( new Vector3().fromBufferAttribute( normal, i ) );
	for ( const sum of normalSums ) sum.normalize();
	const edgeKey = ( a, b ) => Math.min( welded[ a ], welded[ b ] ) * welds.size + Math.max( welded[ a ], welded[ b ] );
	const curves = new Map();
	const edges = new Map();
	const index = source.index.array;
	for ( let offset = 0; offset < index.length; offset += 3 ) {

		if ( offset % ( BATCH * 3 ) === 0 ) yield;
		for ( let side = 0; side < 3; side ++ ) {

			const a = index[ offset + side ];
			const b = index[ offset + ( side + 1 ) % 3 ];
			const key = edgeKey( a, b );
			if ( curves.has( key ) ) continue;
			curves.set( key, curve( a, b ) );

		}

	}

	function curve( a, b ) {

		const midpoint = points[ a ].clone().add( points[ b ] ).multiplyScalar( 0.5 );
		const y = midpoint.y / height;
		const z = midpoint.z / height;
		const mask = smoothstep( 0.42, 0.465, y ) * ( 1 - smoothstep( 0.625, 0.675, y ) ) * ( 1 - smoothstep( - 0.015, 0.025, z ) );
		const edge = points[ b ].clone().sub( points[ a ] );
		const length = edge.length();
		if ( mask < 0.01 || Math.min( lowerWeights[ a ], lowerWeights[ b ] ) < 0.5 || length < height * minimumEdgeLength ) return null;
		const na = normalSums[ welded[ a ] ];
		const nb = normalSums[ welded[ b ] ];
		// Cubic point/normal interpolation halfway along the edge: its end
		// tangents follow the authored surface, not the straight chord.
		const bulge = nb.clone().multiplyScalar( edge.dot( nb ) ).addScaledVector( na, - edge.dot( na ) ).multiplyScalar( mask / 8 );
		bulge.clampLength( 0, length * 0.18 );
		midpoint.add( bulge );
		const influences = new Map();
		for ( const vertex of [ a, b ] ) for ( let slot = 0; slot < 4; slot ++ ) {

			const bone = skinIndex.getComponent( vertex, slot );
			influences.set( bone, ( influences.get( bone ) ?? 0 ) + skinWeight.getComponent( vertex, slot ) / 2 );

		}
		const sorted = [ ...influences ].filter( ( [ , weight ] ) => weight > 0 )
			.sort( ( [ boneA, weightA ], [ boneB, weightB ] ) => weightB - weightA || boneA - boneB ).slice( 0, 4 );
		const sum = sorted.reduce( ( total, [ , weight ] ) => total + weight, 0 );
		while ( sorted.length < 4 ) sorted.push( [ 0, 0 ] );
		return {
			midpoint, normal: na.clone().add( nb ).normalize(),
			joints: sorted.map( ( [ bone ] ) => bone ), weights: sorted.map( ( [ , weight ] ) => weight / sum )
		};

	}

	function middle( a, b ) {

		const split = curves.get( edgeKey( a, b ) );
		if ( ! split ) return - 1;
		const key = Math.min( a, b ) * count + Math.max( a, b );
		if ( edges.has( key ) ) return edges.get( key );
		const next = data.position.length / 3;
		for ( const [ name, attribute ] of attributes ) {

			const values = name === 'position' ? split.midpoint.toArray()
				: name === 'normal' ? split.normal.toArray()
					: name === 'skinIndex' ? split.joints : name === 'skinWeight' ? split.weights
						: Array.from( { length: attribute.itemSize }, ( _, slot ) => ( attribute.getComponent( a, slot ) + attribute.getComponent( b, slot ) ) / 2 );
			data[ name ].push( ...values );

		}
		edges.set( key, next );
		return next;

	}

	const indices = [];
	const counts = new Uint32Array( index.length / 3 );
	for ( let offset = 0; offset < index.length; offset += 3 ) {

		if ( offset % ( BATCH * 3 ) === 0 ) yield;
		const a = index[ offset ], b = index[ offset + 1 ], c = index[ offset + 2 ];
		const ab = middle( a, b ), bc = middle( b, c ), ca = middle( c, a );
		const start = indices.length;
		// The mixed cases split only the refined edges, so a patch's boundary
		// triangles meet the unrefined ones without T-junctions.
		if ( ab >= 0 && bc >= 0 && ca >= 0 ) indices.push( a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca );
		else if ( ab >= 0 && bc >= 0 ) indices.push( b, bc, ab, a, ab, c, ab, bc, c );
		else if ( bc >= 0 && ca >= 0 ) indices.push( c, ca, bc, b, bc, a, bc, ca, a );
		else if ( ca >= 0 && ab >= 0 ) indices.push( a, ab, ca, c, ca, b, ca, ab, b );
		else if ( ab >= 0 ) indices.push( a, ab, c, ab, b, c );
		else if ( bc >= 0 ) indices.push( b, bc, a, bc, c, a );
		else if ( ca >= 0 ) indices.push( c, ca, b, ca, a, b );
		else indices.push( a, b, c );
		counts[ offset / 3 ] = indices.length - start;

	}
	const geometry = source.clone();
	for ( const [ name, attribute ] of attributes ) {

		const values = data[ name ];
		const next = new BufferAttribute( new attribute.array.constructor( values.length ), attribute.itemSize, attribute.normalized );
		if ( attribute.normalized ) {

			for ( let i = 0; i < values.length; i ++ ) next.setComponent( Math.floor( i / attribute.itemSize ), i % attribute.itemSize, values[ i ] );

		} else next.array.set( values );
		next.setUsage( attribute.usage );
		next.gpuType = attribute.gpuType;
		geometry.setAttribute( name, next );

	}
	geometry.setIndex( indices );
	geometry.clearGroups();
	let start = 0;
	for ( const group of source.groups ) {

		let total = 0;
		for ( let face = group.start / 3; face < ( group.start + group.count ) / 3; face ++ ) total += counts[ face ];
		geometry.addGroup( start, total, group.materialIndex );
		start += total;

	}
	return geometry;

}

function smoothstep( min, max, value ) {

	const t = Math.max( 0, Math.min( 1, ( value - min ) / ( max - min ) ) );
	return t * t * ( 3 - 2 * t );

}
