---
name: quest-scenery
description: Author a quest scene spec (who lies or stands where, what marks the floor, which evidence case sits there) and stage it while the quest calls for it.
triggers:
  - "stage a crime scene"
  - "leave a body for a quest"
  - "author quest scenery"
kind: gameplay-capability
---

# Quest scenery

Read `CONTRACT.md`, `schema/scene-spec.schema.json`, `schema/values.schema.json` and `capabilities.json` before writing a spec.

1. Start from the story: which quest leaves the scene, and after which step. The scene's parcel must be a place that quest already uses, so the parcel's interior is built.
2. Choose the place. A `room` or `story-slot` names a floor and either one `roomId` or a list of `roomKinds`; the seed picks among the rooms of those kinds. Use `parcel-entry` for the room behind the main door and `street` for the sidewalk in front of the parcel's door, `width` along the lot line and `depth` toward the curb. The sidewalk must hold the whole frame: most hold the default 6 by 3 m, and one narrowed by a parking bay holds none.
3. Add at most four actors. A quest character appears only dead: identity `cast` with pose `death-a` or `death-b`, and `activeWhen` must require the step that kills them (`stepDone`) or `roleDead`. Everybody alive is `anonymous` with a gender and an appearance seed, in a living pose.
4. Add props only the story needs: `blood-pool` or `tyre-marks` near an actor, and `mission-asset` props whose `assetId` the bundle requests. Nothing is added for you.
5. Write `activeWhen`. Leave `retireWhen` out to clear the scene when the quest ends, or set it (`never`, a flag) to keep it as world state.
6. For evidence the player inspects on these elements, write a 1.2 investigation request with `scenery.sceneId` and one `evidenceVisuals` entry per evidence, and set this spec's `investigationSceneId` to it. Both links are required.
7. Load the specs through `SceneryDirector.create`. Treat `E_SCENERY_BINDING` and `E_SCENERY_INPUT` as authoring faults, and `E_SCENERY_NO_FIT` as a room or sidewalk too small or too full for what the spec asks.

Run `npx vitest run src/game/scenery src/game/investigation` after a change.
