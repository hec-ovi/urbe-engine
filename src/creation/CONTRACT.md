# CONTRACT: playable world creation

## Purpose

Builds template cities and saved games, with optional names, interiors and quests.

## Inputs

- `createWorldCreation(config, ports?)`: [schema/config.schema.json](schema/config.schema.json). `namingRoot` is the Naming box, `themesDir` the Materials themes directory, `model` the OpenAI-compatible model server (`baseUrl`, and `model` when one is named; otherwise the server's first model). Ports: `run`, `clock`, `library` and `preflight` replace the process runner, the clock, the catalog and the scenery check.
- `generateCity(input)`: [schema/generate-city.schema.json](schema/generate-city.schema.json). An optional `theme` (the city's character, up to 400 characters) names the city.
- `generateInstances(input)`: [schema/generate-instances.schema.json](schema/generate-instances.schema.json).
- `generateQuests(input)`: [schema/generate-quests.schema.json](schema/generate-quests.schema.json).
- `createGame(input)`: [schema/create-game.schema.json](schema/create-game.schema.json).
- `check(method, input)` checks one stage's input against its schema without running it.
- Every stage but `createGame` also takes `{ progress }`, told each non-empty line its commands print as it prints it.

## Outputs

- `generateCity`: [schema/city-result.schema.json](schema/city-result.schema.json).
- `generateInstances`: [schema/instances-result.schema.json](schema/instances-result.schema.json).
- `generateQuests`: [schema/quests-result.schema.json](schema/quests-result.schema.json).
- `createGame`: [schema/game-result.schema.json](schema/game-result.schema.json).
- `PLAYABLE_MECHANICS`: the step kinds a written story may use, the ones the game plays whole: goto, observe, talk, listen, pickup, deliver, steal, work, investigation and escort. Assassination is left out because its only lethal path is traffic the player does not drive; rescue, access, hacking and sabotage because creation binds no fixed targets for them; transportation because a journey needs a transit line the story cannot see.
- `HOST_CAPABILITIES`: what the game declares to Quests beside every bundle it has written: `transportationModes: ['public-transit']` and `scenery`, the engine's [scenery capabilities](../game/scenery/capabilities.json).

## Events

None. Each promise settles only after its artifact is complete and validated.

## Errors

Closed set in [schema/creation-error.schema.json](schema/creation-error.schema.json): `E_INVALID_REQUEST`, `E_EXISTS`, `E_CITY_NOT_FOUND`, `E_DRAFT_NOT_FOUND`, `E_STAGE_MISMATCH`, `E_NAMING_UNAVAILABLE` (a theme without the Naming box or the model server), `E_STORY_BRIEF_UNAVAILABLE` (a written story without the model server), `E_SIDE_JOB_LIMIT`, `E_QUEST_LOCATIONS`, `E_COMMAND_FAILED` (a command's last 40 lines of output), `E_OUTPUT_INVALID`, `E_STORAGE`.

## Dependencies

- Atlas CLI through `../../../atlas/CONTRACT.md`; generation invokes `npm run generate -- ...` against the prepared read-only sibling box.
- Naming CLI through `../../../naming/CONTRACT.md`: `npm run world -- <folder> --theme <theme>` in `namingRoot`.
- Assembly CLI through `../assembly/CONTRACT.md`.
- Quests CLIs through `../../../quests/creation/CONTRACT.md` and its complete [engine handoff](../../../quests/handoff/CONTRACT.md): `npm run materialize` for the recorded story, `npm run author` for a written one.
- Quest bundle validation and selection through `../quest-bundle/CONTRACT.md`.
- Scene places and staging through `../game/scenery/CONTRACT.md`, building sources through `../game/data`, mission assets through `../mission-assets/CONTRACT.md` and the Materials theme index.
- City and game persistence through `../library/CONTRACT.md`.

## Invariants

- `out/cities/<id>` is a shell-only city. `out/drafts/<id>` is the replaceable creation draft. `out/games/<id>` is the final self-contained game.
- Small is 500 m, medium is 1000 m, large (shown as Big) is 3000 m. The launcher city field defaults to large. Atlas receives the user's seed, so the same size and seed regenerate the same geometry. Profiles live in [city-templates.json](city-templates.json).
- City creation requires only size. Omitted names and seeds receive fresh identities; explicit names and seeds remain supported.
- A themed city is named between Atlas and assembly: Naming names its districts, venues and transit and writes its NPC types, and the city is built from the named blueprint, whose bytes the world binds. Its manifest is `named` with `namingTheme` equal to the theme, and it carries `npc-types.json`. The model server is `model`; the child command gets `LLM_BASE_URL`, and `LLM_MODEL` only when `model.model` names one.
- `createGame` with `questId: null` creates free play. Empty `interiorIds` copies the city directly; selected interiors must match a completed draft. Free play carries no quest files or quest progress. Each new playthrough has its own id.
- Automatic interiors open up to the requested count, in an order handed to the assembler as `--interior-priority`; a building Interior cannot furnish is skipped for the next candidate and `count` reports what opened. Fewer than seven opened is `E_QUEST_LOCATIONS`. An unnamed city opens the places its recorded ten-step main story needs first, then side-job venues, then other venues; the story is then written again against the buildings that actually opened (`materialize --parcels`), so every place it names is one the player can walk into; a side job with nowhere to go is left out with its reason, and a main story with nowhere to go fails naming the kind of building the city is missing. Seven interiors support that main line, eight support two side jobs, and nine support all three. A named city opens a home first, then one building of each kind that hires, round after round, and has no story until the quest stage writes one.
- The quest stage writes a story when `mainBrief` has text or the city is named, else it selects from the recorded story. A written story runs `npm run author` in the Quests box against the draft's named world and NPC types, with `--parcels` the opened interiors, `--mechanics` `PLAYABLE_MECHANICS`, `--handoff` the host capabilities, `--profile` the city size and `--prompt` the brief (omitted, the city's theme). It runs for minutes to most of an hour, so the launcher runs it as a [creation job](../server/CONTRACT.md). Its questId is `<cityId>-story-<side jobs>`; the recorded one is `<cityId>-quests-<side jobs>`. Without `model`, a written story is `E_STORY_BRIEF_UNAVAILABLE`.
- Every bundle is written against `HOST_CAPABILITIES`, which the draft keeps as `quests/handoff-input.json`, so a story stages its scenes and ships them in bundle 1.2.
- Before selection every scene of the bundle stands in the draft's world, as the game stands it: its place resolves against the opened buildings, their main entrances and the Atlas plan, and its people, mission assets and decals compile in that frame with the same seeds. Street fixtures are placed by the game at load, so a street scene meets them at play. A side job with a scene that cannot stand is left out; a main story with one is `E_QUEST_LOCATIONS` naming the scene and why.
- The quest stage delivers the main line and up to three side jobs, fewer when fewer can stand; `sideJobs` in the result is how many it delivered.
- The draft keeps what a written story was made from in `story/`: `recording.json` (what the model said), `meta.json`, the script, the situations and each plan. A story that fails keeps its `story/` there too, with `meta.json` naming the stage it stopped at, and leaves the draft's quests as they were.
- A stage writes into a temporary sibling and publishes only after its command and output checks pass.
- Quest selection rewrites definitions, objectives, investigations, fixed mechanic bindings, mission item bindings, scenery, referenced mission asset requests and manifest counts together, and writes a 1.2 bundle. It reads 1.1 and 1.2 bundles and preserves the validated host capability object. A final game references `quests/quest-bundle.json`; `story/`, `quests/handoff-input.json`, full authoring metadata and unselected definitions do not ship with it.
