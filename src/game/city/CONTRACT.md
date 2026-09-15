# City geometry

Loads assembled shells and fixtures and streams furnished interior floors into the game scene.

Building and door entries follow the [game contract](../CONTRACT.md). This contract specifies interior and street fixture streams.

## Input

- `StreetMarkings.build(atlas, networks, factory, resolver, mode, native=false)` returns a marking group. With `native:true`, the saved bundle owns ordinary paint and this builder retains highway paint only. Explicit `debug` or `glow` modes still show authoritative lane diagnostics.

- [Stream schema](schema/interior-stream.d.ts): constructor ports, registration, player feet and callbacks.
- Floor documents follow [Interior's floor schema](../../../../interior/schemas/floor.schema.json), with the floor's `glbUrl` added by WorldSource.
- Worker geometry and source materials follow the [cut schema](schema/interior-cut.d.ts).
- `StreetLamps(atlas, factory, walk?)` takes the Game contract's Atlas world, material factory and optional Connections walk graph. `.stream(options?)` follows the [street fixture schema](schema/street-fixtures.d.ts).

## Output

An Exterior opening with `scenery` references its authored `scenery:<floor>` GLB node. Closed shells render those nodes with their published materials and skip generated room replacements for those openings. Buildings selected for real interiors omit the scenic nodes. Scenic geometry creates no collision; paired cladding remains solid shell geometry.

Optional `scenery.lights` entries publish actual fixture positions, colors, lumens and finite ranges. Neon passes them into the shared CityLights pool for closed shells. Opening IDs identify their sources; dark rooms emit zero lumens. Source positions and fixture geometry share one placement calculation.

Paired scenic receiver surfaces carry a load-time `scenicRadiance` RGB vertex attribute. The original planes and UVs are subdivided on a metre grid. Downward fixture illumination and diffuse floor return are evaluated inside the owning room, independently of player position or live light-slot selection. Ceilings receive diffuse return. The material multiplies its original albedo by that field and the shared night switch; live point lights do not relight these static receivers. Legacy surfaces without emitter records keep their catalog emission level. Scenic materials are cell-owned; catalog maps remain factory-owned.

`group`, `rooms`, `liveInteriors`, `update(feet)` and collider callbacks follow the stream schema. Registration opens buildings within 70 m and drops them past 95 m. The nearest requested floor loads first, one at a time. The player's floor and its neighbors are visible and solid; one further floor on either side stays in memory.

Static interior geometry and each detached floor prepare one renderable at a time through `Warmup.warmAll`. Each floor prepares the dim binding and every fixed room-light slot before becoming visible or solid, then returns to dim. Cancellation is checked between renderables. Active preparation settles before its geometry, source maps, decoded images and light clones are released. Preparation errors leave the band hidden and report the floor identifier.

After rendering preparation, `onColliderBand` receives the floor's original world-space position arrays. Its readiness promise keeps the band hidden while Physics prepares exact collision across frames. A floor leaving the visible window calls `onDropBand`, including during admission; stale readiness cannot show it. Collision errors release the floor and report its identifier. One floor loads or prepares collision at a time.

`StreetLamps.build()` returns the complete `{group, posts, glows, dispose}` scene. `.stream()` returns nearby instances, source-derived whole-plan post reservations and admission ports in the street fixture schema. Source planning yields across frames and preserves source order: 19 m alternating posts, widest junction corners, 34 m plaza borders, 6 m separation, complete furnishing bases and overhead clearances. Uncovered walk legs receive wall-mounted fixtures on nearby facing facades. Spatial queries retain every overlapping authored volume.

Street fixtures belong to exactly one half-open cell by their final mounting position, independent of movement order. Cells are 128 m by default (16-256 m supported). Only nearby cells instantiate original pole, head, lens and wall-pack templates. New cells prepare rendering and requested collision before visibility. Later ports also prepare resident cells. Eviction cancels pending posts and releases instance buffers; return restores the same fixtures and glow identities. Disposal releases template geometry; factory materials stay shared. Invalid windows reject with `E_STREET_FIXTURE_WINDOW`; preparation and collision errors propagate after releasing the failed cell.

## Dependencies

[Game](../CONTRACT.md), [Interior](../../../../interior/CONTRACT.md), [material factory](../../building/CONTRACT.md), [Light](../light/CONTRACT.md), [Look](../look/CONTRACT.md), [Physics](../physics/CONTRACT.md).
