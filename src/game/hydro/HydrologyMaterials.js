import { HydrologyError } from './HydrologyError.js';

const REQUIRED_MAPS = [ 'basecolor', 'normal', 'roughness', 'metallic' ];

/** Resolves and builds once through the materials boundary before cloning. */
export function materialSource( factory, binding, boundary ) {

	if ( typeof factory?.resolver?.resolve !== 'function' || typeof factory?.build !== 'function' ) {

		fail( 'A PbrMaterialFactory with its resolver is required' );

	}
	const entry = factory.resolver.resolve( binding.key );
	if ( ! entry ) fail( `Material ${binding.key} does not resolve` );
	boundary.material( entry );
	if ( entry.alignment !== 'tile' || ! validSize( entry.tiling?.worldSize ) ) fail( `Material ${binding.key} must be tiled in world metres` );
	const variant = binding.variantId
		? entry.variants?.find( ( item ) => item.id === binding.variantId )
		: entry.variants?.[ 0 ];
	if ( ! variant ) fail( `Material ${binding.key} has no requested variant` );
	if ( ! REQUIRED_MAPS.every( ( key ) => typeof variant.maps?.[ key ] === 'string' ) ) fail( `Material ${binding.key} is missing required PBR maps` );
	const base = factory.build( binding.key, variant.id );
	if ( ! base?.isMaterial || typeof base.clone !== 'function' || base.name?.startsWith( 'unresolved:' ) ) {

		fail( `Material factory did not build resolved material ${binding.key}` );

	}
	if ( ! base.normalMap?.isTexture ) fail( `Material ${binding.key} did not build its normal map` );
	return { base, binding: { key: binding.key, variantId: variant.id } };

}

/** Owns its normal-map transform, leaving the factory cache untouched. */
export function waterMaterial( source, parameters, shoreline = false ) {

	const material = source.base.clone();
	const normalMap = source.base.normalMap.clone();
	normalMap.needsUpdate = true;
	material.normalMap = normalMap;
	material.roughness = parameters.reflection.roughness;
	material.envMapIntensity = parameters.reflection.environmentIntensity;
	if ( 'ior' in material ) material.ior = parameters.reflection.ior;
	material.normalScale?.set( parameters.motion.normalScale, parameters.motion.normalScale );
	material.polygonOffset = shoreline;
	material.polygonOffsetFactor = shoreline ? - 1 : 0;
	material.polygonOffsetUnits = shoreline ? - 1 : 0;
	material.userData = {
		...material.userData,
		hydrology: {
			material: source.binding,
			motion: parameters.motion,
			reflection: parameters.reflection,
			shoreline
		}
	};
	return { material, normalMap, motion: parameters.motion };

}

function validSize( value ) {

	return Array.isArray( value ) && value.length === 2 && value.every( ( item ) => Number.isFinite( item ) && item > 0 );

}

function fail( message ) {

	throw new HydrologyError( 'E_HYDRO_MATERIAL', message );

}
