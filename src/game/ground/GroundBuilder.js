import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { fill, skirt, ringBounds, ledge, Roadway, signedArea } from './Polygons.js';
import { holesWithin, shaftMouths } from './Stations.js';
import { Highways } from './Highways.js';
import { GroundPalette } from './GroundPalette.js';
import { GroundRegions } from './GroundRegions.js';

export const SIDEWALK_HEIGHT = 0.15;
const CURB_BOTTOM = - 0.06;

/** Dimensions for legacy covers without authored curb volumes. */
const CURB_WIDTH = 0.15;
const CURB_LIP = 0.004;

// `kerb` says where the kerb stone comes from: `face` for the strip the
// blueprint publishes, which only wants its road-facing side; `grow` for a
// pavement in a world published without one, which has to cut its own from the
// edges that meet the road.
const SURFACES = {
	roadway: { y: 0 },
	sidewalk: { y: SIDEWALK_HEIGHT, kerb: 'grow' },
	block: { y: SIDEWALK_HEIGHT },
	open: { y: SIDEWALK_HEIGHT, kerb: 'grow' },
	curb: { y: SIDEWALK_HEIGHT + CURB_LIP, kerb: 'face' }
};

/**
 * The city floor follows complete Atlas cover polygons and their authored
 * elevations, with one merged mesh per material.
 *
 * A seeded catalog family coordinates road, paving and continuous curb finishes.
 * UV coordinates remain world metres with one shared origin; texture scale
 * comes from the catalog rather than mesh dimensions.
 */
export class GroundBuilder {

	/** Read-only Atlas owner views for a functional band; legacy worlds return []. */
	static regionFootprints( atlas, band ) {

		return new GroundRegions( atlas ).footprints( band );

	}

	/**
	 * @param atlas CityBlueprint per ../atlas/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;
		this.palette = new GroundPalette( atlas.meta?.seed );

	}

	/** @returns { group, colliderGeometry, bounds } */
	build() {

		const group = new THREE.Group();
		group.name = 'ground';

		const bySurface = new Map();

		for ( const cover of this.atlas.volumetric.ground ) {

			if ( ! SURFACES[ cover.surface ] ) continue;

			if ( ! bySurface.has( cover.surface ) ) bySurface.set( cover.surface, [] );

			bySurface.get( cover.surface ).push( cover );

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

		for ( const [ surface, covers ] of bySurface ) {

			const spec = SURFACES[ surface ];
			const fills = covers.map( ( cover ) => {

				const ring = cover.polygon;
				const top = cover.top ?? spec.y;

				if ( surface !== 'curb' || Number.isFinite( cover.top ) ) return fill( ring, top, holesWithin( ring, mouths ) );

				const ccw = signedArea( ring ) > 0;
				return ledge( ring, spec.y, CURB_WIDTH, ( a, b ) => road.bordersEdge( a, b, ccw ) );

			} );
			const merged = BufferGeometryUtils.mergeGeometries( fills, false );
			fills.forEach( ( g ) => g.dispose() );

			const material = this.palette.surface( surface );
			const mesh = new THREE.Mesh( merged, this.factory.build( material.key, material.variantId ) );
			mesh.name = `ground:${surface}`;
			mesh.receiveShadow = true;
			group.add( mesh );
			solid.push( merged );

			if ( spec.kerb === 'grow' && strip ) continue;

			for ( const cover of spec.kerb ? covers : [] ) {

				const ring = cover.polygon;
				const top = cover.top ?? spec.y;
				const bottom = cover.bottom ?? CURB_BOTTOM;
				const ccw = signedArea( ring ) > 0;
				const onRoad = ( a, b ) => road.bordersEdge( a, b, ccw );

				curbs.push( skirt( ring, top, bottom, onRoad ) );
				if ( spec.kerb === 'grow' ) curbs.push( ledge( ring, top + CURB_LIP, CURB_WIDTH, onRoad ) );

			}

		}

		if ( curbs.length ) {

			const merged = BufferGeometryUtils.mergeGeometries( curbs, false );
			curbs.forEach( ( g ) => g.dispose() );
			const material = this.palette.surface( 'curb' );
			const mesh = new THREE.Mesh( merged, this.factory.build( material.key, material.variantId ) );
			mesh.name = 'ground:kerb';
			group.add( mesh );
			solid.push( merged );

		}

		const highways = new Highways( this.atlas, this.factory ).build();
		group.add( highways.group );
		if ( highways.colliderGeometry ) solid.push( highways.colliderGeometry );

		const bounds = ringBounds( this.atlas.volumetric.ground.map( ( g ) => g.polygon ) );

		return {
			group,
			colliderGeometry: BufferGeometryUtils.mergeGeometries( solid.map( clean ), false ),
			bounds
		};

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
