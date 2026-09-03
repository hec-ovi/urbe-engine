# CONTRACT: NPC agents

Purpose: materializes persistent simulation NPC identities and controls follow, lead, passenger carry, conversation, explicit crouch and deterministic schedule return over Connections paths.

Status: the public continuity and follow API is wired into the live GameApp, Crowd, Interactor and explicit quest control adapter.

## Inputs

- Movement network: [schema/movement-network.schema.json](schema/movement-network.schema.json). `WalkRoutes` indexes `connections.networks.walk`; every movement edge must carry authoritative `path3`. Scheduled transit materialization also consumes the matching Connections route's ordered stops, timetable, service window and 3D shape.
- Place anchors: [schema/places.schema.json](schema/places.schema.json). Optional loaded parcel and stop positions plus interior anchor ids, positions and headings.
- Appearance request: [schema/appearance-request.schema.json](schema/appearance-request.schema.json). One already-instanced npcId and current simulation time.
- Unload request: [schema/unload-request.schema.json](schema/unload-request.schema.json). The materialized npcId whose body leaves the visible set.
- Follow start: [schema/follow-start.schema.json](schema/follow-start.schema.json). One already-instanced, live `npcId`, simulation time and player position.
- Lead start: [schema/lead-start.schema.json](schema/lead-start.schema.json). One live npcId, simulation time and exact authored destination place.
- Follower carry: [schema/follower-carry.schema.json](schema/follower-carry.schema.json). The active follower, measured transit position and authoritative route id.
- Follow update: [schema/follow-update.schema.json](schema/follow-update.schema.json). Current simulation time, bounded frame delta and player position.
- Follow stop: [schema/follow-stop.schema.json](schema/follow-stop.schema.json). Current simulation time.
- Crouch start: [schema/crouch-start.schema.json](schema/crouch-start.schema.json). One exact npcId and current simulation time. It never derives from player input or movement.
- Crouch stop: [schema/crouch-stop.schema.json](schema/crouch-stop.schema.json). The same exact npcId and current simulation time.
- Conversation start: [schema/conversation-start.schema.json](schema/conversation-start.schema.json). Exact npcId, current body position, place, heading and seated state.
- Conversation stop: [schema/conversation-stop.schema.json](schema/conversation-stop.schema.json). Current simulation time.
- Visible update: [schema/visible-update.schema.json](schema/visible-update.schema.json). Current time, player position and the offscreen virtualization distance.
- Restore state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json). A prior output of `serialize()` for the same restored simulation.

The simulation dependency supplies `getNPC`, `continuityAt`, `interrupt` and `resume` per [the simulation contract](../../../../simulation/CONTRACT.md). Its exact continuity output is [npc-continuity.schema.json](../../../../simulation/src/schemas/npc-continuity.schema.json).

## Outputs

- Actor state: [schema/actor-state.schema.json](schema/actor-state.schema.json). Exact npcId, name, type, gender, appearance seed, scheduled place and progress, world position, heading, animation, visibility and control mode.
- Optional actor state: [schema/actor-state-or-null.schema.json](schema/actor-state-or-null.schema.json). Follow updates without an active follower and unloads of unknown materializations return null.
- Actor states: [schema/actor-states.schema.json](schema/actor-states.schema.json). Stable npcId-sorted projections for every retained materialization, including invisible virtualized actors.
- Serializable state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json). Every materialized identity plus active follow, return, conversation, or explicit crouch control.

## Events

- `appear(request)` projects the NPC's actual simulation schedule. Passenger transit legs map schedule progress through the matching per-leg timetable onto the route's authoritative 3D shape. `unload(request)` removes visibility while retaining identity state. A later `appear` uses the same npcId and body traits.
- `startFollow(request)` accepts only a live, positioned NPC, interrupts its routine, and routes it toward the player.
- `updateFollow(request)` replans over `path3`, walks at 1.4 m/s, runs at 2.4 m/s beyond 8 m, and stops 1.8 m from the player. Movement per update never exceeds speed times elapsed time.
- `startLead(request)` routes the exact interrupted identity to the authored destination and holds it there until release. `carryFollower(request)` places only the active follower on the measured transit route position.
- `stopFollow(request)` resumes the simulation and enters `resuming` mode. The NPC walks from its current position to the current scheduled place or next destination before returning to `schedule` mode.
- `startCrouch(request)` interrupts one actual NPC routine and holds that identity in `posing` mode with crouch animation. `releaseCrouch(request)` resumes the simulation and routes the same identity back to its current schedule.
- `beginConversation(request)` preserves the body at the visible position and pauses its routine. `endConversation(request)` walks a dialogue-interrupted NPC back into the current schedule. A follower stays interrupted and returns to follow control when dialogue closes.
- `updateVisible(request)` reprojects visible schedule-controlled actors each frame and marks distant ones invisible without discarding identity or schedule state.
- `serialize()` and `restore(save)` preserve materialized body traits, world position, schedule progress and active interruption, explicit pose, or return state.

## Errors

- `E_NPC_INPUT`: an API request or restore state does not match its schema.
- `E_NPC_OUTPUT`: an actor or save result does not match its schema.
- `E_NPC_UNKNOWN`: the simulation does not hold that instanced npcId.
- `E_NPC_UNAVAILABLE`: the NPC is dead or unavailable.
- `E_NPC_PLACE`: the NPC's current scheduled state has no position, including a route without a matching passenger leg or complete Connections path3 and timing facts.
- `E_NPC_PATH`: the player or scheduled destination is unreachable.
- `E_NPC_CONFLICT`: another NPC has active follow, conversation, or pose control, or a release does not match the controlled identity.

## Dependencies

- Simulation public NPC and continuity APIs.
- Connections walk graph and transit route output.
- Character asset catalog for the audited animation clips.

## Invariants

- Named, focused and quest NPCs are keyed only by their actual npcId. A later statistical crowd handle cannot rename one or take its body.
- A measured physics impact freezes the exact rendered identity and removes it from interaction and pushback. A rejected impact restores its prior control state. Accepted dynamic body assembly belongs to the game physics contract.
- Appearance comes from the instance's persistent `appearanceSeed`, including after unload, save restore and reappearance.
- Scheduled and follow movement samples only Connections `path3`; flat compatibility paths never position a body.
- Scheduled passenger transit uses the routine's exact route, board stop, alight stop and progress. Ordered duplicate stops select the shortest forward portion of the route shape, so return legs keep their direction and heading.
- Follow speed is bounded and its stopping distance is deterministic. Explicit stop does not teleport the visible actor to its schedule.
- Lead speed is bounded by the same Connections path. Passenger carry requires the exact active follower and route id.
- Idle, walk, sprint and seated states select the corresponding audited clip. Crouch is selected only for an explicit crouch action.
- Explicit crouch is cast and npcId controlled. Player C input, proximity, movement speed, dialogue, and quest step kind cannot start it.
- An interior waiter, barista or vendor keeps the simulation type chosen for that post. The engine does not reinterpret an interior role as an unrelated type.

## Boundary behavior

- The gameplay animation coordinator owns speaking and listening gestures. This controller publishes the exact identity, posture, follow mode, and routine resume state it consumes.
- Simulation route workers publish a route workplace but no trip assignment. They fail closed because no authoritative vehicle position or route progress exists; passenger commute legs carry the required transit assignment.

## How to modify this blackbox safely

Keep simulation identities and Connections geometry authoritative. Update every affected schema and this contract, exercise behavior through `NpcContinuity`, then run the complete engine test and build commands.
