# CONTRACT: quest bundle consumer

Purpose: validates and selects the complete quests v0.6 engine handoff without breaking cross-file references.

## Inputs

- Manifest: [schema/manifest.schema.json](schema/manifest.schema.json), the consumed quests `quest-bundle.json` v1.0 shape.
- Catalogs: the five arrays named by the manifest: questlines, objective projections, investigation requests, mission asset requests and mission item bindings.
- Selection: an ordered unique list of quest ids and the output questline filename.

## Outputs

- `questBundle(manifest, catalogs)`: the validated manifest and its five unchanged arrays.
- `selectQuestBundle(bundle, questIds, questlinesFile)`: the chosen definitions, objective projections and investigations, plus only their item bindings and referenced mission asset requests. Counts and filenames are rebuilt together.

## Errors

- `E_QUEST_BUNDLE_INPUT`: the manifest or selection does not match its contract.
- `E_QUEST_BUNDLE_FILES`: a named catalog is not an array.
- `E_QUEST_BUNDLE_COUNT`: manifest and catalog counts disagree.
- `E_QUEST_BUNDLE_CONTENT`: objective order or a quest, item, asset or investigation reference disagrees across catalogs.

## Dependencies

- [Quests handoff](../../../quests/handoff/CONTRACT.md) for authored output semantics.
- [Playable quest actions](../game/quests/CONTRACT.md), [investigation](../game/investigation/CONTRACT.md) and [mission assets](../mission-assets/CONTRACT.md) consume the validated records.

## Invariants

- Objective rows are the byte-equivalent quest and step ordered projection of each authored target.
- A selected bundle contains no record owned by an omitted quest and no mission asset request without a selected item binding.
- Filenames stay in one directory and counts describe the exact returned arrays.
- Unknown or mismatched cross-file references fail before gameplay starts.

## Verification

Run `npm test -- src/quest-bundle/QuestBundle.test.js`. Tests use the public `index.js` entrypoint.
