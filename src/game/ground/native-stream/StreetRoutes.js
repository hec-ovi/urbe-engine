/**
 * Finishes the Materials binding publishes for parts a street kit built
 * before them still draws with an older surface. Each route names the kit
 * pieces it applies to, the surface they publish, the finish the engine draws
 * them with instead and the metres one unit of the part's own UV covers, so a
 * metre-scaled finish lands at its scale. Geometry never changes: the hatch
 * beside a drain inlet is the same 2 x 2 m plate, worn as a slotted drain
 * cover, an access cassette's plates between its bars are slotted grates, and
 * leftover carriageway infill reads as patched asphalt. Streets 0.14 names
 * these finishes itself. A route
 * whose finish the binding lacks, or whose part a kit already names by its
 * finish, leaves the part as it is.
 */
const ROUTES = Object.freeze( [
	{ piece: /^overlay\/drain\//, from: 'tread', to: 'drainCover', metres: 2 },
	{ piece: /^prop\/access\//, from: 'perforated', to: 'drainGrate', metres: 1 },
	{ piece: /^infill\/asphalt$/, from: 'asphalt', to: 'asphalt-patched', metres: 1 }
] );

/**
 * The surface a kit part draws with and the factor its UVs take to reach it.
 * @returns `{ surface, uvScale }`
 */
export function drawnSurface( pieceId, surfaceId, binding ) {

	const route = ROUTES.find( ( { piece, from, to } ) => from === surfaceId && piece.test( pieceId ) && Object.hasOwn( binding.surfaces, to ) );

	return route ? { surface: route.to, uvScale: route.metres } : { surface: surfaceId, uvScale: 1 };

}

/** Every surface a kit piece draws with, after its routes. */
export function drawnSurfaces( piece, binding ) {

	return piece.surfaces.map( ( id ) => drawnSurface( piece.id, id, binding ).surface );

}
