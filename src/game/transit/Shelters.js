import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { kelvinColor } from '../light/Color.js';
import { box, tube, merge, solid } from './Shapes.js';

// One shelter off the shelf, in the dimensions a real one is made in: 4 m of
// kerb, 1.4 m deep so it still fits the 1.8 m sidewalk the narrowest bus
// street carries, roof at 2.5 m, bench at seat height.
const LENGTH = 4;
const DEPTH = 1.4;
const ROOF = 2.5;
const POST = 0.09;
const SEAT_HEIGHT = 0.55;
const PANEL_BASE = 0.35;
const PANEL_TOP = 2.25;
// The flag sign stands clear of the shelter at the kerb end, its faces along
// the street, which is where a waiting passenger and a driver both read it.
const SIGN_AT = [ LENGTH / 2 + 0.55, 0.45 ];
const SIGN_HEIGHT = 2.4;
const SIGN_SIZE = [ 0.62, 0.52 ];

const STRUCTURE_KEY = 'cyberpunk/metal/rich';
const GLASS_KEY = 'cyberpunk/glass/mid';
const SIGN_KEY = 'cyberpunk/signage/mid';
/**
 * A sign box is looked at directly from a couple of metres away, so its panel
 * has to sit above the exposure the street is judged at or it reads as printed
 * card rather than as a lit box.
 */
const SIGN_EMISSIVE = 26;
// The fixture behind that panel: one small LED box, which is tens of watts and
// a few hundred lumens, at the cool white a transit sign is lit in.
const SIGN_LUMENS = 180;
const SIGN_KELVIN = 5000;
const SIGN_RANGE = 9;

/**
 * A shelter and a sign post on every atlas bus stop. The stop carries the
 * street edge it belongs to, and the edge's centreline says which way the
 * roadway is: the shelter turns its back panel to the buildings and opens onto
 * the kerb, which is the only orientation that lets someone inside watch for
 * the bus.
 *
 * One shelter is modelled once and instanced at every stop, so a city of
 * shelters costs three draws: the metal frame, the glass panels, and the lit
 * sign box. A blueprint with no bus stops builds nothing at all.
 */
export class Shelters {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	/** @returns { group, glows, collider } */
	build() {

		const group = new THREE.Group();
		group.name = 'bus-shelters';

		const edges = new Map( this.atlas.streets.edges.map( ( edge ) => [ edge.id, edge ] ) );
		const spots = ( this.atlas.transit?.busStops ?? [] )
			.map( ( stop ) => frameOf( stop, edges ) )
			.filter( Boolean );

		if ( ! spots.length ) return { group, glows: [], collider: null };

		const model = this.#model();
		const meshes = [
			instanced( model.structure, this.factory.build( STRUCTURE_KEY ), spots.length, 'shelter:frame' ),
			instanced( model.glass, this.factory.build( GLASS_KEY ), spots.length, 'shelter:glass' ),
			instanced( model.sign, this.factory.variant( SIGN_KEY, {
				emissiveScale: SIGN_EMISSIVE,
				emissive: kelvinColor( SIGN_KELVIN )
			} ), spots.length, 'shelter:sign' )
		];

		const matrix = new THREE.Matrix4();
		const glows = [];
		const colliders = [];

		spots.forEach( ( spot, i ) => {

			matrix.compose(
				new THREE.Vector3( spot.x, 0, spot.z ),
				new THREE.Quaternion().setFromAxisAngle( UP, Math.atan2( spot.fx, spot.fz ) ),
				ONE
			);

			for ( const mesh of meshes ) mesh.setMatrixAt( i, matrix );

			glows.push( {
				position: model.signPoint.clone().applyMatrix4( matrix ),
				color: kelvinColor( SIGN_KELVIN ),
				lumens: SIGN_LUMENS,
				range: SIGN_RANGE
			} );

			colliders.push( model.collider.clone().applyMatrix4( matrix ) );

		} );

		group.add( ...meshes );

		return { group, glows, collider: solid( colliders ) };

	}

	/**
	 * The shelter itself, modelled once around the origin with +Z pointing at
	 * the roadway and +X running along the kerb. Only the frame and the roof
	 * are solid: glass panels and the sign box are things you walk past, and a
	 * collider on each would triple the trimesh for nothing.
	 */
	#model() {

		const frame = [];
		const glass = [];
		const hard = [];

		for ( const sx of [ - 1, 1 ] ) {

			for ( const sz of [ - 1, 1 ] ) {

				const post = box( POST, ROOF - SIDEWALK_HEIGHT, POST );
				post.translate( sx * ( LENGTH / 2 - 0.15 ), ( ROOF + SIDEWALK_HEIGHT ) / 2, sz * ( DEPTH / 2 - 0.1 ) );
				frame.push( post );
				hard.push( post );

			}

		}

		const roof = box( LENGTH + 0.2, 0.14, DEPTH + 0.3 );
		roof.translate( 0, ROOF + 0.07, 0 );
		frame.push( roof );
		hard.push( roof );

		const seat = box( LENGTH - 0.7, 0.07, 0.42 );
		seat.translate( 0, SIDEWALK_HEIGHT + SEAT_HEIGHT, - 0.42 );
		frame.push( seat );

		for ( const sx of [ - 1, 1 ] ) {

			const leg = box( 0.06, SEAT_HEIGHT - 0.04, 0.34 );
			leg.translate( sx * ( LENGTH / 2 - 0.6 ), SIDEWALK_HEIGHT + ( SEAT_HEIGHT - 0.04 ) / 2, - 0.42 );
			frame.push( leg );

		}

		const back = box( LENGTH - 0.1, PANEL_TOP - PANEL_BASE, 0.02 );
		back.translate( 0, SIDEWALK_HEIGHT + ( PANEL_BASE + PANEL_TOP ) / 2, - DEPTH / 2 - 0.02 );
		glass.push( back );

		for ( const sx of [ - 1, 1 ] ) {

			const end = box( 0.02, PANEL_TOP - PANEL_BASE, DEPTH - 0.1 );
			end.translate( sx * ( LENGTH / 2 + 0.01 ), SIDEWALK_HEIGHT + ( PANEL_BASE + PANEL_TOP ) / 2, 0 );
			glass.push( end );

		}

		const [ signX, signZ ] = SIGN_AT;
		const mast = tube( 0.055, SIGN_HEIGHT - SIDEWALK_HEIGHT, 8 );
		mast.translate( signX, ( SIGN_HEIGHT + SIDEWALK_HEIGHT ) / 2, signZ );
		frame.push( mast );
		hard.push( mast );

		const panel = box( 0.06, SIGN_SIZE[ 0 ], SIGN_SIZE[ 1 ] );
		panel.translate( signX, SIGN_HEIGHT + SIGN_SIZE[ 0 ] / 2 - 0.1, signZ );

		return {
			structure: merge( frame ),
			glass: merge( glass ),
			sign: panel,
			signPoint: new THREE.Vector3( signX, SIGN_HEIGHT + SIGN_SIZE[ 0 ] / 2 - 0.1, signZ ),
			collider: solid( hard )
		};

	}

}

const UP = new THREE.Vector3( 0, 1, 0 );
const ONE = new THREE.Vector3( 1, 1, 1 );

function instanced( geometry, material, count, name ) {

	const mesh = new THREE.InstancedMesh( geometry, material, count );
	mesh.name = name;
	mesh.count = count;
	mesh.castShadow = true;
	mesh.instanceMatrix.needsUpdate = true;

	return mesh;

}

/**
 * Where a stop stands and which way its roadway is: the stop sits on the
 * sidewalk, so the shortest way back to its edge's centreline is the way the
 * shelter has to face. A stop whose edge the blueprint no longer carries is
 * dropped rather than guessed at.
 */
function frameOf( stop, edges ) {

	const edge = edges.get( stop.edgeId );

	if ( ! edge ) return null;

	const [ x, z ] = stop.position;
	const near = nearestOn( edge.path, x, z );
	const dx = near[ 0 ] - x;
	const dz = near[ 1 ] - z;
	const length = Math.hypot( dx, dz );

	if ( length < 1e-3 ) return null;

	return { x, z, fx: dx / length, fz: dz / length };

}

/** Closest point on an [x,z] polyline. */
function nearestOn( path, x, z ) {

	let best = null;
	let bestDistance = Infinity;

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const span = dx * dx + dz * dz;

		if ( span < 1e-9 ) continue;

		const t = Math.min( 1, Math.max( 0, ( ( x - ax ) * dx + ( z - az ) * dz ) / span ) );
		const point = [ ax + dx * t, az + dz * t ];
		const distance = Math.hypot( x - point[ 0 ], z - point[ 1 ] );

		if ( distance < bestDistance ) {

			bestDistance = distance;
			best = point;

		}

	}

	return best ?? [ x, z ];

}
