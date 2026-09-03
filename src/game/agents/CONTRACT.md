# CONTRACT: NPC agents

Purpose: materializes persistent simulation NPC identities and moves their bodies over Connections paths, including quest-directed following and deterministic schedule return.

Status: the public continuity and follow API is implemented and tested. The GameApp and quest-action adapter is pending.

## Inputs

- Movement network: [schema/movement-network.schema.json](schema/movement-network.schema.json). `WalkRoutes` indexes `connections.networks.walk`; every movement edge must carry authoritative `path3`.
- Place anchors: [schema/places.schema.json](schema/places.schema.json). Optional loaded parcel and stop positions plus interior anchor ids, positions and headings.
- Appearance request: [schema/appearance-request.schema.json](schema/appearance-request.schema.json). One already-instanced npcId and current simulation time.
- Unload request: [schema/unload-request.schema.json](schema/unload-request.schema.json). The materialized npcId whose body leaves the visible set.
- Follow start: [schema/follow-start.schema.json](schema/follow-start.schema.json). One already-instanced, live `npcId`, simulation time and player position.
- Follow update: [schema/follow-update.schema.json](schema/follow-update.schema.json). Current simulation time, bounded frame delta and player position.
- Follow stop: [schema/follow-stop.schema.json](schema/follow-stop.schema.json). Current simulation time.
- Conversation start: [schema/conversation-start.schema.json](schema/conversation-start.schema.json). Exact npcId, current body position, place, heading and seated state.
- Conversation stop: [schema/conversation-stop.schema.json](schema/conversation-stop.schema.json). Current simulation time.
- Visible update: [schema/visible-update.schema.json](schema/visible-update.schema.json). Current time, player position and the offscreen virtualization distance.
- Restore state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json). A prior output of `serialize()` for the same restored simulation.

The simulation dependency supplies `getNPC`, `continuityAt`, `interrupt` and `resume` per [the simulation contract](../../../../simulation/CONTRACT.md). Its exact continuity output is [npc-continuity.schema.json](../../../../simulation/src/schemas/npc-continuity.schema.json).

## Outputs

- Actor state: [schema/actor-state.schema.json](schema/actor-state.schema.json). Exact npcId, name, type, gender, appearance seed, scheduled place and progress, world position, heading, animation, visibility and control mode.
- Optional actor state: [schema/actor-state-or-null.schema.json](schema/actor-state-or-null.schema.json). Follow updates without an active follower and unloads of unknown materializations return null.
- Actor states: [schema/actor-states.schema.json](schema/actor-states.schema.json). Stable npcId-sorted projections for every retained materialization, including invisible virtualized actors.
- Serializable state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json). Every materialized identity and the active follow or return route.

## Events

- `appear(request)` projects the NPC's actual simulation schedule. `unload(request)` removes visibility while retaining identity state. A later `appear` uses the same npcId and body traits.
- `startFollow(request)` accepts only a live, positioned NPC, interrupts its routine, and routes it toward the player.
- `updateFollow(request)` replans over `path3`, walks at 1.4 m/s, runs at 2.4 m/s beyond 8 m, and stops 1.8 m from the player. Movement per update never exceeds speed times elapsed time.
- `stopFollow(request)` resumes the simulation and enters `resuming` mode. The NPC walks from its current position to the current scheduled place or next destination before returning to `schedule` mode.
- `beginConversation(request)` preserves the body at the visible position and pauses its routine. `endConversation(request)` walks a dialogue-interrupted NPC back into the current schedule. A follower stays interrupted and returns to follow control when dialogue closes.
- `updateVisible(request)` reprojects visible schedule-controlled actors each frame and marks distant ones invisible without discarding identity or schedule state.
- `serialize()` and `restore(save)` preserve materialized body traits, world position, schedule progress and active interruption or return state.

## Errors

- `E_NPC_INPUT`: an API request or restore state does not match its schema.
- `E_NPC_OUTPUT`: an actor or save result does not match its schema.
- `E_NPC_UNKNOWN`: the simulation does not hold that instanced npcId.
- `E_NPC_UNAVAILABLE`: the NPC is dead or no longer available.
- `E_NPC_PLACE`: the NPC's current scheduled state has no walk position.
- `E_NPC_PATH`: the player or scheduled destination is unreachable.
- `E_NPC_CONFLICT`: another NPC is already following, or stop was requested without an active follower.

## Dependencies

- Simulation public NPC and continuity APIs.
- Connections walk graph output.
- Character asset catalog for purchased animation clips.

## Invariants

- Named, focused and quest NPCs are keyed only by their actual npcId. A later statistical crowd handle cannot rename one or take its body.
- Appearance comes from the instance's persistent `appearanceSeed`, including after unload, save restore and reappearance.
- Scheduled and follow movement samples only Connections `path3`; flat compatibility paths never position a body.
- Follow speed is bounded and its stopping distance is deterministic. Explicit stop does not teleport the visible actor to its schedule.
- Idle, walk, sprint and seated states select the corresponding purchased clip. Crouch is selected only for an explicit crouch action.
- An interior waiter, barista or vendor keeps the simulation type chosen for that post. The engine does not reinterpret an interior role as an unrelated type.

## Remaining adapter work

- Wire `NpcContinuity` into GameApp, Crowd and quest follow actions after the transit integration settles. Until then the public controller is exercised through engine integration tests but is not called by the live frame loop.
- Speaking and listening turn coordination still uses the existing talk presentation and is not part of this controller.

## How to modify this blackbox safely

Keep simulation identities and Connections geometry authoritative. Update every affected schema and this contract, exercise behavior through `NpcContinuity`, then run the complete engine test and build commands.
