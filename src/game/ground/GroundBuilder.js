import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { fill, skirt, ringBounds } from './Polygons.js';

export const SIDEWALK_HEIGHT = 0.12;
const CURB_BOTTOM = - 0.06;
const BEDROCK_Y = - 0.8;

// Atlas ground surfaces mapped onto material database keys. The database has
// no road, asphalt or sidewalk kind, so each surface takes the closest
// resolvable one (../materials/CONTRACT.md names the guaranteed vocabulary).
const SURFACES = {
	roadway: { key: 'cyberpunk/road/high_rich', y: 0, wet: true },
	sidewalk: { key: 'cyberpunk/sidewalk/high_rich', y: SIDEWALK_HEIGHT, curb: true },
	block: { key: 'cyberpunk/sidewalk/high_rich', y: SIDEWALK_HEIGHT },
	open: { key: 'cyberpunk/tile/high_rich', y: SIDEWALK_HEIGHT, curb: true }
};

const CURB_KEY = 'cyberpunk/concrete/rich';

/**
 * The city floor, straight off the atlas blueprint's volumetric ground cover:
 * roadway at zero, every other surface raised by a real curb, one merged mesh
 * per material so the whole ground costs a handful of draw calls.
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

		for ( const [ surface, rings ] of bySurface ) {

			const spec = SURFACES[ surface ];
			const fills = rings.map( ( ring ) => fill( ring, spec.y ) );
			const merged = BufferGeometryUtils.mergeGeometries( fills, false );
			fills.forEach( ( g ) => g.dispose() );

			// The factory's material is shared by every mesh of that key, so the
			// wet finish goes on a copy of it.
			const base = this.factory.build( spec.key );
			const material = spec.wet ? applyWetLook( base.clone() ) : base;

			const mesh = new THREE.Mesh( merged, material );
			mesh.name = `ground:${surface}`;
			mesh.receiveShadow = true;
			group.add( mesh );
			solid.push( merged );

			if ( spec.curb ) {

				for ( const ring of rings ) curbs.push( skirt( ring, spec.y, CURB_BOTTOM ) );

			}

		}

		if ( curbs.length ) {

			const merged = BufferGeometryUtils.mergeGeometries( curbs, false );
			curbs.forEach( ( g ) => g.dispose() );
			const mesh = new THREE.Mesh( merged, this.factory.build( CURB_KEY ) );
			mesh.name = 'ground:curb';
			group.add( mesh );
			solid.push( merged );

		}

		const bounds = ringBounds( this.atlas.volumetric.ground.map( ( g ) => g.polygon ) );
		group.add( this.#bedrock( bounds ) );

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
	#bedrock( bounds ) {

		const pad = 120;
		const width = bounds.max[ 0 ] - bounds.min[ 0 ] + pad * 2;
		const depth = bounds.max[ 1 ] - bounds.min[ 1 ] + pad * 2;
		const geometry = new THREE.PlaneGeometry( width, depth );
		geometry.rotateX( - Math.PI / 2 );
		geometry.translate(
			( bounds.min[ 0 ] + bounds.max[ 0 ] ) / 2,
			BEDROCK_Y,
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

/**
 * Damp asphalt. Wet road is darker and a little glossier than dry road, and
 * that is all: a mirror finish over a grainy normal map turns every chip of
 * aggregate into a specular point and the whole street sparkles at night. So
 * the albedo drops, the roughness stays high enough to spread a highlight, the
 * grain is damped, and the surface stays a dielectric.
 */
function applyWetLook( material ) {

	material.color.multiplyScalar( 0.72 );
	material.roughness = 0.62;
	material.metalness = 0;
	material.envMapIntensity = 1;

	if ( material.normalScale ) material.normalScale.setScalar( 0.35 );

	return material;

}

/** A collider wants positions and nothing else, in one uniform layout. */
function clean( geometry ) {

	const flat = geometry.index ? geometry.toNonIndexed() : geometry;
	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', flat.getAttribute( 'position' ).clone() );

	if ( flat !== geometry ) flat.dispose();

	return copy;

}
