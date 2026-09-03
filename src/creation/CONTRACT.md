# CONTRACT: playable world creation

## Purpose

Builds a city, its selected interiors, its materialized quest bundle and the final game as four isolated filesystem stages.

## Inputs

- `createWorldCreation(config)`: [schema/config.schema.json](schema/config.schema.json).
- `generateCity(input)`: [schema/generate-city.schema.json](schema/generate-city.schema.json).
- `generateInstances(input)`: [schema/generate-instances.schema.json](schema/generate-instances.schema.json).
- `generateQuests(input)`: [schema/generate-quests.schema.json](schema/generate-quests.schema.json).
- `createGame(input)`: [schema/create-game.schema.json](schema/create-game.schema.json).

## Outputs

- `generateCity`: [schema/city-result.schema.json](schema/city-result.schema.json).
- `generateInstances`: [schema/instances-result.schema.json](schema/instances-result.schema.json).
- `generateQuests`: [schema/quests-result.schema.json](schema/quests-result.schema.json).
- `createGame`: [schema/game-result.schema.json](schema/game-result.schema.json).

## Events

None. Each promise settles only after its artifact is complete and validated.

## Errors

Closed set in [schema/creation-error.schema.json](schema/creation-error.schema.json): `E_INVALID_REQUEST`, `E_EXISTS`, `E_CITY_NOT_FOUND`, `E_DRAFT_NOT_FOUND`, `E_STAGE_MISMATCH`, `E_STORY_BRIEF_UNAVAILABLE`, `E_SIDE_JOB_LIMIT`, `E_QUEST_LOCATIONS`, `E_COMMAND_FAILED`, `E_OUTPUT_INVALID`, `E_STORAGE`.

## Dependencies

- Atlas built CLI through `../../../atlas/CONTRACT.md`; generation executes its existing `dist/cli.mjs` so the sibling source tree can stay read-only in the engine service.
- Assembly CLI through `../assembly/CONTRACT.md`.
- Quest materialization CLI through `../../../quests/creation/CONTRACT.md` and its complete [engine handoff](../../../quests/handoff/CONTRACT.md).
- Quest bundle validation and selection through `../quest-bundle/CONTRACT.md`.
- City and game persistence through `../library/CONTRACT.md`.

## Invariants

- `out/cities/<id>` is a shell-only city. `out/drafts/<id>` is the replaceable creation draft. `out/games/<id>` is the final self-contained game.
- Small is 400 m with six floors maximum and no regional transit. Medium is 800 m. Large is 1000 m. Atlas receives the user's seed, so the same size and seed regenerate the same geometry.
- Automatic interiors include every location needed by the ten-step main quest before adding side-job and then extra buildings. Seven interiors support the main line, eight support two side jobs, and nine support all three.
- The current recorded story supplies at most three side jobs. A non-empty custom brief fails explicitly because this deterministic path does not call a model.
- A stage writes into a temporary sibling and publishes only after its command and output checks pass.
- Quest selection rewrites definitions, objectives, investigations, fixed mechanic bindings, mission item bindings, referenced mission asset requests and manifest counts together. It preserves the validated host capability object. A final game references `quests/quest-bundle.json`; full authoring metadata and unselected definitions do not ship with it.

## How to modify this blackbox safely

Update schemas and this contract first. Keep process execution and filesystem mutation private. Test through `index.js` with real temporary directories, then run one real Atlas, assembly and quest materialization sequence.
