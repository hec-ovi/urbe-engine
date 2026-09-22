import * as THREE from 'three/webgpu';
import { kelvinColor } from '../light/Color.js';
import { bake } from './GeometryBake.js';
import { variantFor } from './Variety.js';
import { ScenicSurface } from './ScenicSurface.js';

const FIXTURE = '/light-fixture/';
/**
 * A lit diffuser is looked at directly, so it sits well above road exposure.
 * This is the level the night grade was tuned at, stated outright rather than
 * multiplied onto whatever strength the database authored the map with.
 */
const FIXTURE_EMISSIVE = 180;
const FIXTURE_KELVIN = 2700;
const GROUND_PRIVACY = 'ground-privacy';
const SCENERY = 'scenery';

/**
 * What a shell surface wears, wherever a shell is drawn: which variant, which
 * material, and what becomes of the fake rooms behind its windows.
 *
 * A material key is not enough on its own to build a surface: the same
 * `light-fixture` key is a lamp in the city and a grey plastic panel without
 * this, and the same `paired-room` key is a lit room seen through glass in one
 * place and a blown-out wall in another. Those rules live here once so a
 * preview of a building and the city it stands in cannot answer differently.
 */

/**
 * Which look this surface wears, in the order the answers win: what the
 * exporter authored on the surface, then what the building published for that
 * key, then the seeded pattern the parcel wears. A caller names what it knows;
 * the seeded pattern belongs to a facade's merge bucket, so a surface asked
 * for without a parcel keeps the published answer or the canonical variant.
 */
export function shellVariant( factory, { key, authored, blueprint, parcelId } ) {

	return authored
		?? blueprint?.materialVariants?.[ key ]
		?? ( parcelId ? variantFor( factory.resolver.resolve( key ), parcelId ) : undefined );

}

/** The material for one shell surface; a lit diffuser reads as its own lamp. */
export function shellMaterial( factory, { key, variantId, doubleSided = false } ) {

	const side = doubleSided ? THREE.DoubleSide : undefined;

	return key.includes( FIXTURE )
		? factory.variant( key, {
			variantId,
			emissiveLevel: FIXTURE_EMISSIVE,
			emissive: kelvinColor( FIXTURE_KELVIN ),
			...( side !== undefined ? { side } : {} )
		} )
		: side === undefined
			? factory.build( key, variantId )
			: factory.variant( key, { variantId, side } );

}

/** GLTF loaders may retain a shell scenery name on the parent of material meshes. */
export function isSceneryNode( node ) {

	for ( let current = node; current; current = current.parent ) {

		if ( current.name?.startsWith( GROUND_PRIVACY ) || current.name?.startsWith( SCENERY ) ) return true;

	}

	return false;

}

/**
 * What a shell does with one scenery surface. Both closed and furnished
 * parcels keep the exterior room image with its own light baked in. A caller
 * drawing a furnished parcel gives it an ExteriorScenery visibility mask.
 *
 * @param scenic ScenicSurface for this building
 * @returns the exterior scenery geometry to draw
 */
export function shellScenery( node, factory, { key, scenic } ) {

	const geometry = bake( node );

	return ScenicSurface.supports( key )
		? scenic.bake( geometry, key, factory.resolver.resolve( key )?.physical?.emissiveStrength ?? 1 )
		: geometry;

}
