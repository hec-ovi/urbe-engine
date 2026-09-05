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
- Every authored ground polygon, including curb tops and corner pieces, is filled completely at its `top`; curb faces use its `bottom`. Rendering and collision use these same triangles. Legacy covers without elevations retain class defaults; exported `SIDEWALK_HEIGHT` is the Atlas default of 0.15 m.
- Atlas seed selects one complete family from [Materials street styles](../../../../materials/bindings/street-styles.json). Road, paving and continuous curb finishes retain catalog world scale. All cover UVs share the world origin; explicit paving-region grid and perimeter construction remain a separate layout responsibility.
- SafetyGround exposes `elevation`, `mesh` and its physics `handle`. Elevation is 2 m below the minimum of zero, group geometry, building floors, station volumes and water elevation minus depth.
- One infinite upward-facing half-space blocks falls everywhere below that elevation. Its two-triangle street-asphalt surface covers the entire camera frustum and keeps world-metre UVs as the camera moves.
- `dispose()` removes the safety mesh and collider and releases its geometry. Factory materials remain owned by the factory.

## Errors

- `E_HIGHWAY_STRUCTURE`: invalid authored highway data.
- `E_GROUND_CONSTRUCTION`: unsupported paving version, missing or duplicate references, or an unknown functional band.
- `E_PHYSICS_FLOOR`: the resulting safety elevation is not finite.

## Invariants

- Safety collision is independent of camera position and visible surface size.
- Safety ground remains below basement floors, tunnel geometry, station shafts and declared water bottoms; it never seals their entrances or surfaces.
- Ground and safety surfaces use the same elevations for rendering and collision.

## Dependencies

- [Atlas](../../../../atlas/CONTRACT.md), [Exterior](../../../../exterior/CONTRACT.md) and [game](../CONTRACT.md) for validated world data and generated geometry.
- [Physics](../physics/CONTRACT.md) for fixed geometry and half-space collision.
- [Engine](../../../CONTRACT.md) for the material factory's world-scale tiling.
