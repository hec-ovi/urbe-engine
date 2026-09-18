# Native street residency

Draws the saved street from its piece kit and admits its cuboids to Physics.

`NativeStreetStream(source, materials)` takes the [verified source](../native/schema/ports.d.ts) and the [native material port](../materials/schema/ports.d.ts). It returns the [Ground stream surface](../schema/stream.d.ts).

The kit loads once for the whole city. Every piece the manifest's `kit` names is read through the source, checked against the size and SHA-256 it publishes, decoded once through the city GLTF loader and kept as the producer quantized it. Each piece primitive becomes one instanced draw for the whole city, wearing the material its `streetNativeSurface` names, and every mesh must carry that surface and its own collision flag. A piece whose bytes, triangle count or surfaces differ from the kit rejects without a fallback. Nothing is rebased: the piece's own node transform rides in the instance matrix, under the placement's scale, its positive Y rotation and its position.

A cell is what the placement table says it is, the placements sharing one 128 m square, with the exact rectangle their geometry covers. Admitting a cell appends its copies to the draws that already stand and dropping it takes them back out, so the draw count follows the kit and never the amount of street standing. Rendering and collision radii are independent. Updates coalesce, a newer window cancels obsolete admission, and admission hands the display a frame every 4 ms. The current `prepare` port compiles the shared draws, one mesh per distinct surface, before any copy is drawn, including when it is replaced during pending preparation.

Collision is one fixed cuboid body per cell. Each collidable placement contributes its piece's boxes: the piece's collidable triangles sampled into a piece-local heightfield, its tops grouped into walking levels, and each level merged into the rectangles covering it. The heights covering most of the piece claim their level first, largest area down, and a height within one 0.06 m step of a claimed level joins it, so no cuboid top sits more than one step from the surface under it. A straight segment stands as its road and its two sidewalk bands, with the authored 0.2 m curb as a step between them, and a junction arm keeps its road at its own height and its sidewalk at the authored 0.2 m with the crossing ramp stepping between them. Markings and pieces without collision contribute nothing and paint is never solid. Boxes are computed once per piece and every copy reuses them.

Disposal releases the kit's geometry and draws and aborts active reads. Source, shared materials and their textures remain caller-owned.

Errors: `E_NATIVE_STREET_STREAM` for an invalid window, a disposed stream, a piece that differs from the kit, a missing surface or collision authority, or a placement the kit has no piece for. Source, material, preparation and Physics errors propagate.

Dependencies: saved native street source, native Materials, Ground stream schema, Physics cuboid admission, [kit piece draws](../../city/kit/CONTRACT.md), Three GLTFLoader with the meshopt decoder.
