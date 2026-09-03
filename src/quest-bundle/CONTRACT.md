# CONTRACT: quest bundle consumer

Purpose: validates and selects the complete quests v0.7 engine handoff without breaking cross-file references.

## Inputs

- Manifest: [schema/manifest.schema.json](schema/manifest.schema.json), the consumed quests `quest-bundle.json` v1.1 shape.
- Files: six counted arrays for questlines, objectives, investigations, fixed mechanic bindings, mission asset requests and item bindings, plus the object-valued host capabilities file.
- Selection: an ordered unique list of quest ids and the output questline filename.

## Outputs

- `questBundle(manifest, catalogs)`: the validated manifest and its seven unchanged files.
- `selectQuestBundle(bundle, questIds, questlinesFile)`: the chosen definitions and quest-owned records, plus only mission assets referenced by selected item or mechanic bindings. Host capabilities remain unchanged. Counts and filenames are rebuilt together.

## Errors

- `E_QUEST_BUNDLE_INPUT`: the manifest or selection does not match its contract.
- `E_QUEST_BUNDLE_FILES`: a named catalog is not an array.
- `E_QUEST_BUNDLE_COUNT`: manifest and catalog counts disagree.
- `E_QUEST_BUNDLE_CONTENT`: objective order, fixed target identity, interaction, host mode, or another cross-file reference disagrees.

## Dependencies

- [Quests handoff](../../../quests/handoff/CONTRACT.md) for authored output semantics.
- [Playable quest actions](../game/quests/CONTRACT.md), [investigation](../game/investigation/CONTRACT.md) and [mission assets](../mission-assets/CONTRACT.md) consume the validated records.

## Invariants

- Objective rows are the byte-equivalent quest and step ordered projection of each authored target.
- A selected bundle contains no record owned by an omitted quest and no mission asset without a selected item or fixed mechanic binding.
- Every rescue, access, hacking and sabotage step binds its exact authored target to a fixed asset interaction. Engine admits only measured `public-transit` transportation.
- Filenames stay in one directory and counts describe the exact returned arrays.
- Unknown or mismatched cross-file references fail before gameplay starts.

## Verification

Run `npm test -- src/quest-bundle/QuestBundle.test.js`. Tests use the public `index.js` entrypoint.
