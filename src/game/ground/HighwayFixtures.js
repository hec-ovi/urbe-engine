import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { abs, clamp, float, length, mx_noise_float, positionWorld, smoothstep, uv, vec2, vec3 } from 'three/tsl';
import { kelvinColor } from '../light/Color.js';

/** A pier needs this much room under the deck before it carries a lamp. */
const HEADROOM = 4;
/** Sodium under the deck, warmer than the street lamps, as underpasses are lit. */
const LAMP_KELVIN = 2100;
const LAMP_LUMENS = 5200;
const LAMP_RANGE = 15;
const LENS_EMISSIVE = 220;
const CONDUIT = 0.045, PIPE = 0.075;
const KEYS = { metal: [ 'cyberpunk/metal/poor', 'zinc' ], cable: [ 'cyberpunk/prop-polymer/poor', 'charcoal' ], lens: [ 'cyberpunk/light-fixture/mid', 'panel' ] };

/**
 * What hangs on and drips from a highway's piers, planned from the structure
 * alone so the lights the city counts and the meshes a ground tile draws agree:
 * on every pier with headroom, a sodium lamp under the cross-head on the face
 * toward one carriageway or the other in turn, its conduit run down the face to
 * a junction box at chest height; on the opposite face a drain pipe from the
 * deck to an outfall at the foot, and the puddle it leaves; and between
 * neighbouring piers a cable slung under the deck, sagging.
 *
 * @returns `[{ x, z, out: [nx, nz], along: [tx, tz], half, bottom, top }]` one per pier with headroom
 */
export function highwayPiers( structure ) {

	const piers = [];
	structure.supports.forEach( ( support, index ) => {

		if ( Math.abs( support.bottom ) > 0.5 || support.top - support.bottom < HEADROOM ) return;
		const [ x, z ] = support.position ?? centre( support.footprint );
		const along = tangentAt( structure.path, x, z );
		const out = [ along[ 1 ], - along[ 0 ] ];
		// How far the pier's own faces stand from its centre across and along the route.
		const reach = ( axis ) => Math.max( ...support.footprint.map( ( [ px, pz ] ) => Math.abs( ( px - x ) * axis[ 0 ] + ( pz - z ) * axis[ 1 ] ) ) );
		const side = index % 2 ? 1 : - 1;
		piers.push( { index, x, z, out: [ out[ 0 ] * side, out[ 1 ] * side ], along, half: reach( out ), length: reach( along ), bottom: support.bottom, top: support.top } );

	} );

	return piers;

}

/** The lights the city's lighting counts for every highway's pier lamps. */
export function highwayGlows( atlas ) {

	const color = kelvinColor( LAMP_KELVIN );
	return ( atlas.streets?.highwayStructures ?? [] ).flatMap( ( structure ) => highwayPiers( structure ).map( ( pier ) => ( {
		position: new THREE.Vector3( pier.x + pier.out[ 0 ] * ( pier.half + 0.32 ), pier.top - 1.15, pier.z + pier.out[ 1 ] * ( pier.half + 0.32 ) ),
		color, lumens: LAMP_LUMENS, range: LAMP_RANGE
	} ) ) );

}

/**
 * The fixtures' meshes for these structures, one per material.
 * @param ground `(x, z) => y` the top of the ground at a point
 */
export function highwayFixtures( structures, factory, ground ) {

	const parts = { metal: [], cable: [], lens: [], puddle: [] };
	for ( const structure of structures ) {

		const piers = highwayPiers( structure );
		piers.forEach( ( pier, n ) => {

			const at = ( out, along, y ) => [ pier.x + pier.out[ 0 ] * out + pier.along[ 0 ] * along, y, pier.z + pier.out[ 1 ] * out + pier.along[ 1 ] * along ];
			const turn = Math.atan2( pier.out[ 0 ], pier.out[ 1 ] );
			const face = pier.half;
			// The lamp: a housing on a short bracket, the lens on its underside.
			parts.metal.push( box( [ 0.36, 0.2, 0.46 ], at( face + 0.32, 0, pier.top - 1.0 ), turn ) );
			parts.metal.push( box( [ 0.06, 0.06, 0.34 ], at( face + 0.12, 0, pier.top - 0.98 ), turn ) );
			parts.lens.push( box( [ 0.28, 0.03, 0.38 ], at( face + 0.32, 0, pier.top - 1.115 ), turn ) );
			// Its conduit down the face to a junction box, and on to the ground.
			parts.metal.push( box( [ CONDUIT, pier.top - 1.0 - 0.25, CONDUIT ], at( face + CONDUIT / 2, 0.55, ( pier.top - 1.0 + pier.bottom + 0.25 ) / 2 ), turn ) );
			parts.metal.push( box( [ 0.14, 0.42, 0.3 ], at( face + 0.07, 0.55, pier.bottom + 1.35 ), turn ) );
			// A drain pipe from the deck down the far face, out at the foot.
			const back = [ - pier.out[ 0 ], - pier.out[ 1 ] ];
			const pipeAt = ( out, y ) => [ pier.x + back[ 0 ] * out - pier.along[ 0 ] * 0.45, y, pier.z + back[ 1 ] * out - pier.along[ 1 ] * 0.45 ];
			const pipe = new THREE.CylinderGeometry( PIPE, PIPE, pier.top - pier.bottom - 0.35, 10 );
			pipe.translate( ...pipeAt( face + PIPE + 0.03, ( pier.top + pier.bottom + 0.35 ) / 2 ) );
			parts.metal.push( pipe );
			const outfall = new THREE.CylinderGeometry( PIPE, PIPE, 0.42, 10 );
			outfall.rotateX( Math.PI / 2 ); outfall.rotateY( Math.atan2( back[ 0 ], back[ 1 ] ) );
			outfall.translate( ...pipeAt( face + PIPE + 0.21, pier.bottom + 0.38 ) );
			parts.metal.push( outfall );
			// The water it leaves on the ground, spread away from the pier.
			const [ px, , pz ] = pipeAt( face + 1.15, 0 );
			parts.puddle.push( puddle( px, ground( px, pz ) + 0.012, pz, Math.atan2( back[ 0 ], back[ 1 ] ), 1.8 + ( pier.index % 3 ) * 0.35, 1.25 ) );
			// A cable slung under the deck to the next pier along.
			const next = piers[ n + 1 ];
			if ( next && Math.hypot( next.x - pier.x, next.z - pier.z ) < 60 && next.index === pier.index + 1 ) {

				const from = new THREE.Vector3( pier.x, pier.top - 0.55, pier.z ), to = new THREE.Vector3( next.x, next.top - 0.55, next.z );
				const offset = new THREE.Vector3( pier.out[ 0 ], 0, pier.out[ 1 ] ).multiplyScalar( face - 0.1 );
				from.add( offset ); to.add( offset );
				const mid = from.clone().lerp( to, 0.5 ); mid.y -= 0.45;
				const curve = new THREE.QuadraticBezierCurve3( from, mid, to );
				parts.cable.push( new THREE.TubeGeometry( curve, 14, 0.022, 6, false ) );

			}

		} );

	}
	const meshes = [];
	// Only the housings and pipes are solid; water, cables and lenses are walked through or out of reach.
	const add = ( name, geometries, material, { shadow = true, solid = true } = {} ) => {

		if ( ! geometries.length ) return;
		const merged = mergeGeometries( geometries.map( ( geometry ) => ( geometry.index ? geometry.toNonIndexed() : geometry ) ), false );
		geometries.forEach( ( geometry ) => geometry.dispose() );
		const mesh = new THREE.Mesh( merged, material );
		mesh.name = `highway:${name}`;
		mesh.castShadow = shadow; mesh.receiveShadow = true;
		if ( ! solid ) mesh.userData.groundModule = { role: 'marking' };
		meshes.push( mesh );

	};
	add( 'fixtures', parts.metal, factory.build( ...KEYS.metal ) );
	add( 'cables', parts.cable, factory.build( ...KEYS.cable ), { solid: false } );
	add( 'lamp-lenses', parts.lens, typeof factory.variant === 'function'
		? factory.variant( KEYS.lens[ 0 ], { variantId: KEYS.lens[ 1 ], emissiveLevel: LENS_EMISSIVE, emissive: kelvinColor( LAMP_KELVIN ) } )
		: factory.build( ...KEYS.lens ), { shadow: false, solid: false } );
	add( 'puddles', parts.puddle, puddleMaterial(), { shadow: false, solid: false } );

	return meshes;

}

/** A box of `size` metres at `position`, turned about Y. */
function box( size, position, turn ) {

	const geometry = new THREE.BoxGeometry( ...size );
	geometry.rotateY( turn );
	geometry.translate( ...position );
	return geometry;

}

/** A flat oval of `length` by `width` metres at a point, its long axis turned about Y. */
function puddle( x, y, z, turn, length, width ) {

	const geometry = new THREE.PlaneGeometry( width, length, 1, 1 );
	geometry.rotateX( - Math.PI / 2 );
	geometry.rotateY( turn );
	geometry.translate( x, y, z );
	return geometry;

}

let shared = null;

/**
 * Standing water: dark, mirror-smooth, its edge broken by noise read in world
 * metres so no two puddles share an outline, fading to a damp rim.
 */
function puddleMaterial() {

	if ( shared ) return shared;
	const material = new THREE.MeshStandardNodeMaterial( { name: 'highway:puddle', transparent: true, depthWrite: false, metalness: 0 } );
	const radial = length( uv().sub( 0.5 ).mul( vec2( 2, 2 ) ) );
	const edge = mx_noise_float( positionWorld.xz.mul( 1.7 ) ).mul( 0.22 ).add( mx_noise_float( positionWorld.xz.mul( 5.3 ) ).mul( 0.08 ) );
	const water = smoothstep( 0.62, 0.86, radial.add( edge ) ).oneMinus();
	const damp = smoothstep( 0.78, 1.0, radial.add( edge.mul( 0.7 ) ) ).oneMinus();
	material.colorNode = vec3( 0.012, 0.013, 0.014 ).mul( float( 1 ).add( abs( edge ).mul( 0.5 ) ) );
	material.roughnessNode = clamp( float( 0.55 ).sub( water.mul( 0.5 ) ), 0.03, 1 );
	material.opacityNode = clamp( damp.mul( 0.55 ).add( water.mul( 0.4 ) ), 0, 0.92 );
	material.polygonOffset = true; material.polygonOffsetFactor = - 2; material.polygonOffsetUnits = - 2;
	shared = material;
	return material;

}

function centre( ring ) {

	return [ 0, 1 ].map( ( axis ) => ring.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / ring.length );

}

/** The route's unit direction at the segment nearest a point. */
function tangentAt( path, x, z ) {

	let best = [ 1, 0 ], nearest = Infinity;
	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ], [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax, dz = bz - az, span = Math.hypot( dx, dz );
		if ( span < 1e-6 ) continue;
		const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( span * span ) ) );
		const distance = Math.hypot( ax + dx * t - x, az + dz * t - z );
		if ( distance < nearest ) { nearest = distance; best = [ dx / span, dz / span ]; }

	}

	return best;

}
