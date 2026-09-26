# CONTRACT: NPC agents

Purpose: materializes persistent simulation NPC identities and controls one companion (follow or lead), passenger carry, conversation, explicit crouch, quest holds and deterministic schedule return over Connections paths.

Status: the public continuity and follow API is wired into the live GameApp, Crowd, Interactor and explicit quest control adapter.

## Inputs

- Street bodies: the crowd, the traffic and the fallen rig share one `street` registry of the bodies on the road this frame. Each takes its own for a test.
- Crowd and traffic population options: [schema/population-window.schema.json](schema/population-window.schema.json). Capacity bounds resident bodies. `spawnRadius` defaults to 90 m for Crowd and 110 m for Traffic; offscreen removal adds 25 m and 30 m respectively. Crowd consumes real simulation handles within the chosen circle; Traffic fills free positions on Connections lanes over successive refreshes. A larger capacity does not invent population or road space.
- Movement network: [schema/movement-network.schema.json](schema/movement-network.schema.json). `WalkRoutes` indexes `connections.networks.walk`; every movement edge must carry authoritative `path3`. `project` searches a 16 m grid of edge segments and returns the nearest point, ties going to the lower edge id and then its earlier segment; `route` joins both projections through a heap Dijkstra settled in (distance, node id) order. Scheduled transit materialization also consumes the matching Connections route's ordered stops, timetable, service window and 3D shape.
- Place anchors: [schema/places.schema.json](schema/places.schema.json). Optional loaded parcel and public transport stop positions plus interior anchor ids, positions and headings. Rail station ids use the simulation's `stop` place kind at the published platform level.
- Appearance request: [schema/appearance-request.schema.json](schema/appearance-request.schema.json). One already-instanced npcId and current simulation time.
- Unload request: [schema/unload-request.schema.json](schema/unload-request.schema.json). The materialized npcId whose body leaves the visible set.
- Follow start: [schema/follow-start.schema.json](schema/follow-start.schema.json). One already-instanced, live `npcId`, simulation time, player position and optional `pace`.
- Lead start: [schema/lead-start.schema.json](schema/lead-start.schema.json). One live npcId, simulation time, exact authored destination place and optional `pace`.
- Pace: [values.schema.json#/$defs/pace](schema/values.schema.json). `giveUpBeyond` metres and `giveUpAfterMin` simulation minutes. A lead without one gives up beyond 60 m after 3 minutes; a follow without one never gives up.
- Follower carry: [schema/follower-carry.schema.json](schema/follower-carry.schema.json). The active follower, measured transit position and authoritative route id.
- Follow update: [schema/follow-update.schema.json](schema/follow-update.schema.json). Current simulation time, bounded frame delta and player position.
- Follow stop: [schema/follow-stop.schema.json](schema/follow-stop.schema.json). Current simulation time.
- Crouch start: [schema/crouch-start.schema.json](schema/crouch-start.schema.json). One exact npcId and current simulation time. It never derives from player input or movement.
- Crouch stop: [schema/crouch-stop.schema.json](schema/crouch-stop.schema.json). The same exact npcId and current simulation time.
- Conversation start: [schema/conversation-start.schema.json](schema/conversation-start.schema.json). Exact npcId, current body position, place, heading and seated state.
- Conversation stop: [schema/conversation-stop.schema.json](schema/conversation-stop.schema.json). Current simulation time, and optional `hold`.
- Hold start: [schema/hold-start.schema.json](schema/hold-start.schema.json). One exact npcId, current simulation time, the place it is wanted at, the world point, heading and optional seated posture.
- Hold release: [schema/hold-release.schema.json](schema/hold-release.schema.json). The held npcId and current simulation time.
- Visible update: [schema/visible-update.schema.json](schema/visible-update.schema.json). Current time, player position and the offscreen virtualization distance.
- Restore state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json). A prior output of `serialize()` for the same restored simulation. Version 1 saves held one `follow` slot for the companion or a walk home; restore turns a `resuming` slot into a `returns` entry and gives a leader phase `walking` and the default pace.

The simulation dependency supplies `getNPC`, `continuityAt`, `interrupt` and `resume` per [the simulation contract](../../../../simulation/CONTRACT.md). Its exact continuity output is [npc-continuity.schema.json](../../../../simulation/src/schemas/npc-continuity.schema.json).

## Outputs

- Actor state: [schema/actor-state.schema.json](schema/actor-state.schema.json). Exact npcId, name, type, gender, appearance seed, scheduled place and progress, world position, heading, animation, visibility and control mode.
- Optional actor state: [schema/actor-state-or-null.schema.json](schema/actor-state-or-null.schema.json). Follow updates without a companion, unloads of unknown materializations and `actor(npcId)` for an unknown identity return null.
- Actor states: [schema/actor-states.schema.json](schema/actor-states.schema.json). Stable npcId-sorted projections for every retained materialization, including invisible virtualized actors.
- Serializable state: [schema/continuity-save.schema.json](schema/continuity-save.schema.json), version 2. Every materialized identity, the companion (`follow`: mode, phase, cached route, lead destination, pace, `lostSinceMin`), every walk home (`returns`), conversation, explicit crouch, quest holds and posts.
- Control events: [schema/control-events.schema.json](schema/control-events.schema.json). `drainEvents()` returns and clears the companion phase changes since the latest `updateFollow` began: `{npcId, mode, phase, timeMin}`, with `reason` (`player-lost`, `unreachable`, `unavailable`) on `gave-up`. The next `updateFollow` drops undrained events. Events are not saved.
- `companion`: `{npcId, mode, phase, position}` or null, read without schema validation so a host may read it every frame. Phase is `walking`, `waiting` or `arrived`.
- `heldNpcIds` lists the identities held now. `actor(npcId)` is the retained state of one identity.

## Events

- `appear(request)` projects the NPC's actual simulation schedule. Passenger transit legs map schedule progress through the matching per-leg timetable onto the route's authoritative 3D shape. `unload(request)` removes visibility while retaining identity state. A later `appear` uses the same npcId and body traits.
- There is at most one companion, following or leading. Any number of identities walk home at once, each on its own route, and none of them blocks a new companion, crouch or hold.
- `startFollow(request)` and `startLead(request)` accept only a live, positioned NPC and interrupt its routine. They start from the body where it stands when it is on screen, held or walking home, and from its schedule projection otherwise. A held body keeps its interruption; a walk home is taken over.
- `updateFollow(request)` advances every walk home in npcId order, then the companion, and returns the companion's state or null. Routes are cached: a follow plans again once the player is 1 m from the planned end, a walk home once its scheduled point has moved 2 m, a lead only when its route runs out short of the destination. Movement per update never exceeds speed times elapsed time.
- A follower walks at 1.4 m/s, runs at 2.4 m/s beyond 8 m and stops 1.8 m from the player; its phase is `walking` while it moves and `waiting` while it stands.
- A leader walks at 1.4 m/s while the player is within 4 m or ahead on its path (running beyond 8 m), slows toward 0.8 m/s as the player lags to 10 m, and past that stops in phase `waiting`, facing the player, until the player is back within 6 m. At the destination it takes phase `arrived` once and keeps it: it stands at the destination place facing the player, stays where a conversation moves it, and stays leading until released.
- A companion with a pace gives up once the player has stayed beyond `giveUpBeyond` for `giveUpAfterMin` (`player-lost`). A companion also gives up when it dies (`unavailable`) or has no route to the player or destination (`unreachable`). On any give-up the simulation resumes, a `gave-up` event says why, and the body walks home when it has a route there; otherwise it is `released` where it stands.
- `carryFollower(request)` places only the active follower on the measured transit route position.
- `stopFollow(request)` resumes the simulation and the companion walks from where it stands to its current scheduled place or next destination in mode `resuming`, then returns to `schedule`.
- `startCrouch(request)` interrupts one actual NPC routine and holds that identity in `posing` mode with crouch animation. `releaseCrouch(request)` resumes the simulation and routes the same identity back to its current schedule.
- `beginConversation(request)` preserves the body at the visible position and pauses its routine. `endConversation(request)` walks a dialogue-interrupted NPC back into the current schedule; with `hold` it stays exactly where it stands. The companion stays interrupted and returns to following or leading when dialogue closes. Talking to anybody else never changes the companion.
- `hold(request)` interrupts one identity and keeps it at the given point in `posing` mode: the schedule pass never reprojects a held body, so the person a quest step sends the player to is still there when they arrive and after they talk. With `seated: true` it preserves a seated pose; omission stands the body. A new appointment can reclaim that identity during its walk home, while the companion, conversation and explicit pose controls retain ownership. `releaseHold(request)` resumes the simulation and walks the same identity back into its day. A follow, lead or crouch takes over a held body from where it stands.
- `updateVisible(request)` reprojects visible schedule-controlled actors each frame and marks distant ones invisible without discarding identity or schedule state. A walk home stays visible within `maxDistance`; beyond it the walk ends and the schedule projection takes the body back, invisible for that update even when the schedule place is near, and visible by distance from the next.
- `serialize()` and `restore(save)` preserve materialized body traits, world position, schedule progress and active interruption, the companion, walks home, explicit pose, quest holds and posts.
- `Crowd.questMember` adopts an anonymous simulation handle when it resolves to the requested cast npcId, including with continuity enabled. `Crowd.syncActor` returns null while a body is fallen, so control and passenger projection fail closed.
- `Crowd.castMember(npcId, timeMin, player, parcelId)` is the body of one cast NPC the story wants at a parcel now, whatever its routine says: the body that npcId already owns while it is at that parcel, else an anonymous body there that resolves to it, else that identity posted within 45 m of the player at the interior's first free counter anchor, then work anchor, then a lobby spot just inside the door. With continuity the posting is a `hold`, so the next schedule pass leaves it standing instead of walking it home. Null beyond that reach, when the crowd is full, or while the owned body is fallen.
- Adopting an existing cast body also acquires its continuity hold; merely finding the right identity does not let its next schedule update take it away. A stationary body retains its actual anchor reservation through continuity updates, so separate cast members never receive the same counter/work anchor. Hosts without continuity freeze the exact retained body instead of duplicating it.
- `Crowd.castMember(..., { meeting: true })` places listening partners together in the published entrance circulation space, 1.3 m apart and facing each other. This keeps a multi-person appointment in listening reach even when a floor's counter and work anchors are far apart. An existing conversation retains control until it closes.
- `Crowd.questMember` and `castMember` name only the anonymous body holding the handle the crowd sample reports as the requested npcId. Reading the sample establishes nobody, so every other body keeps its own identity, its own look and its right to be evicted.
- `Crowd.handleFor(member, timeMin)` offers a body whose handle stopped answering another reported handle of the body's own gender that is not established and that no other body holds, or null.

## Errors

- `E_NPC_INPUT`: an API request or restore state does not match its schema.
- `E_NPC_OUTPUT`: an actor or save result does not match its schema.
- `E_NPC_UNKNOWN`: the simulation does not hold that instanced npcId.
- `E_NPC_UNAVAILABLE`: the NPC is dead or unavailable.
- `E_NPC_PLACE`: the NPC's current scheduled state has no position, including a route without a matching passenger leg or complete Connections path3 and timing facts.
- `E_NPC_PATH`: the player or scheduled destination is unreachable.
- `E_NPC_CONFLICT`: another NPC is the companion, in conversation or posed, or a release does not match the controlled identity.

## Dependencies

- Simulation 0.11 public NPC, crowd and continuity APIs: crowd samples name established people with their own seed, and a crowd instantiate takes the seed a body is drawn with.
- Connections walk graph and transit route output.
- [Ground](../ground/CONTRACT.md) for the shared raised-pavement datum.
- Character asset catalog for the audited animation clips.

## Invariants

- Named, focused and quest NPCs are keyed only by their actual npcId. A later statistical crowd handle cannot rename one or take its body.
- Inside a building a person on duty stands at the interior's counter anchors (`counter_spot`) first, then its work spots, a guest sits on its seats, and the overflow stands in the lobby; a spot a cast body holds is never handed to the rota.
- Interior headings are +Y yaw in degrees, zero toward +Z. Seat rendering resolves the exact furniture placement instead of the navigation approach beside it, compensates the purchased sitting clip's 0.34 m rearward pelvis offset and fits the shared chair, sofa, stool and bench support planes at their published scales. Seated conversations retain the furniture heading when the player moves around the chair.
- One npcId owns one rendered body. Resolving a cast worker already present at a parcel post converts that body to continuity control without adding another body.
- A measured physics impact freezes the exact rendered identity and removes it from interaction and pushback. A rejected impact restores its prior control state. Accepted dynamic body assembly belongs to the game physics contract.
- Appearance comes from the instance's persistent `appearanceSeed`, including after unload, save restore and reappearance. A body wears the mesh its gender picks, and a body of unknown gender carries the gender of its mesh.
- A body keeps its mesh, skin, clothes, sleeves, hems, hair and eyebrows while anybody looks at it. A body handed a later handle keeps the look it walks in; naming it offers that seed to the simulation, which establishes the person in it. An established person's sample is drawn in that person's own look, and never re-dresses an anonymous body in another one.
- Source geometry, skin weights, UVs and authored normals remain intact. Baked normals interpolate across each triangle on WebGPU and WebGL.
- Pro clips transfer rotations and scaled pelvis motion onto the body's original bone lengths. Crowd, focused dialogue and impact poses use the same transferred clips and the same body and hairstyle. The focused and fallen rigs wear the crowd body's variant, its painted outfit, its hair tint on the hairstyle and the eyebrows, and the crowd's surface (roughness 0.78, metalness 0, no normal or roughness map); a resident focused rig wears a new look as soon as its person has one. A focused shape is read once for the run with its maps downscaled to the tier's texture size, wears a dressed material its model keeps and hands back, and `HeroCharacter.prepare(onProgress)` reads and warms both shapes at load, so a conversation or a fall uploads and links nothing.
- Scheduled and follow movement samples only Connections `path3`; flat compatibility paths never position a body.
- Walkers of one reported group stand at least 1.2 m apart along their lane, keep their own side of it through turns, and come no nearer than 0.6 m to another body, at spawn and walking. A group its segment cannot hold carries on to the next one. Each walks at its own pace between 0.9 and 1.3 m/s, on its own footfall.
- A car eases down for anybody in its lane within 8 m, standing, walking or lying, and holds 1.5 m short. Only somebody who steps in inside its braking distance is hit.
- A fall ends when the body stops moving, or after six seconds. The person then stands up and walks on from where they came to rest, or, where the simulation has buried them, leaves the crowd and is one of that pavement's numbers again.
- Sampled crowd walkers add Ground's `SIDEWALK_HEIGHT` to sidewalk and access grade. Station stairs blend this offset by authored height to 0.02 m clearance at the lower landing; passages, platforms, crossings and links retain that clearance. The blend is independent of travel direction. Explicit continuity positions are used as published.
- Scheduled passenger transit uses the routine's exact route, board stop, alight stop and progress. Ordered duplicate stops select the shortest forward portion of the route shape, so return legs keep their direction and heading.
- Follow speed is bounded and its stopping distance is deterministic. Explicit stop does not teleport the visible actor to its schedule, and starting control does not teleport a visible body to its schedule.
- Lead speed and pacing depend only on the saved route, the player position, the simulation time and the pace. Passenger carry requires the exact active follower, route id and a successful non-fallen body projection.
- Idle, walk, sprint and seated states select the corresponding audited clip. Crouch is selected only for an explicit crouch action.
- Explicit crouch is cast and npcId controlled. Player C input, proximity, movement speed, dialogue, and quest step kind cannot start it.
- An interior waiter, barista or vendor keeps the simulation type chosen for that post. The engine does not reinterpret an interior role as an unrelated type.

## Boundary behavior

- The gameplay animation coordinator owns speaking and listening gestures. This controller publishes the exact identity, posture, follow mode, and routine resume state it consumes. A waiting or arrived leader is `idle`, turned toward the player.
- Simulation route workers publish a route workplace but no trip assignment. They fail closed because no authoritative vehicle position or route progress exists; passenger commute legs carry the required transit assignment.

## Dialogue ownership

A statistical sample carrying an established `npcId` reuses the canonical named body. A sampled handle already owned by a quest/continuity actor cannot spawn another anonymous copy; later identity resolution also merges a pre-existing alias. Stress copies never inherit persistent identity: they carry no handle and a look of their own, and a copy or a retiring body is talked to as nobody. During dialogue, continuity owns position and the animation director keeps the standing/seated posture, speaking and listening clips while rejecting schedule locomotion. Ending a conversation releases the interruption or retains the next quest appointment. The host closes a restored conversation when its UI was not restored.

## Conversation placement and scheduled posts

The clicked body supplies position, facing, parcel and seated posture before handle identification. If it resolves to an older canonical body, that same canonical object adopts the clicked placement rather than moving the conversation across the city. Active escorts and explicitly controlled aliases cannot be relocated this way.

A stationary parcel conversation may carry `post:{heading,spot?}` in its start request. Continuity preserves the visible position and idle/sit posture in optional saved `posts` records keyed by npcId and the absolute schedule occurrence (entry index, start/end and schedule place). Closing resumes Simulation, but the worker or visitor stays at that post while the occurrence is unchanged. A real schedule transition expires the placement; it is separate from quest holds and follow ownership. Optional actor `spot` restores the exact Crowd reservation after streaming, and is cleared on physical relocation.

Legacy saved conversations without a post may have no usable return path from their actual interior position. Closing such a parcel conversation keeps that visible position for the current schedule occurrence instead of throwing, leaving stale conversation control, or deleting the person on the next frame.

Room-fill sampling binds the currently drawn mesh’s channel per object, so a cached focused model never retains the disposed channel from warm-up or a previous person. Channel replacement and growth update both the sampled texture and its texel dimensions.
