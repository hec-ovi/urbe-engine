# CONTRACT: quest scenery

Purpose: stands what a quest leaves in the world (a body on a floor, blood beside it, an evidence case, a person kneeling or grieving) while the quest's conditions call for it, in a place measured from what the world publishes, and saves which scenes stand.

## Inputs

- Scene specs: [schema/scene-specs.schema.json](schema/scene-specs.schema.json), each a [scene spec](schema/scene-spec.schema.json) with the shared [values](schema/values.schema.json). A game reads them from its quest bundle's `scenery.json` (bundle 1.2); a direct preview reads `quests/scenery.json` beside its questlines. Quests builds them against this schema and against the capabilities below.
  - `place`: `room` (a floor's room by `roomId`, or the seed's pick among `roomKinds`), `story-slot` (the same, among rooms where Interior reserved a story slot; that slot is where the scene gathers), `parcel-entry` (the ground-floor room the parcel's main entrance opens into) or `street` (the sidewalk in front of the parcel's access point: `width` along the lot line and `depth` from it toward the curb, 6 by 3 m unless the spec says otherwise). Every kind but `street` needs the parcel's furnished interior.
  - `actors`, at most 4: a `role`, an `identity`, a `pose` from [poses.json](poses.json) and a placement hint. A pose's footprint and height are the bounds of the posed Source bodies, both genders, measured in the browser. A `cast` identity names a quest role and only holds a corpse pose (`death-a`, `death-b`); everybody alive is `anonymous`, a gender and an appearance seed.
  - `props`, at most 16: `blood-pool` and `tyre-marks` decals of the loaded theme, at their published size unless `size` says otherwise, and `mission-asset` props that name an asset the bundle builds. `nearActorId` or `nearPropId` places a prop beside an actor or a mission asset; a mission asset takes a `zone`.
  - `lighting` is only `{ preset: 'none' }`. Lighting presets are phase 3 of the scene design: a preset lights its scene through the light box's fixed pools as at most 2 published fixtures, and the engine declares none until they stand.
  - `activeWhen` and `retireWhen` are conditions over the scene's questline: `stepActive`, `stepDone`, `flagSet`, `flagNotSet`, `roleDead`, `questStarted` (a step done or an ending reached), `questEnded`, `never`, combined by `all`, `any` and `not`. `retireWhen` defaults to `questEnded`; `never` keeps a scene as lasting world state.
  - `investigationSceneId` names the 1.2 investigation scene that shows its evidence on this scene's elements, and that investigation links this scene back. The bundle and the director refuse a link either side leaves out.
- Saved lifecycles: [schema/saved-scenery.schema.json](schema/saved-scenery.schema.json), one [scene state](schema/scene-state.schema.json) per scene: its status, the minutes it staged and retired, and while staged the resolved place and people.
- `SceneryDirector.create({ specs, session, sim, world, missionAssets, interiors, overlay, animation, saved, theme, ...renderer })`: the QuestSession, the simulation (`getNPC`), `world` as `{ buildings, doors, atlas, obstacles }` (the building sources, the main entrances, the Atlas plan, and the solid fixtures the game stands on the street as `[{ footprint, bottom, top }]`, the shape street dressing reserves: lamp posts, street features, props and trees), the bundle's mission assets (`get(assetId)`), the interior stream (`floorShown`), the investigation gameplay as `overlay`, the Pro animation library, the saved states and the Materials theme. It builds its renderer from `poser`, `materialFactory`, `physics`, `playerCollider`, `lighting` and `warmup`, or takes `renderer`.
- `update({ timeMin, feet }, delta)` every frame; `refresh(timeMin)` after a quest moves.

## Outputs

- `group`: the scenes standing around the player.
- `serialize()`: [saved scenery](schema/saved-scenery.schema.json), every spec's state in scene id order, then any saved state no spec names, unchanged.
- `isStaged(sceneId)`, `sceneFor(sceneId)` (spec, status, failure code, resolution, staging request and [staging assembly](schema/staging-assembly.schema.json)) and `stagedPlaces()` (`{ sceneId, questId, purpose, place, notes }` of every scene standing, for a companion to lead to). `notes` are plain sentences from [notes.md](notes.md), one for the scene's purpose, then one for each body, prop and decal in spec order that an overlay has not taken out; they say what shows there, never who someone is or what happened.
- [capabilities.json](capabilities.json), valid against [schema/capabilities.schema.json](schema/capabilities.schema.json): the place kinds, poses, prop kinds, lighting presets and limits the engine stages. It is what the engine declares to Quests as `hostCapabilities.scenery`.
- `StagingAssembler.js`: the placement geometry investigation scenes and scenery share (`validateStaging`, `placeEntities`, `placeDecals`, `reachableApproaches`, `publicEntity`).

## Events

- A scene is `dormant` until its `activeWhen` holds, then `staged`, then `retired` once its `retireWhen` holds; a dormant scene whose `retireWhen` already holds retires without standing. Conditions are read at the first update, every 0.5 s after it, and at once on `refresh(timeMin)`, so a save made right after a quest moves holds that move's transitions.
- Staging takes each cast corpse from the quest cast, and the simulation must report that person dead. It resolves the place and compiles the spec into a staging assembly: the people as the audited Source body of their gender in their crowd look (`dressed-appearance`), mission assets as built, decals on the frame's floor, every element placed by the shared staging geometry. An investigation standing over the scene proves its own evidence reachable when it stages.
- A staged scene stands while the player is within 120 m of its frame (it goes past 140 m) and, indoors, while its floor is shown. Standing builds its bodies through CharacterPoser, its mission-asset primitives and decals with resolved materials, warms them, and adds one box collider for each body and fixed prop. Going, retiring or failing removes every visual and collider and hands the bodies back to the poser.
- Restoring a staged scene resolves its saved place again and compiles it with its saved people, so it stands with the same transforms whoever the cast names now.
- Investigation scenes stage through the same lifecycle: a 1.2 scene stages with its linked scenery scene (the director hands it the staging request and that scene's visuals) and retires with it; a 1.1 scene stages once any of its bound steps is active or done and retires when its questline ends. Their state is the investigation layer's own.

## Errors

- `E_SCENERY_INPUT`: a spec list, a saved list or the capabilities do not match their schema, a spec repeats an element id, or the notes document lacks the sentence of a purpose, pose, decal kind or mission asset family, or names a key that is none of them.
- `E_SCENERY_OUTPUT`: a staging assembly or saved list does not match its schema.
- `E_SCENERY_BINDING`: a spec names a quest, step, flag, role, mission asset or element that is not there, or a link that does not agree.
- `E_SCENERY_PLACE`: the place names a parcel, interior, floor, room, story slot or entrance the world does not publish.
- `E_SCENERY_NO_FIT`: the room is under 3 by 3 m, the sidewalk in front of the access point has no level pavement of the frame's size, an element cannot be placed, or the frame has no floor for a decal.
- `E_SCENERY_IDENTITY`: a cast corpse is nobody, or is alive.
- `E_SCENERY_ASSET`: the animation library lacks a pose clip, or a body or prop cannot be built.
- `E_SCENERY_MATERIAL`: a decal or mission-asset material key cannot resolve.
- `E_SCENERY_STATE`: a saved scene has no spec, or its saved place cannot stand again.

`SceneryDirector.create` throws the input, binding and asset errors, which are authoring faults. At play every other error fails that scene for the session with a warning naming the scene and code; the game plays on and the save keeps the scene's last good state.

## Dependencies

- [Interior](../../../../interior/CONTRACT.md) floor layouts (rooms, doors, holes, furniture) and NPC placements (story slots), through the building sources, and the [City](../city/CONTRACT.md) floor stream's `floorShown`.
- Atlas parcel lots and access points, sidewalk ground covers, subway entrance bays and highway supports; the main entrances of the loaded shells; the street fixtures the game stands.
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
- A street frame stands on the street side of the lot side the access point is on, its back edge on the lot line and its main door's apron an entry there. It lies whole on sidewalk ground of one height, which is its floor, and every fixture standing in it below 2.2 m over that floor is a blocked zone.
- The same spec, resolution and people give the same staging assembly, byte for byte.
