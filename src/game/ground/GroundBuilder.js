import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { fill, skirt, ringBounds, ledge, Roadway, signedArea } from './Polygons.js';
import { holesWithin, shaftMouths, stationDepth } from './Stations.js';
import { Highways } from './Highways.js';

export const SIDEWALK_HEIGHT = 0.12;
const CURB_BOTTOM = - 0.06;
const BEDROCK_Y = - 0.8;
/** How far the bedrock keeps clear of the deepest thing the city digs. */
const BEDROCK_CLEARANCE = 2;

const CURB_KEY = 'cyberpunk/curb/poor';
/** A kerb stone's top, from the edge inward, and how far above the pavement it sits so it never fights it. */
const CURB_WIDTH = 0.15;
const CURB_LIP = 0.004;

// Atlas ground surfaces mapped onto material database keys: road, sidewalk
// and curb are real kinds since materials 0.9 (../materials/CONTRACT.md).
// `kerb` says where the kerb stone comes from: `face` for the strip the
// blueprint publishes, which only wants its road-facing side; `grow` for a
// pavement in a world published without one, which has to cut its own from the
// edges that meet the road.
const SURFACES = {
	roadway: { key: 'cyberpunk/road/high_rich', y: 0, variantId: 'patched' },
	sidewalk: { key: 'cyberpunk/sidewalk/high_rich', y: SIDEWALK_HEIGHT, variantId: 'plate', kerb: 'grow' },
	block: { key: 'cyberpunk/sidewalk/high_rich', y: SIDEWALK_HEIGHT, variantId: 'plate' },
	open: { key: 'cyberpunk/sidewalk/high_rich', y: SIDEWALK_HEIGHT, variantId: 'plate', kerb: 'grow' },
	curb: { key: CURB_KEY, y: SIDEWALK_HEIGHT + CURB_LIP, kerb: 'face' }
};

/**
 * The city floor, straight off the atlas blueprint's volumetric ground cover:
 * roadway at zero, every other surface raised by a real curb, one merged mesh
 * per material so the whole ground costs a handful of draw calls.
 *
 * Roadway uses the isotropic patched asphalt because these cover polygons have
 * a shared world grid rather than one lane axis. Sidewalk, block and open cover
 * use one neutral 2 m plate per tile. Their UV coordinates remain world metres,
 * so every cover shares one grid origin and texture size never follows mesh size.
 */
export class GroundBuilder {

	/**
	 * @param atlas CityBlueprint per ../atlas/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	/** @returns { group, colliderGeometry, bounds } */
	build() {

		const group = new THREE.Group();
		group.name = 'ground';

		const bySurface = new Map();

		for ( const cover of this.atlas.volumetric.ground ) {

			if ( ! SURFACES[ cover.surface ] ) continue;

			if ( ! bySurface.has( cover.surface ) ) bySurface.set( cover.surface, [] );

			bySurface.get( cover.surface ).push( cover.polygon );

		}

		const solid = [];
		const curbs = [];
		// The floor is open over every station shaft: without the hole the stair
		// down is buried under the cover it starts from.
		const mouths = shaftMouths( this.atlas );
		// A kerb stands only where a pavement edge meets the road, never along a building or another pavement.
		const road = new Roadway( this.atlas.volumetric.ground );
		// The blueprint's own kerb strip wins wherever it is published: it runs
		// unbroken through every junction return, which a pavement edge cannot.
		const strip = bySurface.has( 'curb' );

		for ( const [ surface, rings ] of bySurface ) {

			const spec = SURFACES[ surface ];
			const fills = rings.map( ( ring ) => fill( ring, spec.y, holesWithin( ring, mouths ) ) );
			const merged = BufferGeometryUtils.mergeGeometries( fills, false );
			fills.forEach( ( g ) => g.dispose() );

			const mesh = new THREE.Mesh( merged, this.factory.build( spec.key, spec.variantId ) );
			mesh.name = `ground:${surface}`;
			mesh.receiveShadow = true;
			group.add( mesh );
			solid.push( merged );

			if ( spec.kerb === 'grow' && strip ) continue;

			for ( const ring of spec.kerb ? rings : [] ) {

				const ccw = signedArea( ring ) > 0;
				const onRoad = ( a, b ) => road.bordersEdge( a, b, ccw );

				curbs.push( skirt( ring, spec.y, CURB_BOTTOM, onRoad ) );
				if ( spec.kerb === 'grow' ) curbs.push( ledge( ring, spec.y + CURB_LIP, CURB_WIDTH, onRoad ) );

			}

		}

		if ( curbs.length ) {

			const merged = BufferGeometryUtils.mergeGeometries( curbs, false );
			curbs.forEach( ( g ) => g.dispose() );
			const mesh = new THREE.Mesh( merged, this.factory.build( CURB_KEY ) );
			mesh.name = 'ground:kerb';
			group.add( mesh );
			solid.push( merged );

		}

		const highways = new Highways( this.atlas, this.factory ).build();
		group.add( highways.group );
		if ( highways.colliderGeometry ) solid.push( highways.colliderGeometry );

		const bounds = ringBounds( this.atlas.volumetric.ground.map( ( g ) => g.polygon ) );
		// Deep enough to be under the deepest thing the city digs, so a station
		// is a room rather than a hollow inside the rock.
		const dug = stationDepth( this.atlas );
		group.add( this.#bedrock( bounds, dug < 0 ? dug - BEDROCK_CLEARANCE : BEDROCK_Y ) );

		return {
			group,
			colliderGeometry: BufferGeometryUtils.mergeGeometries( solid.map( clean ), false ),
			bounds
		};

	}

	/**
	 * A dark slab under everything. Nothing in the blueprint needs it, but it
	 * makes a hole in the ground impossible to see through and gives the
	 * physics world a floor of last resort.
	 */
	#bedrock( bounds, y ) {

		const pad = 120;
		const width = bounds.max[ 0 ] - bounds.min[ 0 ] + pad * 2;
		const depth = bounds.max[ 1 ] - bounds.min[ 1 ] + pad * 2;
		const geometry = new THREE.PlaneGeometry( width, depth );
		geometry.rotateX( - Math.PI / 2 );
		geometry.translate(
			( bounds.min[ 0 ] + bounds.max[ 0 ] ) / 2,
			y,
			( bounds.min[ 1 ] + bounds.max[ 1 ] ) / 2
		);

		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( {
			color: 0x05070a,
			roughness: 1,
			metalness: 0
		} ) );
		mesh.name = 'ground:bedrock';

		return mesh;

	}

}

/** A collider wants positions and nothing else, in one uniform layout. */
function clean( geometry ) {

	const flat = geometry.index ? geometry.toNonIndexed() : geometry;
	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', flat.getAttribute( 'position' ).clone() );

	if ( flat !== geometry ) flat.dispose();

	return copy;

}
