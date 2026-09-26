# CONTRACT: quest bundle consumer

Purpose: validates and selects the complete Quests engine handoff without breaking cross-file references.

## Inputs

- Manifest: [schema/manifest.schema.json](schema/manifest.schema.json), the consumed quests `quest-bundle.json` in version 1.1 or 1.2. Version 1.2 adds `scenery.json` and its count; a 1.1 bundle is read as one without scenery.
- Files: counted arrays for questlines, objectives, investigations, fixed mechanic bindings, mission asset requests, item bindings and, in 1.2, [scene specs](../game/scenery/CONTRACT.md), plus the object-valued host capabilities file. `questBundleFiles(manifest)` names the files one manifest carries.
- Host capabilities: `transportationModes`, and optional `scenery` naming no place kind, pose, prop kind or lighting preset beyond Engine's [scenery capabilities](../game/scenery/capabilities.json) and no limit above them.
- Selection: an ordered unique list of quest ids and the output questline filename.

## Outputs

- `questBundle(manifest, catalogs)`: the validated manifest and its unchanged files, with `scenery` always an array.
- `selectQuestBundle(bundle, questIds, questlinesFile)`: the chosen definitions and quest-owned records, including scenes, plus only mission assets referenced by selected item or mechanic bindings or selected scenes. Host capabilities remain unchanged. Counts and filenames are rebuilt together as a 1.2 manifest.

## Errors

- `E_QUEST_BUNDLE_INPUT`: the manifest or selection does not match its contract.
- `E_QUEST_BUNDLE_FILES`: a named catalog is not an array, a 1.1 bundle carries scenery, or the host capabilities are not one object.
- `E_QUEST_BUNDLE_COUNT`: manifest and catalog counts disagree.
- `E_QUEST_BUNDLE_CONTENT`: objective order, fixed target identity, interaction, host mode, host scenery, or another cross-file reference disagrees.

## Dependencies

- [Quests handoff](../../../quests/handoff/CONTRACT.md) for authored output semantics.
- [Playable quest actions](../game/quests/CONTRACT.md), [investigation](../game/investigation/CONTRACT.md), [scenery](../game/scenery/CONTRACT.md) and [mission assets](../mission-assets/CONTRACT.md) consume the validated records.

## Invariants

- Objective rows are the byte-equivalent quest and step ordered projection of each authored target.
- A selected bundle contains no record owned by an omitted quest and no mission asset without a selected item or fixed mechanic binding or selected scene.
- A scene names its own quest's steps, flags and roles and assets the bundle requests, asks only for what the host scenery capability declares, and a bundle with scenes declares that capability. A 1.2 investigation and the scene it stands over name each other, and every element its evidence shows on is that scene's.
- Every rescue, access, hacking and sabotage step binds its exact authored target to a fixed asset interaction. Engine admits measured `public-transit` transportation with at most one controlled passenger.
- Filenames stay in one directory and counts describe the exact returned arrays.
- Unknown or mismatched cross-file references fail before gameplay starts.

## Verification

Run `npm test -- src/quest-bundle/QuestBundle.test.js`. Tests use the public `index.js` entrypoint.
