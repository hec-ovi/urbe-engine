import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { materialColor, materialRoughness } from 'three/tsl';
import binding from '../../../../materials/bindings/highway-materials.json' with { type: 'json' };
import { buildHighwayModel, HIGHWAY_MATERIAL_SLOTS } from './HighwayModel.js';
import { graffiti } from '../surface-detail/HighwayWear.js';
import { highwayFixtures } from './HighwayFixtures.js';

const ROAD_KEY = 'cyberpunk/road/high_rich';
const STRUCTURE_KEY = 'cyberpunk/concrete/rich';
const MITRE_LIMIT = 2.5;
/** The wear each concrete part wears ([HighwayWear](../surface-detail/HighwayWear.js)). */
const WEAR = Object.freeze( {
	'deck-concrete': 'highway-deck', 'soffit-concrete': 'highway-soffit',
	'pier-concrete': 'highway-pier', 'barrier-concrete': 'highway-barrier'
} );
/** What a worn part reads besides its geometry; the other parts drop it. */
const WORN_ATTRIBUTES = [ '_highway_source', '_highway_face', '_highway_context' ];
/** The sheets of tags the piers are sprayed with. */
const GRAFFITI = { key: 'cyberpunk/graffiti-atlas/poor', variant: 'markers' };
const RESOURCES = Symbol.for( 'urbe.material-resources' );
const FAR = 1e6;

/**
 * Atlas highway structures drawn as their authored model
 * ([HighwayModel](HighwayModel.js)): a box-girder deck with its drip kerf and
 * fascia, the soffit, chamfered piers with their bearing seats and
 * diaphragms, expansion joints over every support and a parapet each side,
 * one mesh per material part for the whole city. Atlas owns every dimension
 * and location; the model only shapes them. The parapets stand outside the
 * carriageway width Atlas publishes, a barrier's width each side.
 *
 * Each part wears the Materials highway binding
 * (`materials/bindings/highway-materials.json`): the lane-marked highway road
 * on the carriageway, the formed, soffit and pier concretes, brushed steel
 * bearings and rubber joints. A theme that lacks the highway concrete keeps
 * the city's plain concrete. Where the factory wears exteriors, the concrete
 * parts wear the structure's own weathering: splash at each pier's foot,
 * deposits under the joints, runoff down the fascia and parapets, tyre spray
 * and scuffs on the road face of the parapets. Where the theme has the
 * graffiti atlas, most piers are sprayed with tags at chest height.
 */
export class Highways {

	constructor( atlas, factory ) {

		this.structures = atlas.streets?.highwayStructures ?? [];
		this.ground = atlas.volumetric?.ground ?? [];
		this.factory = factory;

	}

	/** @returns { group, colliderGeometry, triangles } */
	build() {

		const group = new THREE.Group();
		group.name = 'highways';
		const parts = new Map( HIGHWAY_MATERIAL_SLOTS.map( ( slot ) => [ slot, [] ] ) );

		for ( let i = 0; i < this.structures.length; i ++ ) {

			const structure = this.structures[ i ];
			const label = `highwayStructures[${i}]`;
			sectionsOf( structure, label );
			structure.supports.forEach( ( support, j ) => validateSupport( support, `${label}.supports[${j}]` ) );
			const model = buildHighwayModel( structure );
			const joints = model.detail.joints.map( ( joint ) => joint.station ).sort( ( a, b ) => a - b );
			for ( const part of model.parts ) parts.get( part.slot ).push( prepared( part, joints, structure ) );

		}

		const solid = [];
		let triangles = 0;
		for ( const [ slot, geometries ] of parts ) {

			const merged = merge( geometries );
			if ( ! merged ) continue;
			const mesh = new THREE.Mesh( merged, this.#material( slot ) );
			mesh.name = slot === 'roadway' ? 'highway:roadway' : `highway:${slot}`;
			mesh.receiveShadow = true;
			mesh.castShadow = slot !== 'roadway';
			group.add( mesh );
			solid.push( merged );
			triangles += merged.getAttribute( 'position' ).count / 3;

		}

		const colliderGeometry = solid.length ? BufferGeometryUtils.mergeGeometries( solid.map( positionsOnly ), false ) : null;
		// Lamps, conduits, drain pipes, puddles and cables on and under the piers (HighwayFixtures).
		if ( this.structures.length ) for ( const mesh of highwayFixtures( this.structures, this.factory, ( x, z ) => this.#groundAt( x, z ) ) ) group.add( mesh );

		return { group, colliderGeometry, triangles };

	}

	/** One part's material: the binding's finish with its tuning, worn where the factory wears exteriors. */
	#material( slot ) {

		if ( slot === 'roadway' ) return this.factory.build( ROAD_KEY, 'highway' );
		const definition = binding.slots[ slot ];
		const { key, variant } = definition?.source ?? {};
		// A theme without the highway finishes keeps the plain concrete it always had.
		if ( ! key || ( this.factory.resolver && ! this.factory.resolver.resolve( key ) ) ) return this.factory.build( STRUCTURE_KEY );
		if ( typeof this.factory.variant !== 'function' ) return this.factory.build( key, variant );
		const material = this.factory.variant( key, { variantId: variant, ...( WEAR[ slot ] ? { weather: WEAR[ slot ] } : {} ) } );
		const tune = definition.tuning;
		if ( tune && ! material.userData.highwayTuned ) {

			material.normalScale?.set( ...tune.normalScale );
			material.aoMapIntensity = tune.aoIntensity;
			material.color?.multiply( new THREE.Color().setRGB( ...tune.colorGain, THREE.LinearSRGBColorSpace ) );
			material.userData.highwayTuned = true;
			if ( slot === 'pier-concrete' ) this.#spray( material );

		}

		return material;

	}

	/** The top of the authored ground at a point, the carriageway's level where none is known. */
	#groundAt( x, z ) {

		let top = null;
		for ( const cover of this.ground ) if ( inside( cover.polygon, x, z ) ) top = Math.max( top ?? - Infinity, cover.top ?? 0 );
		return top ?? 0;

	}

	/** Tags sprayed over a pier material's own colour and roughness, worn or not. */
	#spray( material ) {

		if ( ! this.factory.resolver?.resolve( GRAFFITI.key ) || typeof this.factory.dataMap !== 'function' ) return;
		const atlas = this.factory.dataMap( GRAFFITI.key, GRAFFITI.variant, 'basecolor', { srgb: true, wrap: 'clamp' } );
		const sprayed = graffiti( atlas.texture, {
			color: material.colorNode ?? materialColor.rgb, roughness: material.roughnessNode ?? materialRoughness
		} );
		material.colorNode = sprayed.color;
		material.roughnessNode = sprayed.roughness;
		// A sprayed pier compiles its own program, not one of the same maps without the paint.
		material.wearProfile = `${material.wearProfile ?? ''}+graffiti`;
		material[ RESOURCES ] = [ ...( material[ RESOURCES ] ?? [] ), atlas ];
		material.userData.highwayGraffiti = GRAFFITI.key;

	}

}

/**
 * A model part made ready to merge with the same part of other structures:
 * its face flags as floats, and `_highway_context` (owning support base and
 * top, the joints either side) worked out once here, so no shader searches the
 * supports or joints. A part no wear reads keeps only what it draws with.
 */
function prepared( part, joints, structure ) {

	const geometry = part.geometry;
	if ( ! WEAR[ part.slot ] ) {

		for ( const name of WORN_ATTRIBUTES ) geometry.deleteAttribute( name );
		return geometry;

	}
	const source = geometry.getAttribute( '_highway_source' ), face = geometry.getAttribute( '_highway_face' );
	const count = source.count;
	const flags = new Float32Array( count );
	for ( let i = 0; i < count; i ++ ) flags[ i ] = face.getX( i );
	const context = new Float32Array( count * 4 );
	// Unowned concrete (deck, soffit, parapets) has no support base.
	for ( let i = 0; i < count; i ++ ) { context[ i * 4 ] = - FAR; context[ i * 4 + 1 ] = - FAR; }
	const ownership = geometry.userData.highwayContent?.ownership;
	for ( const range of ownership?.ownerRanges ?? [] ) {

		const support = range.support >= 0 ? ownership.supportTable[ range.support ] : null;
		if ( ! support ) continue;
		for ( let i = range.start; i < range.start + range.count; i ++ ) { context[ i * 4 ] = support.bottom; context[ i * 4 + 1 ] = support.top; }

	}
	// Each triangle keeps one pair of joints, bracketing its mean station, so
	// a vertex standing on a joint does not pick a side of its own; a face
	// that spans a joint (a diaphragm over its pier) keeps that joint both ways.
	for ( let i = 0; i < count; i += 3 ) {

		const stations = [ source.getX( i ), source.getX( i + 1 ), source.getX( i + 2 ) ];
		const [ low, high ] = [ Math.min( ...stations ), Math.max( ...stations ) ];
		const spanned = joints.find( ( joint ) => joint > low + 1e-4 && joint < high - 1e-4 );
		const [ left, right ] = spanned === undefined ? bracket( joints, ( stations[ 0 ] + stations[ 1 ] + stations[ 2 ] ) / 3 ) : [ spanned, spanned ];
		for ( let j = i; j < i + 3; j ++ ) { context[ j * 4 + 2 ] = left; context[ j * 4 + 3 ] = right; }

	}
	geometry.setAttribute( '_highway_face', new THREE.Float32BufferAttribute( flags, 1 ) );
	geometry.setAttribute( '_highway_context', new THREE.Float32BufferAttribute( context, 4 ) );
	// A pier's faces are sprayed about its own centre.
	if ( part.slot === 'pier-concrete' ) {

		const centres = new Float32Array( count * 2 );
		for ( const range of ownership?.ownerRanges ?? [] ) {

			const support = structure.supports[ range.support ];
			if ( ! support ) continue;
			const [ x, z ] = support.position ?? centreOf( support.footprint );
			for ( let i = range.start; i < range.start + range.count; i ++ ) { centres[ i * 2 ] = x; centres[ i * 2 + 1 ] = z; }

		}
		geometry.setAttribute( '_highway_pier', new THREE.Float32BufferAttribute( centres, 2 ) );

	}

	return geometry;

}

function inside( ring, x, z ) {

	let crossed = false;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ xi, zi ] = ring[ i ], [ xj, zj ] = ring[ j ];
		if ( ( zi > z ) !== ( zj > z ) && x < ( xj - xi ) * ( z - zi ) / ( zj - zi ) + xi ) crossed = ! crossed;

	}
	return crossed;

}

/** The mean of a footprint's corners. */
function centreOf( ring ) {

	return [ 0, 1 ].map( ( axis ) => ring.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / ring.length );

}

/** The joints either side of a station, far away where there is none. */
function bracket( joints, station ) {

	let low = 0, high = joints.length;
	while ( low < high ) {

		const mid = ( low + high ) >> 1;
		if ( joints[ mid ] <= station ) low = mid + 1;
		else high = mid;

	}

	return [ low > 0 ? joints[ low - 1 ] : - FAR, low < joints.length ? joints[ low ] : FAR ];

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
