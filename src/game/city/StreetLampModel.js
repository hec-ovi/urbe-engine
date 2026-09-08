import * as THREE from 'three/webgpu';
import { kelvinColor } from '../light/Color.js';

const POLE_HEIGHT = 6.4;
const POLE_RADIUS = 0.085;
/** The pole is tapered; the collider is one cylinder around its widest point. */
const POLE_COLLIDER_RADIUS = 0.14;
const BEND_RADIUS = 0.36;
const ARM_REACH = 0.72;
const HEAD_LENGTH = 1.65;
const HEAD_WIDTH = 0.22;
const HEAD_HEIGHT = 0.13;
const LENS_SEGMENTS = 5;
const LENS_LENGTH = 0.28;
const LENS_WIDTH = 0.16;
const LENS_GAP = 0.035;
// Street fixture output, luminous flux and colour temperature.
const LAMP_LUMENS = 24000;
const LAMP_KELVIN = 5000;
const LAMP_RANGE = 26;
const LENS_KEY = 'cyberpunk/light-fixture/mid';
const POLE_KEY = 'cyberpunk/metal/rich';
/**
 * A lens is looked at directly, so it has to sit above the exposure the road
 * is judged at or it reads as painted plastic rather than as the source.
 */
const LENS_EMISSIVE = 270;

// A wall pack over a service door: 3000 lm is a 30 W LED head, one eighth of the
// street luminaire's flux, on the same lamp colour so an alley reads as part of
// the same city.
export const WALL_LUMENS = 3000;
const WALL_RANGE = 13;
/** Above a doorway, below the first-floor windows. */
const WALL_HEIGHT = 4;
/** How far the lens stands off the wall, on its bracket. */
const BRACKET_OUT = 0.16;

export const LAMP_RADIUS = POLE_COLLIDER_RADIUS;
export const LAMP_REACH = LAMP_RANGE;

/** Geometry-free authored pose, clearance envelope and photometric output. */
export function streetLampDescriptor( { x, z, ax, az } ) {

	const base = 0.12, aimLength = Math.hypot( ax, az ) || 1;
	ax /= aimLength; az /= aimLength;
	const headY = base + POLE_HEIGHT - HEAD_HEIGHT / 2;
	const along = ARM_REACH + HEAD_LENGTH / 2 - LENS_LENGTH / 2;
	const hx = x + ax * along, hz = z + az * along;
	return {
		post: { x, z, base, height: POLE_HEIGHT - BEND_RADIUS - HEAD_HEIGHT / 2, radius: POLE_COLLIDER_RADIUS,
			head: { center: new THREE.Vector3( hx, headY, hz ), aim: new THREE.Vector3( ax, 0, az ),
				length: HEAD_LENGTH, width: HEAD_WIDTH, height: HEAD_HEIGHT, underside: headY - HEAD_HEIGHT / 2 } },
		glow: { position: new THREE.Vector3( hx, headY - HEAD_HEIGHT / 2 - 0.12, hz ),
			color: kelvinColor( LAMP_KELVIN ), lumens: LAMP_LUMENS, range: LAMP_RANGE }
	};

}

export function wallPackDescriptor( { px, pz, nx, nz } ) {

	return { position: new THREE.Vector3( px + nx * ( BRACKET_OUT + 0.16 ), WALL_HEIGHT - 0.1, pz + nz * ( BRACKET_OUT + 0.16 ) ),
		color: kelvinColor( LAMP_KELVIN ), lumens: WALL_LUMENS, range: WALL_RANGE };

}

export function wallPackAssembly() {

	const bracket = new THREE.BoxGeometry( BRACKET_OUT, 0.1, 0.12 );
	bracket.translate( BRACKET_OUT / 2, WALL_HEIGHT, 0 );
	const lens = new THREE.BoxGeometry( 0.1, 0.14, 0.34 );
	lens.translate( BRACKET_OUT + 0.05, WALL_HEIGHT - 0.02, 0 );
	return { structure: [ strip( bracket ) ], lenses: [ strip( lens ) ] };

}

export function streetLampMaterials( factory ) {

	return { structure: factory.build( POLE_KEY ), lenses: factory.variant( LENS_KEY, {
		variantId: 'panel', emissiveLevel: LENS_EMISSIVE, emissive: kelvinColor( LAMP_KELVIN )
	} ) };

}

export function streetLampAssembly( { x, z, ax, az } ) {

	const base = 0.12;
	const aimLength = Math.hypot( ax, az ) || 1;
	ax /= aimLength;
	az /= aimLength;
	const facing = - Math.atan2( az, ax );
	const headY = base + POLE_HEIGHT - HEAD_HEIGHT / 2;
	const straightHeight = POLE_HEIGHT - BEND_RADIUS - HEAD_HEIGHT / 2;
	const structure = [];
	const lenses = [];

	const pole = new THREE.CylinderGeometry( POLE_RADIUS, POLE_RADIUS * 1.5, straightHeight, 8, 1 );
	pole.translate( x, base + straightHeight / 2, z );
	structure.push( strip( pole ) );

	const bend = new THREE.TubeGeometry( new THREE.QuadraticBezierCurve3(
		new THREE.Vector3( 0, base + straightHeight, 0 ),
		new THREE.Vector3( 0, headY, 0 ),
		new THREE.Vector3( BEND_RADIUS, headY, 0 )
	), 8, POLE_RADIUS * 0.72, 6, false );
	bend.rotateY( facing );
	bend.translate( x, 0, z );
	structure.push( strip( bend ) );

	const armLength = ARM_REACH - BEND_RADIUS;
	const arm = new THREE.CylinderGeometry( POLE_RADIUS * 0.72, POLE_RADIUS * 0.72, armLength, 6, 1 );
	arm.rotateZ( Math.PI / 2 );
	arm.rotateY( facing );
	arm.translate(
		x + ax * ( BEND_RADIUS + armLength / 2 ),
		headY,
		z + az * ( BEND_RADIUS + armLength / 2 )
	);
	structure.push( strip( arm ) );

	// The socket enters the housing by half a segment.
	const headAlong = ARM_REACH + HEAD_LENGTH / 2 - LENS_LENGTH / 2;
	const hx = x + ax * headAlong;
	const hz = z + az * headAlong;
	const housing = new THREE.BoxGeometry( HEAD_LENGTH, HEAD_HEIGHT, HEAD_WIDTH );
	housing.rotateY( facing );
	housing.translate( hx, headY, hz );
	structure.push( strip( housing ) );

	const lensRun = LENS_SEGMENTS * LENS_LENGTH + ( LENS_SEGMENTS - 1 ) * LENS_GAP;

	for ( let i = 0; i < LENS_SEGMENTS; i ++ ) {

		const offset = - lensRun / 2 + LENS_LENGTH / 2 + i * ( LENS_LENGTH + LENS_GAP );
		const lens = new THREE.PlaneGeometry( LENS_LENGTH, LENS_WIDTH );
		fixtureUv( lens );
		// PlaneGeometry faces +Z. Rotate its face to -Y, then turn its long
		// dimension from local +X into the route-facing aim.
		lens.rotateX( Math.PI / 2 );
		lens.rotateY( facing );
		lens.translate( hx + ax * offset, headY - HEAD_HEIGHT / 2 - 0.001, hz + az * offset );
		lenses.push( lens.toNonIndexed() );

	}

	return { structure, lenses, ...streetLampDescriptor( { x, z, ax, az } ) };

}

/** One 0.16 x 0.28 material tile fitted to one 0.16 x 0.28 diffuser face. */
function fixtureUv( geometry ) {

	const uv = geometry.getAttribute( 'uv' );

	for ( let i = 0; i < uv.count; i ++ ) {

		const u = uv.getX( i );
		const v = uv.getY( i );
		uv.setXY( i, v * LENS_WIDTH, u * LENS_LENGTH );

	}

	return geometry;

}

/** Primitive geometries carry uv sets we never use; drop everything but the basics. */
function strip( geometry ) {

	geometry.deleteAttribute( 'uv1' );

	return geometry.index ? geometry.toNonIndexed() : geometry;

}
