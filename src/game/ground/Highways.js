import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { skirt } from './Polygons.js';

const ROAD_KEY = 'cyberpunk/road/high_rich';
const STRUCTURE_KEY = 'cyberpunk/concrete/rich';
const MITRE_LIMIT = 2.5;

/**
 * Atlas highway structures turned into the deck, ramp and support geometry
 * they describe. Atlas owns every dimension and location. This consumer only
 * interpolates its path and elevation profile, including profile breakpoints
 * that fall inside a centerline segment.
 */
export class Highways {

	constructor( atlas, factory ) {

		this.structures = atlas.streets?.highwayStructures ?? [];
		this.factory = factory;

	}

	/** @returns { group, colliderGeometry, triangles } */
	build() {

		const group = new THREE.Group();
		group.name = 'highways';
		const tops = [];
		const concrete = [];

		for ( let i = 0; i < this.structures.length; i ++ ) {

			const structure = this.structures[ i ];
			const label = `highwayStructures[${i}]`;
			const sections = sectionsOf( structure, label );
			tops.push( topOf( sections, structure.width ) );
			concrete.push( slabOf( sections, structure.deckThickness ) );

			for ( let j = 0; j < structure.supports.length; j ++ ) {

				const support = structure.supports[ j ];
				validateSupport( support, `${label}.supports[${j}]` );
				concrete.push( skirt( support.footprint, support.top, support.bottom ) );

			}

		}

		const road = merge( tops );
		const frame = merge( concrete );

		if ( road ) {

			const mesh = new THREE.Mesh( road, this.factory.build( ROAD_KEY, 'highway' ) );
			mesh.name = 'highway:roadway';
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		if ( frame ) {

			const mesh = new THREE.Mesh( frame, this.factory.build( STRUCTURE_KEY ) );
			mesh.name = 'highway:structure';
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		const pieces = [ road, frame ].filter( Boolean );
		const colliderGeometry = pieces.length ? BufferGeometryUtils.mergeGeometries( pieces.map( positionsOnly ), false ) : null;
		const triangles = pieces.reduce( ( count, geometry ) => count + geometry.getAttribute( 'position' ).count / 3, 0 );

		return { group, colliderGeometry, triangles };

	}

}

function sectionsOf( structure, label ) {

	const { path, elevationProfile: profile, width, deckThickness, supports } = structure;

	if ( ! Array.isArray( path ) || path.length < 2 ) fail( `${label}.path`, 'must contain at least two points' );
	if ( path.some( ( point ) => ! point2( point ) ) ) fail( `${label}.path`, 'must contain finite [x,z] points' );
	if ( ! Number.isFinite( width ) || width <= 0 ) fail( `${label}.width`, 'must be positive' );
	if ( ! Number.isFinite( deckThickness ) || deckThickness <= 0 ) fail( `${label}.deckThickness`, 'must be positive' );
	if ( ! Array.isArray( supports ) ) fail( `${label}.supports`, 'must be an array' );

	const pathRun = cumulative( path );
	const length = pathRun.at( - 1 );

	if ( ! ( length > 0 ) ) fail( `${label}.path`, 'must have positive length' );
	validateProfile( profile, length, `${label}.elevationProfile` );

	const distances = uniqueSorted( [ ...pathRun, ...profile.map( ( point ) => point.distance ) ] );
	const centers = distances.map( ( distance ) => {

		const [ x, z ] = pointAlong( path, pathRun, distance );

		return { x, y: levelAt( profile, distance ), z, distance };

	} );
	const half = width / 2;

	return centers.map( ( center, i ) => {

		const offset = mitre( centers, i, half );

		return {
			...center,
			left: [ center.x + offset[ 0 ], center.y, center.z + offset[ 1 ] ],
			right: [ center.x - offset[ 0 ], center.y, center.z - offset[ 1 ] ]
		};

	} );

}

function topOf( sections, width ) {

	const positions = [];
	const uvs = [];

	for ( let i = 0; i < sections.length - 1; i ++ ) {

		const a = sections[ i ];
		const b = sections[ i + 1 ];
		push( positions, a.left, b.left, a.right, a.right, b.left, b.right );
		uvs.push(
			0, a.distance, 0, b.distance, width, a.distance,
			width, a.distance, 0, b.distance, width, b.distance
		);

	}

	return geometry( positions, uvs );

}

/** The underside, both fascia faces and end caps. The road surface closes the top. */
function slabOf( sections, thickness ) {

	const positions = [];
	const uvs = [];
	const bottom = ( point ) => [ point[ 0 ], point[ 1 ] - thickness, point[ 2 ] ];

	for ( let i = 0; i < sections.length - 1; i ++ ) {

		const a = sections[ i ];
		const b = sections[ i + 1 ];
		const al = bottom( a.left );
		const ar = bottom( a.right );
		const bl = bottom( b.left );
		const br = bottom( b.right );

		push( positions, al, ar, bl, ar, br, bl );
		push( positions, a.left, al, b.left, al, bl, b.left );
		push( positions, a.right, b.right, ar, ar, b.right, br );

		for ( let face = 0; face < 3; face ++ ) {

			uvs.push(
				a.distance, a.y, a.distance, a.y - thickness, b.distance, b.y,
				a.distance, a.y - thickness, b.distance, b.y - thickness, b.distance, b.y
			);

		}

	}

	const first = sections[ 0 ];
	const last = sections.at( - 1 );
	push( positions,
		first.left, first.right, bottom( first.left ), first.right, bottom( first.right ), bottom( first.left ),
		last.left, bottom( last.left ), last.right, last.right, bottom( last.left ), bottom( last.right )
	);
	uvs.push( ...new Array( 24 ).fill( 0 ) );

	return geometry( positions, uvs );

}

function mitre( centers, i, half ) {

	const previous = centers[ Math.max( 0, i - 1 ) ];
	const current = centers[ i ];
	const next = centers[ Math.min( centers.length - 1, i + 1 ) ];
	const before = direction( previous, current, next );
	const after = direction( current, next, previous );
	const a = [ - before[ 1 ], before[ 0 ] ];
	const b = [ - after[ 1 ], after[ 0 ] ];

	if ( i === 0 ) return [ b[ 0 ] * half, b[ 1 ] * half ];
	if ( i === centers.length - 1 ) return [ a[ 0 ] * half, a[ 1 ] * half ];

	const sum = [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ] ];
	const size = Math.hypot( ...sum );

	if ( size < 1e-6 ) return [ b[ 0 ] * half, b[ 1 ] * half ];

	const axis = [ sum[ 0 ] / size, sum[ 1 ] / size ];
	const cosine = Math.max( 1 / MITRE_LIMIT, axis[ 0 ] * b[ 0 ] + axis[ 1 ] * b[ 1 ] );
	const reach = half / cosine;

	return [ axis[ 0 ] * reach, axis[ 1 ] * reach ];

}

function direction( a, b, fallback ) {

	let dx = b.x - a.x;
	let dz = b.z - a.z;
	let length = Math.hypot( dx, dz );

	if ( length < 1e-6 ) {

		dx = fallback.x - a.x;
		dz = fallback.z - a.z;
		length = Math.hypot( dx, dz );

	}

	return [ dx / length, dz / length ];

}

function cumulative( path ) {

	const out = [ 0 ];

	for ( let i = 1; i < path.length; i ++ ) {

		out.push( out[ i - 1 ] + Math.hypot( path[ i ][ 0 ] - path[ i - 1 ][ 0 ], path[ i ][ 1 ] - path[ i - 1 ][ 1 ] ) );

	}

	return out;

}

function pointAlong( path, run, distance ) {

	let i = 1;

	while ( i < run.length - 1 && run[ i ] < distance ) i ++;

	const span = run[ i ] - run[ i - 1 ];
	const t = span > 0 ? ( distance - run[ i - 1 ] ) / span : 0;

	return [
		path[ i - 1 ][ 0 ] + ( path[ i ][ 0 ] - path[ i - 1 ][ 0 ] ) * t,
		path[ i - 1 ][ 1 ] + ( path[ i ][ 1 ] - path[ i - 1 ][ 1 ] ) * t
	];

}

function levelAt( profile, distance ) {

	let i = 1;

	while ( i < profile.length - 1 && profile[ i ].distance < distance ) i ++;

	const a = profile[ i - 1 ];
	const b = profile[ i ];
	const span = b.distance - a.distance;
	const t = span > 0 ? ( distance - a.distance ) / span : 0;

	return a.level + ( b.level - a.level ) * t;

}

function validateProfile( profile, length, label ) {

	if ( ! Array.isArray( profile ) || profile.length < 2 ) fail( label, 'must contain at least two points' );

	for ( let i = 0; i < profile.length; i ++ ) {

		const point = profile[ i ];

		if ( ! Number.isFinite( point?.distance ) || ! Number.isFinite( point?.level ) ) fail( `${label}[${i}]`, 'must be finite' );
		if ( i > 0 && point.distance <= profile[ i - 1 ].distance ) fail( label, 'distances must increase' );

	}

	if ( Math.abs( profile[ 0 ].distance ) > 1e-6 || Math.abs( profile.at( - 1 ).distance - length ) > 1e-6 ) {

		fail( label, 'must cover the complete path' );

	}

}

function validateSupport( support, label ) {

	if ( ! Array.isArray( support?.footprint ) || support.footprint.length < 3 || support.footprint.some( ( point ) => ! point2( point ) ) ) {

		fail( `${label}.footprint`, 'must be a polygon of finite [x,z] points' );

	}

	if ( ! Number.isFinite( support.bottom ) || ! Number.isFinite( support.top ) || support.top <= support.bottom ) {

		fail( label, 'must have finite increasing bottom and top' );

	}

}

function uniqueSorted( values ) {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );

	return sorted.filter( ( value, i ) => i === 0 || Math.abs( value - sorted[ i - 1 ] ) > 1e-8 );

}

function geometry( positions, uvs ) {

	const result = new THREE.BufferGeometry();
	result.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	result.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	result.computeVertexNormals();

	return result;

}

function merge( geometries ) {

	if ( ! geometries.length ) return null;

	const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
	geometries.forEach( ( geometry ) => geometry.dispose() );

	return merged;

}

function positionsOnly( geometry ) {

	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

	return copy;

}

function push( positions, ...points ) {

	for ( const point of points ) positions.push( ...point );

}

function point2( point ) {

	return Array.isArray( point ) && point.length === 2 && point.every( Number.isFinite );

}

function fail( field, reason ) {

	const error = new Error( `E_HIGHWAY_STRUCTURE: ${field} ${reason}` );
	error.code = 'E_HIGHWAY_STRUCTURE';
	throw error;

}
