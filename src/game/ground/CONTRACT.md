# CONTRACT: game ground

Purpose: renders physical streets and city cover, with an unbounded safety floor below the world.

## In

- `GroundBuilder(atlas, factory).build()`: [Atlas module prisms and repeated placements](../../../../atlas/src/streets/construction/modules/schema.ts), cover, station shafts and highway structures; the material factory resolves their catalog surfaces.
- `GroundBuilder(atlas, factory).stream(options?)`: the same source, with [spatial settings and ports](schema/stream.d.ts). `update(position, window?)` prepares nearby source tiles serially; visibility radius and collision radius are independent. Calls within one movement window reuse the pending promise. A newer window cancels obsolete admission. Later ports also prepare or admit resident tiles. Settings persist across calls.
- `GroundMarkings(atlas, road, factory, bindings, settings?).build()`: Atlas crossings/junctions, [Connections road lanes](../../../../connections/schemas/networks.schema.json), PBR factory, [Materials paint bindings](../../../../materials/schema/street-markings.schema.json) and [settings](marking-settings.schema.json), with [defaults](marking-defaults.json).
- `GroundBuilder.regionFootprints(atlas, band)`: one functional band (`curb`, `border`, `furnishing`, `walking`, `frontage`, `circulation`) from [Atlas fitted paving](../../../../atlas/src/streets/construction/paving/schema.ts).
- `SafetyGround({atlas, buildings, groups, physics, factory, camera})`: validated Atlas water and station records, loaded exterior blueprints, generated ground/shell/link/transit groups in world coordinates, Physics, material factory and a perspective camera.
- `SafetyGround.update(camera)`: current camera position, aspect, field of view, zoom and finite far distance.

## Out

- GroundBuilder returns `{group, colliderGeometry, bounds}`. Station mouths remain open. Highway geometry follows published profiles and dimensions.
- GroundStream returns the [stream surface](schema/stream.d.ts), including its group, global bounds and residency counters. Tiles own each complete source cover and every module repetition once, with their exact source boundaries. Visible geometry uses persistent material batches with per-instance frustum culling. Templates upload once per active material; reusable instance slots and geometry capacity follow the resident window. Preparation receives the batch group once per changed window. Collision expands only nearby render triangles into arrays of at most 2,048 triangles for Physics admission. Eviction releases instance buffers and tile geometry; disposal releases cached templates. No whole-city collision buffer is allocated. Initial updates may omit ports and attach them later.
- Module cities render and collide with physical prisms at their exact absolute levels. Quarter turns and local-X repeats preserve metre dimensions and local metre UVs. Definitions share geometry with exact finish bindings. Recessed joints, curb bodies, gutters and raised gutter lips remain distinct. Eager meshes expose `userData.groundModule: {moduleId, familyId, role}`. Guardrails belong to Props. Ground records carrying `moduleBlockId` are planning outlines and produce no faces or collision.
- Module placement finishes resolve Materials `constructionSurfaces`: panels use `pavingBody`, gutters and lips use `gutter`, and joints and curbs keep their own bindings. Roadways use the family's optional `road` override or its published road surface. Unowned paved land in module cities uses the seeded construction family. Legacy worlds retain their seeded surface bindings.
- GroundMarkings returns `{group, primitives, omitted}`. Each read-only primitive records `kind`, `edgeId`, optional lane/node identity and allowed `turns`, finish (`white` or `accent`) and complete 3D `polygons`. Paint batches into two nonemissive catalog meshes, offset by the declared coating thickness; it has no collision. Ground owns normal paint; debug lane visualization is a separate Game concern.
- Authored lane boundaries pair exact source offsets and widths. Opposing directions receive double center lines; shared same-direction boundaries receive whole dashes. Atlas's external field planes terminate solid lines and bound complete dashes, stop bars and straight/left/right arrow glyphs from actual `lane.next` labels. Internal junction edges receive no lane paint. A complete arrow that cannot fit reports `complete-glyph-does-not-fit`; it is not clipped.
- Crossing polygons remain exactly as Atlas published them, at the source profile height. Legacy worlds retain lane `path3` intervals and published crossing polygons, without inferred stop bars or arrows. A legacy crossing requires a constant source profile because it has no authored station. All paint polygons use physical metre UVs and remain independent of street albedo.
- `regionFootprints` returns read-only `{region, layout, frame, covers}` views over the exact authored records, grouped by region and filtered by functional band. Every finish part remains present, including internal joints and borders. Callers must not mutate these Atlas-owned records. It performs no polygon union or reclassification; legacy worlds return `[]`.
- Every nonmodule ground cover is filled completely at its `top`; curb faces use its `bottom`. Fitted paving expands only the supplied integer spans and snapped frame corners into bodies and four disjoint joint strips. Shared edge stations remain vertices through rendering. No cell is clipped, inferred or backed by another face. Solid parts retain their exact polygon and role. Collision triangulates the owner polygons and exposed curb faces.
- Hole-free owners with a simple Float32 boundary are triangulated on that encoded boundary. Every canonical station remains incident to a boundary edge, including collinear stations. Source records and fitted cell expansion stay unchanged. Encoded collapse, repeated vertices, crossings and nonincident contacts require a compatible producer or adapter representation; those rings and station-hole contours are outside this encoded-top guarantee.
- Group modules retain every canonical base corner and joint-cut station. Internal base subdivisions use body material; joints occur only at the published group perimeter. Modern `1.1.0` region sources must match their owners' surface and levels. Its `roadwayLayoutId` selects the family's optional `constructionSurfaces.road` override. Omission keeps the seeded `surfaces.road`, independently of paving; a declared invalid override fails. Road UVs remain world metres in either case. Version `1.0.0` remains readable.
- Fitted regions use their stored layout family and the [Materials construction surfaces](../../../../materials/bindings/street-styles.json), following [Atlas finish roles](../../../../atlas/src/streets/construction/paving/CONTRACT.md). Cell pitch never sets texture repeat. Top UVs are frame-local metres (`U`, `-V`); exposed faces use physical edge distance from that frame and world elevation. Curb joints continue down their exposed road-facing boundaries. Meshes batch indexed vertices by family and finish, with `userData.groundConstruction: {familyId, finish}`.
- Legacy covers without fitted paving retain their seeded family, world-origin UVs and class-default elevations. Exported `SIDEWALK_HEIGHT` is the Atlas default of 0.15 m.
- SafetyGround exposes `elevation`, `mesh` and its physics `handle`. Elevation is 2 m below the minimum of zero, group geometry, building floors, station volumes and water elevation minus depth.
- One infinite upward-facing half-space blocks falls everywhere below that elevation. Its two-triangle street-asphalt surface covers the entire camera frustum and keeps world-metre UVs as the camera moves.
- `dispose()` removes the safety mesh and collider and releases its geometry. Factory materials remain owned by the factory.

## Errors

- `E_HIGHWAY_STRUCTURE`: invalid authored highway data.
- `E_GROUND_CONSTRUCTION`: unsupported construction version, missing or duplicate references, unknown functional band or finish family, invalid frame, module prism, quarter turn, repetition, cell spans, solid role or elevations. Construction input fails before material creation.
- `E_GROUND_TRIANGULATION`: a simple encoded boundary cannot be filled with positive triangles and every boundary station.
- `E_GROUND_STREAM`: invalid cell size, position or window distance, or update after disposal. Preparation and collision errors propagate after releasing that tile.
- `E_GROUND_MARKINGS`: missing lane/crossing/approach authority, inconsistent shared boundaries, invalid settings or material bindings, a reversing lane join or a legacy crossing with unknown height.
- `E_PHYSICS_FLOOR`: the resulting safety elevation is not finite.

## Invariants

- Safety collision is independent of camera position and visible surface size.
- Safety ground remains below basement floors, tunnel geometry, station shafts and declared water bottoms; it never seals their entrances or surfaces.
- Ground and safety surfaces use the same owned regions and elevations for rendering and collision.

## Dependencies

- [Atlas](../../../../atlas/CONTRACT.md), [Exterior](../../../../exterior/CONTRACT.md) and [game](../CONTRACT.md) for validated world data and generated geometry.
- [Physics](../physics/CONTRACT.md) for fixed geometry and half-space collision.
- [Engine](../../../CONTRACT.md) for the material factory's world-scale tiling.
