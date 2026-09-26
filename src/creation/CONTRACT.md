# CONTRACT: playable world creation

## Purpose

Builds cities and saved games, with optional interiors and quests. Creation asks no model: names and stories come from authors outside the engine, through the Naming and Quests pipelines, and creation builds and checks what they wrote.

## Inputs

- `createWorldCreation(config, ports?)`: [schema/config.schema.json](schema/config.schema.json). `themesDir` is the Materials themes directory. Ports: `run`, `clock`, `library` and `preflight` replace the process runner, the clock, the catalog and the scenery check.
- `planCity(input)` and `generateCity(input)`: [schema/generate-city.schema.json](schema/generate-city.schema.json). Optional `districtCount`, `[min, max]` from 1 to 12 with min <= max, is Atlas's own district range, handed to it unchanged as `--district-count min,max`. Omitted, Atlas scales the range with the city's area as it always has. A minimum the size cannot hold (Atlas needs 300 x 300 m a district, so small takes at most 2) fails in Atlas, `E_COMMAND_FAILED`. Optional `features` turns Atlas features off: `highways`, `subways` or `alleys` false is `--no-<feature>`. An omitted toggle, or true, keeps Atlas's default, on: Atlas plans an elevated highway at every size, Small included.
- `buildCity(input)`: [schema/build-city.schema.json](schema/build-city.schema.json). Optional `named` is the plan as an author named it: `blueprint`, the Naming box's named blueprint, and `types`, its NPC types.
- `generateInstances(input)`: [schema/generate-instances.schema.json](schema/generate-instances.schema.json).
- `generateQuests(input)`: [schema/generate-quests.schema.json](schema/generate-quests.schema.json).
- `importStory(input)`: [schema/import-story.schema.json](schema/import-story.schema.json). `recording` is a Quests recording directory holding `recording.json`: a bare recording, or the out dir of a Quests author run (`npm run author --external`), which also holds its `meta.json`.
- `createGame(input)`: [schema/create-game.schema.json](schema/create-game.schema.json).
- Paths in `named` and `recording` resolve against the engine checkout (`engineRoot`) and are read as the engine process sees them; `../quests/creation/samples/urbe-small` is the recorded story in both a native and a Compose engine.
- `check(method, input)` checks one stage's input against its schema without running it.
- Every stage but `createGame` also takes `{ progress }`, told each non-empty line its commands print as it prints it.

## Outputs

- `planCity`: [schema/plan-result.schema.json](schema/plan-result.schema.json), also written as `out/plans/<id>/plan.json` beside the plan `blueprint.json`. It records the `districtCount` and `features` asked for, when they were.
- `buildCity` and `generateCity`: [schema/city-result.schema.json](schema/city-result.schema.json).
- `generateInstances`: [schema/instances-result.schema.json](schema/instances-result.schema.json).
- `generateQuests` and `importStory`: [schema/quests-result.schema.json](schema/quests-result.schema.json).
- `createGame`: [schema/game-result.schema.json](schema/game-result.schema.json).
- `PLAYABLE_MECHANICS`: the step kinds a story may use, the ones the game plays whole: goto, observe, talk, listen, pickup, deliver, steal, work, investigation and escort. Assassination is left out because its only lethal path is traffic the player does not drive; rescue, access, hacking and sabotage because creation binds no fixed targets for them; transportation because a journey needs a transit line the story cannot see.
- `HOST_CAPABILITIES`: what the game declares to Quests beside every bundle it replays: `transportationModes: ['public-transit']` and `scenery`, the engine's [scenery capabilities](../game/scenery/capabilities.json).

## Events

None. Each promise settles only after its artifact is complete and validated.

## Errors

Closed set in [schema/creation-error.schema.json](schema/creation-error.schema.json): `E_INVALID_REQUEST`, `E_EXISTS`, `E_PLAN_NOT_FOUND`, `E_CITY_NOT_FOUND`, `E_DRAFT_NOT_FOUND`, `E_STAGE_MISMATCH`, `E_STORY_BRIEF_UNAVAILABLE` (a non-empty `mainBrief`), `E_SIDE_JOB_LIMIT`, `E_QUEST_LOCATIONS`, `E_COMMAND_FAILED` (a command's last 40 lines of output), `E_OUTPUT_INVALID`, `E_STORAGE`.

## Dependencies

- Atlas CLI through `../../../atlas/CONTRACT.md`; planning invokes `npm run generate -- ...` against the prepared read-only sibling box.
- Named blueprints and NPC types as `../../../naming/CONTRACT.md` writes them; creation runs nothing of Naming.
- Assembly CLI through `../assembly/CONTRACT.md`.
- Quests replay through `../../../quests/creation/CONTRACT.md` (`npm run materialize`) and its complete [engine handoff](../../../quests/handoff/CONTRACT.md).
- Quest bundle validation and selection through `../quest-bundle/CONTRACT.md`.
- Scene places and staging through `../game/scenery/CONTRACT.md`, building sources through `../game/data`, mission assets through `../mission-assets/CONTRACT.md` and the Materials theme index.
- City and game persistence through `../library/CONTRACT.md`.

## Invariants

- `out/plans/<id>` is a plan waiting for its build. `out/cities/<id>` is a shell-only city. `out/drafts/<id>` is the replaceable creation draft. `out/games/<id>` is the final self-contained game.
- Small is 500 m, medium is 1000 m, large (shown as Big) is 3000 m. The launcher city field defaults to large. Atlas receives the user's seed, so the same size, seed, district range and features plan the same geometry. A plan must record the district range and each feature toggle asked for in its `meta.params`; one that does not (an Atlas that does not know the flag) is `E_OUTPUT_INVALID` and nothing is published. Profiles live in [city-templates.json](city-templates.json).
- City creation requires only size. Omitted names and seeds receive fresh identities; explicit names and seeds remain supported. A plan's id is its city's id, and neither a plan nor a city may already hold it: `planCity` and `generateCity` refuse a taken id with `E_EXISTS`.
- `generateCity` plans and builds in one stage, unnamed. `planCity` stops after Atlas: its descriptor carries the plan's statistics and binds the plan's bytes by checksum, so an author can name the plan (the Naming box reads `blueprint.json` and writes `blueprint.named.json` and `npc-types.json`, beside it or anywhere) before `buildCity` builds it.
- `buildCity` refuses a plan whose `blueprint.json` does not match its checksum. Unnamed, it builds the plan's bytes. Named, the blueprint must record `meta.naming.theme` and be the plan with names: equal to it once every `name` and `meta.naming` are left out of both. The assembler takes the named blueprint as the author wrote it, with the NPC types beside it, and binds the world's hashes to it, so the world never binds the unnamed plan; its manifest is `named` with `namingTheme` that theme, and it carries `npc-types.json`. Once its city stands the plan leaves `out/plans`: whatever an author wrote beside `plan.json` and `blueprint.json` (the Naming CLI's outputs and author dir, when named in place) moves into the city as `naming/`, which a draft keeps and a game does not ship.
- `createGame` with `questId: null` creates free play. Empty `interiorIds` copies the city directly; selected interiors must match a completed draft. Free play carries no quest files or quest progress. Each new playthrough has its own id.
- Automatic interiors open up to the requested count, in an order handed to the assembler as `--interior-priority`: the `buildingIds` given first, then an unnamed city's recorded story places, or a named city's venue spread. A building Interior cannot furnish is skipped for the next candidate and `count` reports what opened. Fewer than seven opened is `E_QUEST_LOCATIONS`. An unnamed city ranks the places its recorded ten-step main story needs first, then side-job venues, then other venues; seven interiors support that main line, eight support two side jobs, and nine support all three. A named city's spread is its standing buildings, a home first, then one building of each kind that hires, round after round, and it has no story until one is imported. When its first home falls within the count, the next home waits right after the count, so the first building Interior cannot furnish gives its place to a home; a named city with homes whose automatic pick opens none is `E_QUEST_LOCATIONS`. Manual interiors open exactly `buildingIds`.
- The interior stage writes the draft's `quests/handoff-input.json`, `{ hostCapabilities: HOST_CAPABILITIES }`. With the draft's `blueprint.json`, `npc-types.json` and `draft.json` `interiorIds` it is what a story's author records against (Quests' `--world`, `--types`, `--parcels` and `--handoff`).
- `generateQuests` plays the recorded story (`quests/creation/samples/urbe-small`) in an unnamed city, whose draft carries that story's NPC types; a named city is `E_STAGE_MISMATCH`, since its story is written for its own people and comes in through `importStory`. A non-empty `mainBrief` is `E_STORY_BRIEF_UNAVAILABLE`. Its questId is `<cityId>-quests-<side jobs>`.
- `importStory` plays a recording an author wrote outside the engine against the draft's world and NPC types. Its questId is `<cityId>-story-<side jobs>`. A directory with `meta.json` is an author run's: it is a story only when `meta.json` has `bundle`, and its `profile` must be the city size, the profile the replay casts with; otherwise `E_INVALID_REQUEST`.
- Both stories are replayed with `npm run materialize` against the draft's blueprint and NPC types, profile the city size (an author records against the same), `--parcels` the opened interiors and the handoff `HOST_CAPABILITIES`, so every place a story names is a building the player can walk into and a story stages its scenes in bundle 1.2. The draft keeps the handoff as `quests/handoff-input.json`. A side job with nowhere to go is left out with its reason, and a main story with nowhere to go fails naming the kind of building the city is missing.
- A questline with a step outside `PLAYABLE_MECHANICS` cannot be finished: a side job with one is left out, and a main story with one is `E_INVALID_REQUEST` naming the kinds.
- Before selection every scene of the bundle stands in the draft's world, as the game stands it: its place resolves against the opened buildings, their main entrances and the Atlas plan, and its people, mission assets and decals compile in that frame with the same seeds. Street fixtures are placed by the game at load, so a street scene meets them at play. A side job with a scene that cannot stand is left out; a main story with one is `E_QUEST_LOCATIONS` naming the scene and why.
- The quest stage delivers the main line and up to three side jobs, fewer when fewer can play and stand; `sideJobs` in the result is how many it delivered.
- The draft keeps what its story was made from in `story/`: the recording directory's `recording.json`, its `meta.json` and Markdown stages when present, and `left-out.json`, each `{ questId, reason }` creation left out. A story that fails leaves the draft's quests and story as they were.
- A stage writes into a temporary sibling and publishes only after its command and output checks pass.
- A draft is its city cloned by hard links and a game its draft or city cloned the same way (`cloneWorld`, [assembly contract](../assembly/CONTRACT.md)): every writer replaces a file by renaming over it, so they share each file neither changes and one never sees another's writes.
- Quest selection rewrites definitions, objectives, investigations, fixed mechanic bindings, mission item bindings, scenery, referenced mission asset requests and manifest counts together, and writes a 1.2 bundle. It reads 1.1 and 1.2 bundles and preserves the validated host capability object. A final game references `quests/quest-bundle.json`; `naming/`, `story/`, `quests/handoff-input.json`, full authoring metadata and unselected definitions do not ship with it.
