import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { signedArea } from '../ground/Polygons.js';
import { GLOW, parcelSeed, shellGlows } from './ShellFixtures.js';

// An ad screen is a large dim panel; its flux is in lumens like every other
// fixture the city lights itself with.
const SCREEN_LUMENS = [ 300, 900 ];
const SCREEN_EMISSIVE = 3;

const SCREEN_KEY = ( tier ) => `cyberpunk/ad-screen/${tier}`;
const SCREEN_VARIANT = {
	poor: 'noir-cyan',
	mid: 'noir-cyan',
	rich: 'noir-amber',
	high_rich: 'noir-amber'
};
/** The parcel types whose screens advertise the business itself (../../../../materials/CONTRACT.md, rebrand). */
const ADVERTISERS = new Set( [ 'hotel', 'commerce', 'mall', 'restaurant', 'coffee_shop', 'corpo', 'clinic' ] );

/** The materials box's variant id for a business name: `brand:<slug>`. */
export function brandVariant( name ) {

	const slug = name.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

	return slug ? `brand:${slug}` : null;

}

/** Exact materials variant for an unbranded or branded landscape screen. */
export function screenVariant( tier, brand = null ) {

	const canonical = SCREEN_VARIANT[ tier ];

	if ( ! canonical ) throw new Error( `no canonical ad-screen variant for tier ${tier}` );

	return { key: SCREEN_KEY( tier ), variantId: brand ?? canonical };

}
const SCREEN_ASPECT = 16 / 9;

/**
 * Street-level light on the facades. Two jobs:
 *
 * - it hangs flat ad screens on the facade each parcel's street access faces,
 *   textured and lit by the materials database's own emissive entries;
 * - it registers a fixture, in lumens, for every emitter the city actually
 *   built: the screens hung here, plus everything the building carries itself
 *   (ShellFixtures.js). A building with no sign gets no sign light, which is
 *   the point: nothing lights an empty panel.
 *
 * Deterministic per parcel.
 */
export class Neon {

	/**
	 * @param atlas CityBlueprint
	 * @param buildings Map<parcelId, { blueprint }>
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, buildings, factory ) {

		this.atlas = atlas;
		this.buildings = buildings;
		this.factory = factory;

	}

	/** @returns { group, glows } */
	build() {

		const screens = new Map();
		const glows = [];

		for ( const parcel of this.atlas.parcels ) {

			const building = this.buildings.get( parcel.id );

			if ( ! building ) continue;

			const rng = new Rng( parcelSeed( parcel.id ) );

			glows.push( ...shellGlows( {
				parcelId: parcel.id, blueprint: building.blueprint, hasInterior: building.hasInterior, rng
			} ) );

			const facade = frontFacade( building.blueprint, parcel );

			if ( facade ) {

				const brand = parcel.name && ADVERTISERS.has( parcel.type ) ? brandVariant( parcel.name ) : null;
				this.#screens( screens, glows, facade, rng, parcel.tier, building.blueprint.bounds.height, brand );

			}

		}

		const group = new THREE.Group();
		group.name = 'neon';

		// A screen is a large dim panel next to a lamp lens, so it carries a
		// fraction of the lens's level: enough to read as lit, never enough to
		// clip its picture to a white rectangle.
		for ( const [ id, geometries ] of screens ) {

			const [ key, variantId ] = id.split( '#' );

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( geometries, false ),
				this.factory.variant( key, { variantId, side: THREE.DoubleSide, emissiveScale: SCREEN_EMISSIVE } )
			);
			mesh.name = `neon:${key}`;
			group.add( mesh );

		}

		return { group, glows };

	}

	/** Flat screens on the wall itself. */
	#screens( out, glows, facade, rng, tier, top, brand = null ) {

		if ( top < 7 || rng.next() > 0.75 ) return;

		// A named business advertises itself: its screens take its branded
		// variant, and a name the database has not spelled yet falls back to
		// the tier's brandless art.
		const screen = screenVariant( tier, brand );
		const key = `${screen.key}#${screen.variantId}`;
		const width = rng.range( 2.8, Math.min( 6, facade.length * 0.5 ) );

		if ( ! ( width > 1 ) ) return;

		const height = width / SCREEN_ASPECT;
		const base = rng.range( 4.5, Math.max( 5, Math.min( top - height - 1, 11 ) ) );
		const anchor = facade.pointAt( rng.range( 0.2, 0.8 ) );

		const geometry = new THREE.PlaneGeometry( width, height );
		// An exact entry fills the panel once, right way up.
		panelUv( geometry, 1, 1 );
		geometry.rotateY( facade.angle );
		geometry.translate(
			anchor.x + facade.normal.x * 0.14,
			base + height / 2,
			anchor.z + facade.normal.z * 0.14
		);

		push( out, key, geometry );
		glows.push( {
			position: new THREE.Vector3(
				anchor.x + facade.normal.x * ( width * 0.4 ),
				base + height / 2,
				anchor.z + facade.normal.z * ( width * 0.4 )
			),
			color: new THREE.Color( GLOW[ Math.floor( rng.next() * GLOW.length ) ] ),
			lumens: rng.range( SCREEN_LUMENS[ 0 ], SCREEN_LUMENS[ 1 ] ) * ( width * height ) / 6,
			range: 18
		} );

	}

}

/** The footprint edge the parcel's street access looks at, with its frame. */
function frontFacade( blueprint, parcel ) {

	const ring = blueprint.floors.find( ( f ) => f.index === 0 )?.outline ?? blueprint.bounds.footprint;

	if ( ! ring || ring.length < 3 ) return null;

	const [ ax, az ] = parcel.access.point;
	const outward = signedArea( ring ) > 0 ? 1 : - 1;
	let best = null;

	for ( let i = 0; i < ring.length; i ++ ) {

		const a = ring[ i ];
		const b = ring[ ( i + 1 ) % ring.length ];
		const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

		if ( length < 2.5 ) continue;

		const mx = ( a[ 0 ] + b[ 0 ] ) / 2;
		const mz = ( a[ 1 ] + b[ 1 ] ) / 2;
		const score = Math.hypot( mx - ax, mz - az ) - length * 0.35;

		if ( ! best || score < best.score ) best = { a, b, length, score };

	}

	if ( ! best ) return null;

	const ux = ( best.b[ 0 ] - best.a[ 0 ] ) / best.length;
	const uz = ( best.b[ 1 ] - best.a[ 1 ] ) / best.length;
	const normal = new THREE.Vector3( uz * outward, 0, - ux * outward );

	return {
		length: best.length,
		normal,
		angle: Math.atan2( normal.x, normal.z ),
		pointAt: ( t ) => new THREE.Vector3(
			best.a[ 0 ] + ux * best.length * t,
			0,
			best.a[ 1 ] + uz * best.length * t
		)
	};

}

/**
 * Panel UVs in the convention the material factory loads for: v grows downward
 * from the top of the image, the way glTF writes it. `width` and `height` are
 * the metres the panel covers, which is what a tiled entry wants; an exact
 * entry passes 1 by 1 and fills the panel once.
 */
function panelUv( geometry, width, height ) {

	const uv = geometry.getAttribute( 'uv' );

	for ( let i = 0; i < uv.count; i ++ ) {

		uv.setXY( i, uv.getX( i ) * width, ( 1 - uv.getY( i ) ) * height );

	}

	uv.needsUpdate = true;

}

function push( map, key, geometry ) {

	if ( ! map.has( key ) ) map.set( key, [] );

	map.get( key ).push( geometry );

}
