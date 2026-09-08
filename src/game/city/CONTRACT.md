# City geometry

Loads assembled shells and fixtures and streams furnished interior floors into the game scene.

Building and door entries follow the [game contract](../CONTRACT.md). This contract specifies interior and street fixture streams.

## Input

- [Stream schema](schema/interior-stream.d.ts): constructor ports, registration, player feet and callbacks.
- Floor documents follow [Interior's floor schema](../../../../interior/schemas/floor.schema.json), with the floor's `glbUrl` added by WorldSource.
- Worker geometry and source materials follow the [cut schema](schema/interior-cut.d.ts).
- `StreetLamps(atlas, factory, walk?)` takes the Game contract's Atlas world, material factory and optional Connections walk graph. `.stream(options?)` follows the [street fixture schema](schema/street-fixtures.d.ts).

## Output

`group`, `rooms`, `liveInteriors`, `update(feet)` and collider callbacks follow the stream schema. Registration opens buildings within 70 m and drops them past 95 m. The nearest requested floor loads first, one at a time. The player's floor and its neighbors are visible and solid; one further floor on either side stays in memory.

Static interior geometry and each detached floor prepare one renderable at a time through `Warmup.warmAll`. Each floor prepares the dim binding and every fixed room-light slot before becoming visible or solid, then returns to dim. Cancellation is checked between renderables. Active preparation settles before its geometry, source maps, decoded images and light clones are released. Preparation errors leave the band hidden and report the floor identifier.

After rendering preparation, `onColliderBand` receives the floor's original world-space position arrays. Its readiness promise keeps the band hidden while Physics prepares exact collision across frames. A floor leaving the visible window calls `onDropBand`, including during admission; stale readiness cannot show it. Collision errors release the floor and report its identifier. One floor loads or prepares collision at a time.

`StreetLamps.build()` returns the complete `{group, posts, glows, dispose}` scene. `.stream()` returns nearby instances, source-derived whole-plan post reservations and admission ports in the street fixture schema. Source planning yields across frames and preserves source order: 19 m alternating posts, widest junction corners, 34 m plaza borders, 6 m separation, complete furnishing bases and overhead clearances. Uncovered walk legs receive wall-mounted fixtures on nearby facing facades. Spatial queries retain every overlapping authored volume.

Street fixtures belong to exactly one half-open cell by their final mounting position, independent of movement order. Cells are 128 m by default (16-256 m supported). Only nearby cells instantiate original pole, head, lens and wall-pack templates. New cells prepare rendering and requested collision before visibility. Later ports also prepare resident cells. Eviction cancels pending posts and releases instance buffers; return restores the same fixtures and glow identities. Disposal releases template geometry; factory materials stay shared. Invalid windows reject with `E_STREET_FIXTURE_WINDOW`; preparation and collision errors propagate after releasing the failed cell.

## Dependencies

[Game](../CONTRACT.md), [Interior](../../../../interior/CONTRACT.md), [material factory](../../building/CONTRACT.md), [Light](../light/CONTRACT.md), [Look](../look/CONTRACT.md), [Physics](../physics/CONTRACT.md).
