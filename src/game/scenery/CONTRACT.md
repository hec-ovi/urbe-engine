# CONTRACT: quest scenery

Purpose: stands what a quest leaves in the world (a body on a floor, blood beside it, an evidence case, a person kneeling or grieving) while the quest's conditions call for it, in a place measured from what the world publishes, and saves which scenes stand.

## Inputs

- Scene specs: [schema/scene-specs.schema.json](schema/scene-specs.schema.json), each a [scene spec](schema/scene-spec.schema.json) with the shared [values](schema/values.schema.json). A game reads them from its quest bundle's `scenery.json` (bundle 1.2); a direct preview reads `quests/scenery.json` beside its questlines. Quests builds them against this schema and against the capabilities below.
  - `place`: `room` (a floor's room by `roomId`, or the seed's pick among `roomKinds`), `story-slot` (the same, among rooms where Interior reserved a story slot; that slot is where the scene gathers), `parcel-entry` (the ground-floor room the parcel's main entrance opens into) or `street` (the sidewalk at the parcel's access point, `width` along it and `depth` across it, 6 by 3 m unless the spec says otherwise). Every kind but `street` needs the parcel's furnished interior.
  - `actors`, at most 4: a `role`, an `identity`, a `pose` from [poses.json](poses.json) and a placement hint. A pose's footprint and height are the bounds of the posed Source bodies, both genders, measured in the browser. A `cast` identity names a quest role and only holds a corpse pose (`death-a`, `death-b`); everybody alive is `anonymous`, a gender and an appearance seed.
  - `props`, at most 16: `blood-pool` and `tyre-marks` decals of the loaded theme, at their published size unless `size` says otherwise, and `mission-asset` props that name an asset the bundle builds. `nearActorId` or `nearPropId` places a prop beside an actor or a mission asset; a mission asset takes a `zone`.
  - `lighting` is only `{ preset: 'none' }`.
  - `activeWhen` and `retireWhen` are conditions over the scene's questline: `stepActive`, `stepDone`, `flagSet`, `flagNotSet`, `roleDead`, `questStarted` (a step done or an ending reached), `questEnded`, `never`, combined by `all`, `any` and `not`. `retireWhen` defaults to `questEnded`; `never` keeps a scene as lasting world state.
  - `investigationSceneId` names the 1.2 investigation scene that shows its evidence on this scene's elements, and that investigation links this scene back. The bundle and the director refuse a link either side leaves out.
- Saved lifecycles: [schema/saved-scenery.schema.json](schema/saved-scenery.schema.json), one [scene state](schema/scene-state.schema.json) per scene: its status, the minutes it staged and retired, and while staged the resolved place and people.
- `SceneryDirector.create({ specs, session, sim, world, missionAssets, interiors, overlay, animation, saved, theme, ...renderer })`: the QuestSession, the simulation (`getNPC`), `world` as `{ buildings, doors, atlas }` (the building sources, the main entrances, the Atlas plan), the bundle's mission assets (`get(assetId)`), the interior stream (`floorShown`), the investigation gameplay as `overlay`, the Pro animation library, the saved states and the Materials theme. It builds its renderer from `poser`, `materialFactory`, `physics`, `playerCollider`, `lighting` and `warmup`, or takes `renderer`.
- `update({ timeMin, feet }, delta)` every frame; `refresh()` after a quest moves.

## Outputs

- `group`: the scenes standing around the player.
- `serialize()`: [saved scenery](schema/saved-scenery.schema.json), every spec's state in scene id order, then any saved state no spec names, unchanged.
- `isStaged(sceneId)`, `sceneFor(sceneId)` (spec, status, failure code, resolution, staging request and [staging assembly](schema/staging-assembly.schema.json)) and `stagedPlaces()` (`{ sceneId, questId, purpose, place }` of every scene standing, for a companion to lead to).
- [capabilities.json](capabilities.json), valid against [schema/capabilities.schema.json](schema/capabilities.schema.json): the place kinds, poses, prop kinds, lighting presets and limits the engine stages. It is what the engine declares to Quests as `hostCapabilities.scenery`.
- `StagingAssembler.js`: the placement geometry investigation scenes and scenery share (`validateStaging`, `placeEntities`, `placeDecals`, `reachableApproaches`, `publicEntity`).

## Events

- A scene is `dormant` until its `activeWhen` holds, then `staged`, then `retired` once its `retireWhen` holds; a dormant scene whose `retireWhen` already holds retires without standing. Conditions are read every 0.5 s and at the update after `refresh()`.
- Staging takes each cast corpse from the quest cast, and the simulation must report that person dead. It resolves the place and compiles the spec into a staging assembly: the people as the audited Source body of their gender in their crowd look (`dressed-appearance`), mission assets as built, decals on the frame's floor, every element placed by the shared staging geometry, and the point within 2.25 m from which the player reaches each element an entrance leads to. An investigation standing over the scene proves its own evidence reachable when it stages.
- A staged scene stands while the player is within 120 m of its frame (it goes past 140 m) and, indoors, while its floor is shown. Standing builds its bodies through CharacterPoser, its mission-asset primitives and decals with resolved materials, warms them, and adds one box collider for each body and fixed prop. Going, retiring or failing removes every visual and collider and hands the bodies back to the poser.
- Restoring a staged scene resolves its saved place again and compiles it with its saved people, so it stands with the same transforms whoever the cast names now.
- Investigation scenes stage through the same lifecycle: a 1.2 scene stages with its linked scenery scene (the director hands it the staging request and that scene's visuals) and retires with it; a 1.1 scene stages once any of its bound steps is active or done and retires when its questline ends. Their state is the investigation layer's own.

## Errors

- `E_SCENERY_INPUT`: a spec list, a saved list or the capabilities do not match their schema, or a spec repeats an element id.
- `E_SCENERY_OUTPUT`: a staging assembly or saved list does not match its schema.
- `E_SCENERY_BINDING`: a spec names a quest, step, flag, role, mission asset or element that is not there, or a link that does not agree.
- `E_SCENERY_PLACE`: the place names a parcel, interior, floor, room, story slot or entrance the world does not publish.
- `E_SCENERY_NO_FIT`: the room is under 3 by 3 m, an element cannot be placed, or the frame has no floor for a decal.
- `E_SCENERY_IDENTITY`: a cast corpse is nobody, or is alive.
- `E_SCENERY_ASSET`: the animation library lacks a pose clip, or a body or prop cannot be built.
- `E_SCENERY_MATERIAL`: a decal or mission-asset material key cannot resolve.
- `E_SCENERY_STATE`: a saved scene has no spec, or its saved place cannot stand again.

`SceneryDirector.create` throws the input, binding and asset errors, which are authoring faults. At play every other error fails that scene for the session with a warning naming the scene and code; the game plays on and the save keeps the scene's last good state.

## Dependencies

- [Interior](../../../../interior/CONTRACT.md) floor layouts (rooms, doors, holes, furniture) and NPC placements (story slots), through the building sources, and the [City](../city/CONTRACT.md) floor stream's `floorShown`.
- Atlas parcels and access points, and the main entrances of the loaded shells.
- [Investigation](../investigation/CONTRACT.md) values for placement shapes, and its gameplay as the overlay.
- [Mission assets](../../mission-assets/CONTRACT.md) assemblies, by id.
- [Agents](../agents/CONTRACT.md) CharacterPoser for the bodies, [Light](../light/CONTRACT.md) ActorLighting, [Look](../look/CONTRACT.md) Warmup and [Physics](../physics/CONTRACT.md).
- Materials incident decals: `<theme>/incident-blood/mid#directional-pool` and `<theme>/incident-tyre/poor#directional-transfer`; the cyberpunk theme publishes both.

## Invariants

- Every body, decal and prop comes from the spec. Seeds only choose among the rooms a place allows, positions and quarter turns.
- Transitions only go forward and are saved: a flag that toggles never makes a scene come and go, and a retired scene never stands again.
- One npcId owns one rendered body: a cast person stands in a scene only as a corpse the simulation holds dead, whom the crowd does not draw.
- A still body is the crowd person its gender and seed give (the same body, hairstyle, look and transferred clip), never scaled; it turns a quarter onto its footprint's long side and rests its lowest point on the floor.
- A room frame is the largest rectangle inside the room's outline in the room's own orientation, 0.15 m off the walls; its doors are entries, its furniture and holes blocked zones and blocked floor. Upper floors stand at the building floor's elevation, where the floor stream draws their layout.
- The same spec, resolution and people give the same staging assembly, byte for byte.
