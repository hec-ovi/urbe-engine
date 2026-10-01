import { materialColor, materialRoughness, mix, vec3 } from 'three/tsl';
import { PROFILES } from './SurfaceWear.js';

/**
 * Which wear each surface of the city wears, and the nodes that lay it on.
 *
 * Native street surfaces are named by the Materials street binding; the
 * district set and the ordinary set share profiles. A street surface not
 * named here (props, lights, scans, displays) is left as its effect paints it.
 */
const STREET = Object.freeze( {
	asphalt: { profile: 'road' },
	parking: { profile: 'road' },
	'district-hex': { profile: 'road' },
	'district-junction-blue': { profile: 'road' },
	'district-junction-yellow': { profile: 'road' },
	'asphalt-clean': { profile: 'road' },
	'asphalt-patched': { profile: 'road' },
	'hex-orange': { profile: 'sidewalk', panel: false },
	oxblood: { profile: 'sidewalk', panel: true, walk: true },
	drainGrate: { profile: 'sidewalk', panel: false, stains: 'drain' },
	drainCover: { profile: 'sidewalk', panel: false, stains: 'drain' },
	ordinary: { profile: 'sidewalk', panel: true },
	'worn-a': { profile: 'sidewalk', panel: true },
	'worn-b': { profile: 'sidewalk', panel: true },
	'worn-c': { profile: 'sidewalk', panel: true },
	oxide: { profile: 'sidewalk', panel: true },
	paper: { profile: 'sidewalk', panel: true },
	damaged: { profile: 'sidewalk', panel: true },
	service: { profile: 'sidewalk', panel: true },
	polished: { profile: 'sidewalk', panel: true },
	terracotta: { profile: 'sidewalk', panel: true },
	basalt: { profile: 'sidewalk', panel: false },
	concrete: { profile: 'sidewalk', panel: false },
	'district-panel-dark': { profile: 'sidewalk', panel: true },
	'district-panel-red': { profile: 'sidewalk', panel: true, walk: true },
	'district-panel-blue': { profile: 'sidewalk', panel: true, walk: true },
	curb: { profile: 'curb' },
	'district-curb-blue': { profile: 'curb' },
	'district-curb-red': { profile: 'curb' },
	'district-curb-yellow': { profile: 'curb' },
	gutter: { profile: 'gutter' },
	'district-gutter-blue': { profile: 'gutter' },
	'district-gutter-red': { profile: 'gutter' },
	'district-gutter-yellow': { profile: 'gutter' },
	joint: { profile: 'joint' },
	whitePaint: { profile: 'paint' },
	yellowPaint: { profile: 'paint' },
	'crosswalk-worn': { profile: 'paint' },
	'lane-worn': { profile: 'paint' }
} );

/** The wear a native street surface wears, or null. */
export function streetWear( surfaceId ) {

	return STREET[ surfaceId ] ?? null;

}

/**
 * A street effect's nodes, worn: colour and roughness, and a clear coat's
 * roughness where the surface has one, so a coated slab breaks up with it.
 *
 * @param use how worn the placement is, 0..1 (the street's sampled wear field)
 * @returns the node properties to lay over the effect's, or null
 */
export function wearStreet( detail, surfaceId, nodes, use ) {

	const wear = streetWear( surfaceId );
	if ( ! wear || ! nodes.colorNode || ! nodes.roughnessNode ) return null;
	const { profile, ...options } = wear;
	const worn = PROFILES[ profile ]( detail, { color: vec3( nodes.colorNode ), roughness: nodes.roughnessNode, ...( use ? { wear: use } : {} ) }, options );

	return {
		colorNode: worn.color,
		roughnessNode: worn.roughness,
		...( nodes.clearcoatRoughnessNode ? { clearcoatRoughnessNode: mix( nodes.clearcoatRoughnessNode, worn.roughness, 0.8 ) } : {} )
	};

}

/** Kinds that are light, glass, planting, print or cloth: they keep the look their maps give them. */
const UNWORN = /paired-room|paired-light|paired-window|window-glass|glass|curtain|blind|fern|garden|plant|fabric|upholstery|signage|screen|letter-atlas|light-fixture|neon|grime|mirror|ad-|lens/;
const METAL = /metal|alloy|chrome|bronze|steel|zinc|alumin|brass|copper|iron/;
/** Tiers whose buildings are kept up. */
const KEPT = /^(rich|high_rich)$/;

/**
 * The wear an exterior shell surface wears: `wall` or `metal`, `kept-wall` or
 * `kept-metal` for a rich or high-rich key, or null. Only opaque, unlit,
 * non-decal surfaces wear any.
 */
export function exteriorWear( key, entry ) {

	if ( ! entry ) return null;
	const kind = key.split( '/' )[ 1 ] ?? '';
	const physical = entry.physical ?? {};
	const lit = ( physical.emissiveStrength ?? 0 ) > 0 || entry.variants?.some( ( variant ) => variant.maps?.emission );
	if ( UNWORN.test( kind ) || lit || entry.decal || ( physical.transmission ?? 0 ) > 0
		|| physical.alphaMode === 'BLEND' || physical.alphaMode === 'MASK' ) return null;

	const profile = METAL.test( kind ) || ( physical.metallicFactor ?? 0 ) >= 0.5 ? 'metal' : 'wall';

	return KEPT.test( key.split( '/' )[ 2 ] ?? '' ) ? `kept-${profile}` : profile;

}

const exteriors = new WeakMap();

/**
 * The node properties an exterior material takes for its wear. They read the
 * material's own colour and roughness (its maps and factors), so every
 * surface wearing one profile shares one graph and builds the same program.
 */
export function wearExterior( detail, profile ) {

	if ( ! PROFILES[ profile ] ) throw new Error( `surface detail: unknown profile ${profile}` );
	if ( ! exteriors.has( detail ) ) exteriors.set( detail, new Map() );
	const built = exteriors.get( detail );
	if ( ! built.has( profile ) ) {

		const worn = PROFILES[ profile ]( detail, { color: materialColor.rgb, roughness: materialRoughness } );
		built.set( profile, Object.freeze( { colorNode: worn.color, roughnessNode: worn.roughness } ) );

	}

	return built.get( profile );

}
