# CONTRACT: playable quest actions

Purpose: converts active quest steps into deterministic player interaction targets and applies validated interactions to one selected questline.

## Inputs

- Target query: [schema/target-query.schema.json](schema/target-query.schema.json). `timeMin` uses the simulation clock.
- Interaction request: [schema/interaction-request.schema.json](schema/interaction-request.schema.json). The host supplies the selected target, symbolic input action, current places, and physical focus facts when the mechanic targets an item or person.
- Objective query: [schema/target-query.schema.json](schema/target-query.schema.json). The same clock query selects the first open quest and definition-ordered step for map guidance.
- Live world projection: [schema/gameplay-world.schema.json](schema/gameplay-world.schema.json). The assembled city publishes one deterministic entry or access anchor per parcel.
- Live interaction frame: [schema/gameplay-frame.schema.json](schema/gameplay-frame.schema.json). The host supplies validated clock, place and camera facts.
- Live selected binding: [schema/gameplay-perform.schema.json](schema/gameplay-perform.schema.json). The shared interactor returns only the selected target key, symbolic binding and current clock.
- NPC control request: [schema/npc-control-request.schema.json](schema/npc-control-request.schema.json). An explicit start-follow, release-follow, start-crouch, or release-crouch event names one actual cast npcId, current clock and player position.
- Measured mechanic completion: [schema/mechanic-request.schema.json](schema/mechanic-request.schema.json). A live subsystem selects one active quest and step and supplies the exact quests event for a kill, release, escort arrival, access, hack, sabotage or completed journey. GameApp supplies the current simulation clock.
- Mission asset requests, item bindings and fixed mechanic bindings arrive only through the validated [quest bundle](../../quest-bundle/CONTRACT.md). The loaded Materials theme is projected to the mission-assets material catalog without changing its keys, aliases, or variant ids.

## Outputs

- Interaction targets: [schema/interaction-targets.schema.json](schema/interaction-targets.schema.json). Every target has a stable quest and step identity, map place, actual cast NPC ids, availability, and presentation instructions. Binding names stay symbolic so the UI renders the player's current key or controller binding.
- Measured mechanic targets: [schema/mechanic-targets.schema.json](schema/mechanic-targets.schema.json). Every active assassination, rescue, escort, access, hacking, sabotage and transportation step retains its quest and step identity, exact authored target, current place, availability and resolved cast ids.
- Interaction result: [schema/interaction-result.schema.json](schema/interaction-result.schema.json). Success and failure both return current quest inventory. A completed pickup, theft, or delivery includes the matching world state change.
- Active objective: [schema/active-objective.schema.json](schema/active-objective.schema.json). Includes talk and goto steps as well as direct actions, and carries the runtime's exact current place plus its route-ready guidance result. Parcel, station and stop places carry a destination. Areas, edges, moving routes and unavailable targets carry a closed reason.
- Live interaction candidates: [schema/gameplay-candidates.schema.json](schema/gameplay-candidates.schema.json). Carries only validated prompt data and stable target identity to the shared interactor. Measured focus facts remain private until the matching target is selected.
- NPC control result: [schema/npc-control-result.schema.json](schema/npc-control-result.schema.json). Success reports following, posing, or schedule-return mode; failure uses the closed `not_cast`, `unavailable`, `unreachable` or `conflict` set.
- Measured mechanic result: [schema/mechanic-result.schema.json](schema/mechanic-result.schema.json). Returns the selected step, accepted event kind, current inventory and complete quest presentation. Failures use `unknown_target`, `wrong_event` or `runtime_rejected` without mutating state.

## Events

- `targets({ timeMin })` projects active `pickup`, `observe`, `listen`, `steal`, `work`, and `deliver` steps.
- `mechanics({ timeMin })` projects all seven measured target kinds with the exact facts that build their closed runtime event.
- `perform(request)` maps `take`, `inspect`, `listen`, `steal`, `work`, and `deliver` to the quests runtime's closed player event vocabulary. `read` returns the selected document text without advancing the quest.
- `objective({ timeMin })` selects the first open questline and first definition-ordered active step. The live game passes its exact guidance destination to the objective route box.
- `QuestGameplay.candidates(frame)` projects those validated targets into the shared centered interaction route. `QuestGameplay.perform(request)` resolves the current selected target and sends its measured place, visibility, obstruction and reach facts through `QuestActions.perform`.
- A pickup is projected only when its exact quest and item binding creates a portable mission-assets assembly with a `take` anchor. Rescue, access, hacking and sabotage use the exact fixed asset and interaction anchor from their v1.1 binding. Every assembly primitive uses its authored PBR key and variant and has matching Rapier collision.
- An accepted `QuestGameplay.perform(request)` sends its stable target key, exact action, and retained cast participants to the gameplay animation coordinator. Rejected actions never start presentation state.
- `QuestGameplay.control(request)` accepts only an explicit event for an npcId already in the session cast. Conversation, player crouch input, and quest-step kinds never imply follow or crouch. An accepted pose event is sent to animation coordination with the exact returned actor state.
- Fixed asset interaction flows through `QuestGameplay.perform`. Rescue acquires follow control for the exact cast NPC before quest progress; unavailable or conflicting control returns `runtime_rejected`, and a later runtime rejection releases newly acquired control to its routine. Escort starts the authored follow or lead mode at its exact source and completes only when the controlled body and player reach the destination, then resumes the NPC routine.
- Active assassination and public-transit steps materialize an absent exact cast body at its current or authored place without publishing an interaction. `QuestGameplay.fatalImpact(impact, npcId, timeMin)` consumes only a fatal Rapier vehicle contact after GameApp resolves the accepted Source body to its authored npcId. `QuestGameplay.transitEvent` requires the exact passenger at the origin before boarding, carries that identity at every measured ride position, verifies trip, destination and cargo, then releases it after disembark. GameApp sends every accepted result through the shared HUD, inventory, persistence and route path.
- `QuestMechanics.complete(request)` remains the closed runtime adapter behind those live hosts. The quests runtime checks every authored NPC, route, access point, credential, target, journey, passenger, cargo, mode and place identity.

## Errors

- `E_QUEST_ACTION_INPUT`: an input does not match its schema.
- `E_QUEST_ACTION_OUTPUT`: an output does not match its schema.
- Result codes are `unknown_target`, `wrong_action`, `unavailable`, `wrong_place`, `not_visible`, `occluded`, `out_of_reach`, and `runtime_rejected`.
- NPC control result codes are `not_cast`, `unavailable`, `unreachable`, and `conflict`.
- Mechanic result codes are `unknown_target`, `wrong_event`, and `runtime_rejected`.

## Dependencies

- `quests/flow`, through its contract and questline schema.
- `game/quests/QuestSession`, inside this layer only.
- The game's crowd, physics query and PBR material factory for live target bodies and measured focus facts.
- [Mission assets](../../mission-assets/CONTRACT.md) for exact item geometry, collision, interaction anchors and material assignments.
- The quest animation coordination contract for accepted action presentation.

## Invariants

- An interaction advances only the questline named by the selected target. Equal item ids in another questline do not receive the event.
- A measured mechanic event advances only its selected active quest and step. A different event kind or any mismatched authored identity changes nothing.
- Public transit completion requires the exact active origin, one or zero cast passengers, every cargo item, the tracked trip and route, and the exact authored destination. A wrong trip or stop changes nothing.
- Escort completion requires the exact controlled identity. Follow mode keeps the NPC within 3.2 metres at arrival. Lead mode reaches its Connections destination before the player arrival is accepted.
- Pickup and theft require the selected object or person to be visible, unobstructed, inside the fixed reach, and at the quest target's current place.
- Listening requires an unobstructed conversation target inside eight metres and at the target parcel.
- A failed interaction does not mutate quest progress or inventory.
- A failed interaction does not alter the active animation action.
- A completed pickup step produces no active target.
- Highlight and icon data identify the same item, cast NPCs, and step consumed by the action.
- A live pickup prop has the stable `targetKey`, the bound assembly's exact geometry and materials, separate outline and icon cues, and one fixed collider per primitive. Ray focus excludes only its own colliders. The visual and collision leave only when the accepted result includes its `collected` world change.
- Cast-person mechanics resolve the exact `actorIds`. An absent active assassination target or transit passenger receives one deterministic rendered quest body, within the crowd capacity, at its current or authored place. Passive materialization adds no interaction target.
- Follow control resolves only the requested cast npcId and never substitutes a nearby statistical handle.
- Crouch control resolves only the requested cast npcId, holds it until its matching release, and resumes its persisted simulation routine.
- Parcel area mechanics are offered only at their deterministic entry or interior anchor. District observation remains an area action throughout the named district.
- Quest item data currently publishes a parcel but no room or transform. The live layer places the exact bound assembly at the parcel's ground-floor interior entry anchor, or its published access point when no interior door exists. An absent binding, fixed assembly, missing `take` anchor or unresolved material produces no pickup. Observe data publishes only a district, so the layer does not invent individual evidence clues.

## How to modify this blackbox safely

Keep action mapping closed and deterministic. Add a runtime event before advertising its mechanic here. Update every affected schema and run the quest action tests plus the full engine suite.
