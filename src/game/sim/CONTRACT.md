# CONTRACT: simulation host

Purpose: hosts the simulation library for the playable engine without duplicating population, identity or schedule rules.

## Inputs

- `SimBridge.create(atlas, connections, buildings, params, npcTypes, save)` receives the Atlas blueprint, Connections output, loaded interior NPC support, simulation parameters, optional Naming type set and optional [simulation-save.schema.json](../../../../simulation/src/schemas/simulation-save.schema.json) described by [the simulation input contract](../../../../simulation/CONTRACT.md).
- `instantiate(crowdId, timeMin)`, `getNPC`, `findNPCs`, `getNPCVendor`, `reserveNPC`, `applyFlag`, `behaviorAt`, `interrupt` and `resume` pass through the corresponding simulation APIs.
- `continuityAt(npcId, timeMin)` takes an already-instanced NPC identity and simulation time.

## Outputs

- `continuityAt` returns [npc-continuity.schema.json](../../../../simulation/src/schemas/npc-continuity.schema.json) unchanged.
- Population, crowd, instance, behavior and query outputs are the values declared by [the simulation contract](../../../../simulation/CONTRACT.md).
- `serialize()` returns [simulation-save.schema.json](../../../../simulation/src/schemas/simulation-save.schema.json) unchanged for exact replay restore.
- `instantiate` converts a stale or refused crowd handle to `null`, and `behaviorAt` returns null when no state is available, preserving the existing interaction adapter behavior. Other story-side methods preserve simulation errors.

## Events

- Creation passes one assembled world's blueprint, Networks, interiors and NPC type set into `createSimulation` once, or restores the same input plus a replay save through `restoreSimulation`.
- Interrupt and resume are recorded by the simulation and therefore participate in its save replay.

## Errors

The bridge adds no error codes. Methods other than the nullable crowd-handle adapter preserve the simulation's closed `SimulationError` set.

## Dependencies

- Simulation public package contract.
- Atlas, Connections, Interior and Naming data only through the simulation input contract.

## Invariants

- The engine does not infer a second NPC type, role, home, schedule, appearance seed or current place.
- A waiter or barista returned through this bridge is the exact worker selected by the simulation for that interior post.
- Continuity data is not flattened or rewritten.

## How to modify this blackbox safely

Keep this class as a narrow adapter. Add behavior to simulation or to its renderer-side consumer, expose only the necessary pass-through here, then test through `SimBridge`.
