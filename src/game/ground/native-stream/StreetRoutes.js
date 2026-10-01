/**
 * Finishes the Materials binding publishes for parts a street kit built
 * before them still draws with an older surface. Each route names the kit
 * pieces it applies to, the surface they publish, the finish the engine draws
 * them with instead and the metres one unit of the part's own UV covers, so a
 * metre-scaled finish lands at its scale. Geometry never changes: the hatch
 * beside a drain inlet is the same 2 x 2 m plate, worn as a slotted drain
 * cover, an access cassette's plates between its bars are slotted grates, and
 * leftover carriageway infill reads as patched asphalt. Streets 0.14.1 names
 * these finishes itself. An infill prism is a 2 m piece scaled to the field it
 * fills, so a metre-mapped finish on it is sampled in world metres instead,
 * in a batch of its own (`<surface>@world`), and never stretches. A route
 * whose finish the binding lacks, or whose part a kit already names by its
 * finish, leaves the part as it is.
 */
const ROUTES = Object.freeze( [
	{ piece: /^overlay\/drain\//, from: 'tread', to: 'drainCover', metres: 2 },
	{ piece: /^prop\/access\//, from: 'perforated', to: 'drainGrate', metres: 1 },
	{ piece: /^infill\/asphalt$/, from: 'asphalt', to: 'asphalt-patched', metres: 1 }
] );
/** Scaled prisms, whose own UVs stretch with the placement. */
const SCALED = /^infill\//;
/** Mappings that read the part's own UVs, which a scaled prism stretches. */
const MAPPED = [ 'metres', 'panel', 'curb-band', 'paint' ];

/**
 * The surface a kit part draws with, the batch it draws in, the factor its
 * UVs take to reach the finish's scale and whether it is sampled in world
 * metres instead of its own UVs.
 * @returns `{ surface, bucket, uvScale, worldUv }`
 */
export function drawnSurface( pieceId, surfaceId, binding ) {

	const route = ROUTES.find( ( { piece, from, to } ) => from === surfaceId && piece.test( pieceId ) && Object.hasOwn( binding.surfaces, to ) );
	const surface = route ? route.to : surfaceId;
	const worldUv = SCALED.test( pieceId ) && MAPPED.includes( binding.surfaces[ surface ]?.uv?.mode );

	return { surface, bucket: worldUv ? `${surface}@world` : surface, uvScale: route ? route.metres : 1, worldUv };

}

/** Every batch a kit piece draws in, after its routes. */
export function drawnSurfaces( piece, binding ) {

	return piece.surfaces.map( ( id ) => drawnSurface( piece.id, id, binding ).bucket );

}
