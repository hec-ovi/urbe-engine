# CONTRACT: investigation scenes

Purpose: fits authored incident elements into a measured interior or street region and applies persistent evidence interactions without inventing story facts.

## Inputs

- Scene request: [schema/scene-request.schema.json](schema/scene-request.schema.json). It carries the narrative incident, measured location frame, entrances, blockers, receiving surfaces, referenced assets, explicit bodies, props, decals, evidence, prerequisites, and consequence events.
- Scene assembly passed to the runtime: [schema/scene-assembly.schema.json](schema/scene-assembly.schema.json). Only an assembly already validated by this layer is accepted.
- Target query: [schema/target-query.schema.json](schema/target-query.schema.json). It carries the complete persisted scene state.
- Interaction request: [schema/interaction-request.schema.json](schema/interaction-request.schema.json). The host supplies the selected target, action, saved state, and measured focus facts.
- Saved scene state: [schema/scene-state.schema.json](schema/scene-state.schema.json). The runtime accepts this shape wherever scene state crosses the save boundary.

## Outputs

- Scene assembly: [schema/scene-assembly.schema.json](schema/scene-assembly.schema.json). It contains exact world transforms, original asset reference envelopes, PBR material keys and variants, fitted decals, reachable approach points, interaction targets, and initial state.
- Interaction targets: [schema/interaction-targets.schema.json](schema/interaction-targets.schema.json). Availability is derived from the saved evidence state and authored prerequisites.
- Interaction result: [schema/interaction-result.schema.json](schema/interaction-result.schema.json). It contains the next validated scene state, one-shot authored events, and an exact collected-object world change when applicable.
- Saved scene state: [schema/scene-state.schema.json](schema/scene-state.schema.json). It is JSON-safe and contains no renderer or runtime references.

Shared ids, coordinates, asset envelopes, material assignments, evidence definitions and state types live in [schema/values.schema.json](schema/values.schema.json).

## Events

- `SceneAssembler.assemble(request)` validates the scene, places bodies and props, fits decals to receiving surfaces, verifies every evidence target has a reachable approach, and returns the assembly.
- `InvestigationRuntime.targets({ state })` projects current evidence availability without mutating state.
- `InvestigationRuntime.perform(request)` applies `inspect` or `take`, then emits only consequence events authored on that evidence and transition.

## Errors

- `E_INVESTIGATION_INPUT`: input does not match its JSON Schema.
- `E_INVESTIGATION_OUTPUT`: generated output does not match its JSON Schema.
- `E_INVESTIGATION_GEOMETRY`: ids, references, surface frames, material slots, portable status, or prerequisite graphs disagree.
- `E_INVESTIGATION_NO_FIT`: an entity, decal, or reachable evidence approach cannot fit the measured location.
- `E_INVESTIGATION_STATE`: persisted evidence or emitted transition state disagrees with the assembled scene.
- Interaction result codes are `unknown-target`, `wrong-scene`, `wrong-action`, `prerequisite`, `not-visible`, `occluded`, `out-of-reach`, `inspect-first`, and `already-resolved`.

## Dependencies

- Quest authoring, through the separate `quests/authoring/CONTRACT.md`. That layer must author the facts, visible evidence, prerequisites and consequence events before it requests assembly.
- Mission-object and character asset creators, through the asset reference envelope in [schema/values.schema.json](schema/values.schema.json). Binary models never cross this contract as bare bytes.
- Materials, through PBR keys and optional variants in [schema/values.schema.json](schema/values.schema.json). Material resolution remains outside this layer and must fail closed on an unavailable key.
- The host renderer and physics focus query consume the assembly only. This layer imports neither.

## Invariants

- Output evidence ids and descriptions equal the authored input. Templates and seeds never create clues, facts, bodies, blood, damage, or consequences.
- The same complete request produces byte-equivalent JSON placement on the same JavaScript runtime.
- Entities stay inside the measured location, outside blockers and entrance clearances, and at least 0.12 m apart.
- Model origin is calculated from the asset's declared ground contact. A lying body or fallen prop touches the measured ground plane at that point.
- Decal axes come from an orthonormal receiving-surface frame. Width and height fit that surface, avoid its blocked regions, and use an explicit 0.002 m to 0.02 m normal offset to prevent coincident-surface flicker.
- Every evidence item has exactly one visible body, prop, or decal. Portable evidence must be a portable prop; a body or decal can never enter inventory.
- At least one entrance reaches an unobstructed point within 2.25 m of every evidence target on the navigation grid. Assembly fails if this cannot be proven.
- Inspect and take require visible, unobstructed focus inside the target's measured reach. A rejection does not mutate state.
- Consequence events come only from the authored evidence definition and emit once. Reloading preserves discoveries, collected props, and emitted transition ids.
- Asset media crosses by reference with URI, media type, byte size and SHA-256 checksum. Materials cross as PBR database keys, never as anonymous colors.

## How to modify this blackbox safely

Change only this folder. Update the exact input and output schemas before changing placement or state behavior. Keep geometry checks deterministic and consequence kinds closed. Add an interior and street fixture for new placement behavior, cover invalid and persistence paths, then run the focused tests and the full engine suite.
