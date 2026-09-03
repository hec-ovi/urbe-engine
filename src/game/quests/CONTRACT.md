# CONTRACT: playable quest actions

Purpose: converts active quest steps into deterministic player interaction targets and applies validated interactions to one selected questline.

## Inputs

- Target query: [schema/target-query.schema.json](schema/target-query.schema.json). `timeMin` uses the simulation clock.
- Interaction request: [schema/interaction-request.schema.json](schema/interaction-request.schema.json). The host supplies the selected target, symbolic input action, current places, and physical focus facts when the mechanic targets an item or person.
- Objective query: [schema/target-query.schema.json](schema/target-query.schema.json). The same clock query selects the first open quest and definition-ordered step for map guidance.
- Live world projection: [schema/gameplay-world.schema.json](schema/gameplay-world.schema.json). The assembled city publishes one deterministic entry or access anchor per parcel.
- Live interaction frame: [schema/gameplay-frame.schema.json](schema/gameplay-frame.schema.json). The host supplies validated clock, place and camera facts.
- Live selected binding: [schema/gameplay-perform.schema.json](schema/gameplay-perform.schema.json). The shared interactor returns only the selected target key, symbolic binding and current clock.
- NPC control request: [schema/npc-control-request.schema.json](schema/npc-control-request.schema.json). An explicit start-follow or release-follow event names one actual cast npcId, current clock and player position.

## Outputs

- Interaction targets: [schema/interaction-targets.schema.json](schema/interaction-targets.schema.json). Every target has a stable quest and step identity, map place, actual cast NPC ids, availability, and presentation instructions. Binding names stay symbolic so the UI renders the player's current key or controller binding.
- Interaction result: [schema/interaction-result.schema.json](schema/interaction-result.schema.json). Success and failure both return current quest inventory. A completed pickup, theft, or delivery includes the matching world state change.
- Active objective: [schema/active-objective.schema.json](schema/active-objective.schema.json). Includes talk and goto steps as well as direct actions, and carries the runtime's exact current place or null.
- Live interaction candidates: [schema/gameplay-candidates.schema.json](schema/gameplay-candidates.schema.json). Carries only validated prompt data and stable target identity to the shared interactor. Measured focus facts remain private until the matching target is selected.
- NPC control result: [schema/npc-control-result.schema.json](schema/npc-control-result.schema.json). Success reports following or schedule-return mode; failure uses the closed `not_cast`, `unavailable`, `unreachable` or `conflict` set.

## Events

- `targets({ timeMin })` projects active `pickup`, `observe`, `listen`, `steal`, `work`, and `deliver` steps.
- `perform(request)` maps `take`, `inspect`, `listen`, `steal`, `work`, and `deliver` to the quests runtime's closed player event vocabulary. `read` returns the selected document text without advancing the quest.
- `objective({ timeMin })` selects the first open questline and first definition-ordered active step for route presentation.
- `QuestGameplay.candidates(frame)` projects those validated targets into the shared centered interaction route. `QuestGameplay.perform(request)` resolves the current selected target and sends its measured place, visibility, obstruction and reach facts through `QuestActions.perform`.
- An accepted `QuestGameplay.perform(request)` sends its stable target key, exact action, and retained cast participants to the gameplay animation coordinator. Rejected actions never start presentation state.
- `QuestGameplay.control(request)` accepts only an explicit event for an npcId already in the session cast. Conversation and quest-step kinds never imply following, and this API does not add an escort quest mechanic.

## Errors

- `E_QUEST_ACTION_INPUT`: an input does not match its schema.
- `E_QUEST_ACTION_OUTPUT`: an output does not match its schema.
- Result codes are `unknown_target`, `wrong_action`, `unavailable`, `wrong_place`, `not_visible`, `occluded`, `out_of_reach`, and `runtime_rejected`.
- NPC control result codes are `not_cast`, `unavailable`, `unreachable`, and `conflict`.

## Dependencies

- `quests/flow`, through its contract and questline schema.
- `game/quests/QuestSession`, inside this layer only.
- The game's crowd, physics query and PBR material factory for live target bodies and measured focus facts.
- The quest animation coordination contract for accepted action presentation.

## Invariants

- An interaction advances only the questline named by the selected target. Equal item ids in another questline do not receive the event.
- Pickup and theft require the selected object or person to be visible, unobstructed, inside the fixed reach, and at the quest target's current place.
- Listening requires an unobstructed conversation target inside eight metres and at the target parcel.
- A failed interaction does not mutate quest progress or inventory.
- A failed interaction does not start or replace an animation action.
- A successful pickup cannot be repeated because its completed step no longer produces an active target.
- Highlight and icon data identify the same item, cast NPCs, and step consumed by the action.
- A live pickup prop has the stable `targetKey`, a database-backed body material, and separate outline and icon cues. It leaves the scene only when the accepted result includes its `collected` world change.
- Cast-person mechanics resolve the exact `actorIds`. A nearby omitted cast NPC may receive one deterministic rendered quest body, within the crowd capacity, at their simulation place.
- Follow control resolves only the requested cast npcId and never substitutes a nearby statistical handle.
- Parcel area mechanics are offered only at their deterministic entry or interior anchor. District observation remains an area action throughout the named district.
- Quest item data currently publishes a parcel but no room, prop, or transform. The live layer uses the parcel's ground-floor interior entry anchor, or its published access point when no interior door exists. Observe data publishes only a district, so the layer does not invent individual evidence clues.

## How to modify this blackbox safely

Keep action mapping closed and deterministic. Add a runtime event before advertising its mechanic here. Update every affected schema and run the quest action tests plus the full engine suite.
