# CONTRACT: game ground

Purpose: renders authored city cover and places an unbounded safety floor below the world.

## In

- `GroundBuilder(atlas, factory).build()`: Atlas cover, station shafts and highway structures; the material factory resolves their catalog surfaces.
- `SafetyGround({atlas, buildings, groups, physics, factory, camera})`: validated Atlas water and station records, loaded exterior blueprints, generated ground/shell/link/transit groups in world coordinates, Physics, material factory and a perspective camera.
- `SafetyGround.update(camera)`: current camera position, aspect, field of view, zoom and finite far distance.

## Out

- GroundBuilder returns `{group, colliderGeometry, bounds}`. Station mouths remain open. Highway geometry follows published profiles and dimensions.
- SafetyGround exposes `elevation`, `mesh` and its physics `handle`. Elevation is 2 m below the minimum of zero, group geometry, building floors, station volumes and water elevation minus depth.
- One infinite upward-facing half-space blocks falls everywhere below that elevation. Its two-triangle street-asphalt surface covers the entire camera frustum and keeps world-metre UVs as the camera moves.
- `dispose()` removes the safety mesh and collider and releases its geometry. Factory materials remain owned by the factory.

## Errors

- `E_HIGHWAY_STRUCTURE`: invalid authored highway data.
- `E_PHYSICS_FLOOR`: the resulting safety elevation is not finite.

## Invariants

- Safety collision is independent of camera position and visible surface size.
- Safety ground remains below basement floors, tunnel geometry, station shafts and declared water bottoms; it never seals their entrances or surfaces.
- Ground and safety surfaces use the same elevations for rendering and collision.

## Dependencies

- [Atlas](../../../../atlas/CONTRACT.md), [Exterior](../../../../exterior/CONTRACT.md) and [game](../CONTRACT.md) for validated world data and generated geometry.
- [Physics](../physics/CONTRACT.md) for fixed geometry and half-space collision.
- [Engine](../../../CONTRACT.md) for the material factory's world-scale tiling.
