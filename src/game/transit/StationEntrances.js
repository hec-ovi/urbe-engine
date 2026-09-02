import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { kelvinColor } from '../light/Color.js';
import { box, merge, solid } from './Shapes.js';
import { frameOf } from './StationFrame.js';

// A stair the player capsule can walk: the controller autosteps 0.42 m, so a
// 0.175 m rise on a 0.30 m going is well inside it, and the 1.8 m clear width
// is more than twice the 0.7 m capsule. Sixteen treads put the landing 2.8 m
// under the pavement, which is a mezzanine, and the shaft is closed off there.
const CLEAR = 1.8;
const RISE = 0.175;
const GOING = 0.3;
const TREADS = 16;
const LANDING = 1.4;
const WALL = 0.25;
/** How far the side walls carry on above the pavement, as a balustrade. */
const PARAPET = 1;
const PORTAL_TOP = 2.9;
const SIGN_BAND = 0.55;
const SIGN_BOTTOM = 2.35;

const STRUCTURE_KEY = 'cyberpunk/concrete/rich';
const SIGN_KEY = 'cyberpunk/signage/rich';
/** A station name band is read from across the street, so it runs hotter than a stop sign. */
const SIGN_EMISSIVE = 34;
// The band is a metre-and-a-half of backlit box, several times the little LED
// box on a bus stop flag, at the neutral white a station is signed in.
const SIGN_LUMENS = 900;
const SIGN_KELVIN = 4000;
const SIGN_RANGE = 15;

/**
 * Every station's entrances, straight off the atlas: a portal at the mouth
 * holding a lit band that names the mode, over the way down.
 *
 * Where the station publishes a shaft, the shaft is the way down and this box
 * only frames it: the portal stands square across the mouth end of that shaft's
 * own footprint and StationVolumes builds the well and the stair inside it.
 * Where it publishes none, there is nothing below to reach, so the entrance
 * carries its own stair down to a mezzanine between two walls that carry on
 * above the pavement as a balustrade, descending towards the station itself,
 * which is the one direction the blueprint fixes for it.
 *
 * A handful of stations is a handful of entrances, so these merge rather than
 * instance: one mesh for the concrete of the whole city, and one lit band per
 * mode, each mode wearing its own sign so a train entrance is not a subway
 * entrance from a distance.
 */
export class StationEntrances {

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
		group.name = 'station-entrances';

		const structure = [];
		const glows = [];
		const models = { true: this.#model( true ), false: this.#model( false ) };

		for ( const mode of MODES ) {

			const signs = [];

			for ( const station of this.atlas.transit?.[ mode.collection ] ?? [] ) {

				station.entrances.forEach( ( entrance, index ) => {

					const shaft = station.shafts?.[ index ];
					const matrix = shaft ? overShaft( shaft ) : placement( entrance, station.position );

					if ( ! matrix ) return;

					const model = models[ ! shaft ];

					if ( model.structure ) structure.push( model.structure.clone().applyMatrix4( matrix ) );
					signs.push( model.sign.clone().applyMatrix4( matrix ) );
					glows.push( {
						position: model.signPoint.clone().applyMatrix4( matrix ),
						color: kelvinColor( SIGN_KELVIN ),
						lumens: SIGN_LUMENS,
						range: SIGN_RANGE
					} );

				} );

			}

			const merged = merge( signs );

			if ( ! merged ) continue;

			const mesh = new THREE.Mesh( merged, this.factory.variant( SIGN_KEY, {
				variantId: mode.variantId,
				emissiveScale: SIGN_EMISSIVE,
				emissive: kelvinColor( SIGN_KELVIN )
			} ) );
			mesh.name = `entrance:${mode.name}`;
			group.add( mesh );

		}

		const merged = merge( structure );

		if ( merged ) {

			const mesh = new THREE.Mesh( merged, this.factory.build( STRUCTURE_KEY ) );
			mesh.name = 'entrance:structure';
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		return { group, glows, collider: solid( structure ) };

	}

	/**
	 * One entrance, modelled once around its point on the pavement with +Z
	 * running the way down. Every concrete part is solid: the player walks down
	 * the treads and along the landing, and cannot step over the balustrade into
	 * the shaft.
	 *
	 * @param descends whether this entrance carries the way down itself. A
	 * station that publishes a shaft has the descent built there, so the model
	 * is the portal and its band alone.
	 */
	#model( descends ) {

		const parts = [];
		const bottom = SIDEWALK_HEIGHT - TREADS * RISE;
		const flight = TREADS * GOING;
		const floor = bottom - 0.2;
		const top = SIDEWALK_HEIGHT + PARAPET;

		if ( descends ) {

			for ( let i = 0; i < TREADS; i ++ ) {

				const tread = box( CLEAR, RISE, GOING );
				tread.translate( 0, SIDEWALK_HEIGHT - ( i + 0.5 ) * RISE, ( i + 0.5 ) * GOING );
				parts.push( tread );

			}

			const landing = box( CLEAR, 0.2, LANDING );
			landing.translate( 0, bottom - 0.1, flight + LANDING / 2 );
			parts.push( landing );

			// Nothing is published past here, so the mezzanine is closed off.
			const back = box( CLEAR + 2 * WALL, top - floor, WALL );
			back.translate( 0, ( floor + top ) / 2, flight + LANDING + WALL / 2 );
			parts.push( back );

			const length = flight + LANDING + WALL + 0.15;

			for ( const sx of [ - 1, 1 ] ) {

				const side = box( WALL, top - floor, length );
				side.translate( sx * ( CLEAR + WALL ) / 2, ( floor + top ) / 2, length / 2 - 0.15 );
				parts.push( side );

			}

		}

		for ( const sx of [ - 1, 1 ] ) {

			const post = box( WALL + 0.06, PORTAL_TOP - SIDEWALK_HEIGHT, WALL + 0.06 );
			post.translate( sx * ( CLEAR + WALL ) / 2, ( SIDEWALK_HEIGHT + PORTAL_TOP ) / 2, - 0.02 );
			parts.push( post );

		}

		const signZ = - 0.12;
		const sign = box( CLEAR + 2 * WALL + 0.06, SIGN_BAND, 0.14 );
		sign.translate( 0, SIGN_BOTTOM + SIGN_BAND / 2, signZ );

		return {
			structure: merge( parts ),
			sign,
			signPoint: new THREE.Vector3( 0, SIGN_BOTTOM + SIGN_BAND / 2, signZ - 0.25 )
		};

	}

}

const MODES = [
	{ name: 'train', collection: 'trainStations', variantId: '2' },
	{ name: 'subway', collection: 'subwayStations', variantId: '1' }
];

const UP = new THREE.Vector3( 0, 1, 0 );
const ONE = new THREE.Vector3( 1, 1, 1 );

/**
 * The portal over a published shaft: square across the mouth end of its own
 * footprint, facing the way the first flight runs, which is the end
 * StationVolumes leaves open in the parapet.
 */
function overShaft( shaft ) {

	const frame = frameOf( shaft.footprint ?? [] );

	if ( ! frame ) return null;

	const [ x, z ] = frame.at( - frame.long / 2, 0 );

	return new THREE.Matrix4().compose(
		new THREE.Vector3( x, 0, z ),
		new THREE.Quaternion().setFromAxisAngle( UP, frame.heading ),
		ONE
	);

}

/**
 * The entrance stands on its own point and the stair heads for the station,
 * because a stair that descended the other way would run out under the street
 * it came from. An entrance sitting exactly on its station has no direction to
 * take and is dropped.
 */
function placement( entrance, station ) {

	const dx = station[ 0 ] - entrance[ 0 ];
	const dz = station[ 1 ] - entrance[ 1 ];
	const length = Math.hypot( dx, dz );

	if ( length < 1e-3 ) return null;

	return new THREE.Matrix4().compose(
		new THREE.Vector3( entrance[ 0 ], 0, entrance[ 1 ] ),
		new THREE.Quaternion().setFromAxisAngle( UP, Math.atan2( dx / length, dz / length ) ),
		ONE
	);

}
