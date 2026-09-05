# CONTRACT: game ground

Purpose: renders authored city cover and places an unbounded safety floor below the world.

## In

- `GroundBuilder(atlas, factory).build()`: Atlas cover, station shafts and highway structures; the material factory resolves their catalog surfaces.
- `GroundBuilder.regionFootprints(atlas, band)`: one functional band (`curb`, `border`, `furnishing`, `walking`, `frontage`, `circulation`) from [Atlas fitted paving](../../../../atlas/src/streets/construction/paving/schema.ts).
- `SafetyGround({atlas, buildings, groups, physics, factory, camera})`: validated Atlas water and station records, loaded exterior blueprints, generated ground/shell/link/transit groups in world coordinates, Physics, material factory and a perspective camera.
- `SafetyGround.update(camera)`: current camera position, aspect, field of view, zoom and finite far distance.

## Out

- GroundBuilder returns `{group, colliderGeometry, bounds}`. Station mouths remain open. Highway geometry follows published profiles and dimensions.
- `regionFootprints` returns read-only `{region, layout, frame, covers}` views over the exact authored records, grouped by region and filtered by functional band. Every finish part remains present, including internal joints and borders. Callers must not mutate these Atlas-owned records. It performs no polygon union or reclassification; legacy worlds return `[]`.
- Every authored ground polygon is filled completely at its `top`; curb faces use its `bottom`. Fitted paving expands only the supplied integer spans and snapped frame corners into bodies and four disjoint joint strips. Shared edge stations remain vertices through rendering. No cell is clipped, inferred or backed by another face. Solid parts retain their exact polygon and role. Collision triangulates the owner polygons and exposed curb faces.
- Fitted regions use their stored layout family and the [Materials construction surfaces](../../../../materials/bindings/street-styles.json), following [Atlas finish roles](../../../../atlas/src/streets/construction/paving/CONTRACT.md). Cell pitch never sets texture repeat. Top UVs are frame-local metres (`U`, `-V`); exposed faces use physical edge distance from that frame and world elevation. Curb joints continue down their exposed road-facing boundaries. Meshes batch indexed vertices by family and finish, with `userData.groundConstruction: {familyId, finish}`.
- Legacy covers without fitted paving retain their seeded family, world-origin UVs and class-default elevations. Exported `SIDEWALK_HEIGHT` is the Atlas default of 0.15 m.
- SafetyGround exposes `elevation`, `mesh` and its physics `handle`. Elevation is 2 m below the minimum of zero, group geometry, building floors, station volumes and water elevation minus depth.
- One infinite upward-facing half-space blocks falls everywhere below that elevation. Its two-triangle street-asphalt surface covers the entire camera frustum and keeps world-metre UVs as the camera moves.
- `dispose()` removes the safety mesh and collider and releases its geometry. Factory materials remain owned by the factory.

## Errors

- `E_HIGHWAY_STRUCTURE`: invalid authored highway data.
- `E_GROUND_CONSTRUCTION`: unsupported paving version, missing or duplicate references, unknown functional band or finish family, invalid frame, module, cell spans, solid role or elevations. Construction input fails before material creation.
- `E_PHYSICS_FLOOR`: the resulting safety elevation is not finite.

## Invariants

- Safety collision is independent of camera position and visible surface size.
- Safety ground remains below basement floors, tunnel geometry, station shafts and declared water bottoms; it never seals their entrances or surfaces.
- Ground and safety surfaces use the same owned regions and elevations for rendering and collision.

## Dependencies

- [Atlas](../../../../atlas/CONTRACT.md), [Exterior](../../../../exterior/CONTRACT.md) and [game](../CONTRACT.md) for validated world data and generated geometry.
- [Physics](../physics/CONTRACT.md) for fixed geometry and half-space collision.
- [Engine](../../../CONTRACT.md) for the material factory's world-scale tiling.
