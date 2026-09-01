import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { signedArea } from '../ground/Polygons.js';

// Colours only ever drive the point lights that spill onto the street; the
// panels themselves are lit by their own emission maps from the materials
// database, so the signage never turns into flat coloured cards.
const GLOW = [ 0xff2fb0, 0x24e0ff, 0xffa42b, 0x9b5cff, 0x2bff9e ];

const BLADE_EMISSIVE = 2.2;
const BLADE_KEY = ( tier ) => `cyberpunk/signage/${tier}`;
const SCREEN_KEY = ( tier ) => `cyberpunk/ad-screen/${tier}`;
const SCREEN_ASPECT = 16 / 9;

/**
 * Street-level neon. The exterior layer emits no signage geometry, so the game
 * hangs it: blade signs projecting off the facade the parcel's street access
 * faces, and flat ad screens on the same wall, both textured and lit by the
 * materials database's own emissive entries. Deterministic per parcel.
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

		const blades = new Map();
		const screens = new Map();
		const glows = [];

		for ( const parcel of this.atlas.parcels ) {

			const building = this.buildings.get( parcel.id );

			if ( ! building ) continue;

			const facade = frontFacade( building.blueprint, parcel );

			if ( ! facade ) continue;

			const rng = new Rng( hash( parcel.id ) );
			const tier = parcel.tier;
			const top = building.blueprint.bounds.height;

			this.#blades( blades, glows, facade, rng, tier, top );
			this.#screens( screens, facade, rng, tier, top );

		}

		const group = new THREE.Group();
		group.name = 'neon';

		// A blade sign has to carry down a street, so its emission is pushed.
		// An ad screen already ships at strength 8 to 10 and pushing that only
		// clips the picture to a white rectangle, so it is left as the
		// database wrote it.
		for ( const [ scale, panels ] of [ [ BLADE_EMISSIVE, blades ], [ 1, screens ] ] ) {

			for ( const [ key, geometries ] of panels ) {

				const mesh = new THREE.Mesh(
					BufferGeometryUtils.mergeGeometries( geometries, false ),
					this.factory.variant( key, { emissiveScale: scale, side: THREE.DoubleSide } )
				);
				mesh.name = `neon:${key}`;
				group.add( mesh );

			}

		}

		return { group, glows };

	}

	/** Signs standing out from the wall, the ones you read down a street. */
	#blades( out, glows, facade, rng, tier, top ) {

		const count = 1 + Math.floor( rng.next() * 2 );
		const key = BLADE_KEY( tier );

		for ( let i = 0; i < count; i ++ ) {

			const height = rng.range( 2.4, Math.min( 5.5, Math.max( 2.6, top - 4 ) ) );
			const depth = rng.range( 1.1, 2.1 );
			const base = rng.range( 3.4, Math.max( 4, Math.min( top - height - 1, 12 ) ) );
			const along = rng.range( 0.15, 0.85 );

			const anchor = facade.pointAt( along );
			const geometry = new THREE.PlaneGeometry( depth, height );
			// UVs in world meters: the signage entry tiles 2 x 1 m.
			panelUv( geometry, depth, height );
			geometry.rotateY( facade.angle + Math.PI / 2 );
			geometry.translate(
				anchor.x + facade.normal.x * depth / 2,
				base + height / 2,
				anchor.z + facade.normal.z * depth / 2
			);

			push( out, key, geometry );
			glows.push( {
				position: new THREE.Vector3(
					anchor.x + facade.normal.x * ( depth + 0.4 ),
					base + height / 2,
					anchor.z + facade.normal.z * ( depth + 0.4 )
				),
				color: GLOW[ Math.floor( rng.next() * GLOW.length ) ],
				intensity: rng.range( 14, 30 ),
				distance: 26
			} );

		}

	}

	/** Flat screens on the wall itself. */
	#screens( out, facade, rng, tier, top ) {

		if ( top < 7 || rng.next() > 0.75 ) return;

		const key = SCREEN_KEY( tier );
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

function hash( text ) {

	let h = 2166136261;

	for ( let i = 0; i < text.length; i ++ ) {

		h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );

	}

	return h >>> 0;

}
