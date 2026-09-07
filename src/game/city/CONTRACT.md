# City geometry

Loads assembled shells and fixtures and streams furnished interior floors into the game scene.

Building, door and fixture entries follow the [game contract](../CONTRACT.md). This contract specifies `InteriorStream`.

## Input

- [Stream schema](schema/interior-stream.d.ts): constructor ports, registration, player feet and callbacks.
- Floor documents follow [Interior's floor schema](../../../../interior/schemas/floor.schema.json), with the floor's `glbUrl` added by WorldSource.
- Worker geometry and source materials follow the [cut schema](schema/interior-cut.d.ts).

## Output

`group`, `rooms`, `liveInteriors`, `update(feet)` and collider callbacks follow the stream schema. Registration opens buildings within 70 m and drops them past 95 m. The nearest requested floor loads first, one at a time. The player's floor and its neighbors are visible and solid; one further floor on either side stays in memory.

Static interior geometry and each detached floor prepare one renderable at a time through `Warmup.warmAll`. Each floor prepares the dim binding and every fixed room-light slot before becoming visible or solid, then returns to dim. Cancellation is checked between renderables. Active preparation settles before its geometry, source maps, decoded images and light clones are released. Preparation errors leave the band hidden and report the floor identifier.

## Dependencies

[Game](../CONTRACT.md), [Interior](../../../../interior/CONTRACT.md), [material factory](../../building/CONTRACT.md), [Light](../light/CONTRACT.md), [Look](../look/CONTRACT.md).
