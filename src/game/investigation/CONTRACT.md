# CONTRACT: investigation scenes

Purpose: fits and renders authored incident elements in a measured interior or street region, then applies persistent evidence interactions to one exact quest step without inventing story facts.

## Inputs

- Scene request: [schema/scene-request.schema.json](schema/scene-request.schema.json). Version 1.0 remains valid for isolated assembly. Live version 1.1 also carries one exact quest step, evidence, place, and completion action binding per evidence target. Its bodies use audited Source media, either with original textures in Pro `Death01` or `Death02`, or wearing a crowd person's `appearance` (`dressed-appearance`) in a [scenery](../scenery/CONTRACT.md) pose; props carry full mission-asset assemblies. A placement `point` is the frame point an element is placed nearest.
- Linked scene request: [schema/linked-scene-request.schema.json](schema/linked-scene-request.schema.json), version 1.2. It carries the incident, bindings and evidence of a 1.1 request, the scenery scene it stands over (`scenery.sceneId`) and one element of that scene per evidence (`evidenceVisuals`), and no frame or elements of its own.
- Live scene requests: [schema/scene-requests.schema.json](schema/scene-requests.schema.json). The complete authored list loaded from `quests/investigations.json` or the quest bundle.
- Scene assembly passed to the runtime: [schema/scene-assembly.schema.json](schema/scene-assembly.schema.json). Only an assembly already validated by this layer is accepted.
- Target query: [schema/target-query.schema.json](schema/target-query.schema.json). It carries the complete persisted scene state.
- Interaction request: [schema/interaction-request.schema.json](schema/interaction-request.schema.json). The host supplies the selected target, action, saved state, and measured focus facts.
- Saved scene state: [schema/scene-state.schema.json](schema/scene-state.schema.json). The runtime accepts this shape wherever scene state crosses the save boundary.
- Saved scene list: [schema/saved-scenes.schema.json](schema/saved-scenes.schema.json). The catalog value contains complete state for every loaded authored scene.
- Live interaction frame: [schema/gameplay-frame.schema.json](schema/gameplay-frame.schema.json). The host supplies current place, feet, eye, look, and time.
- Live selected binding: [schema/gameplay-perform.schema.json](schema/gameplay-perform.schema.json). The shared interactor supplies only a target key, E or R binding, and time.

## Outputs

- Scene assembly: [schema/scene-assembly.schema.json](schema/scene-assembly.schema.json). It contains exact world transforms, original asset reference envelopes, PBR material keys and variants, fitted decals, reachable approach points, interaction targets, and initial state.
- Interaction targets: [schema/interaction-targets.schema.json](schema/interaction-targets.schema.json). Availability is derived from the saved evidence state and authored prerequisites.
- Interaction result: [schema/interaction-result.schema.json](schema/interaction-result.schema.json). It contains the next validated scene state, one-shot authored events, and an exact collected-object world change when applicable.
- Saved scene state: [schema/scene-state.schema.json](schema/scene-state.schema.json). It is JSON-safe and contains no renderer or runtime references.
- Live interaction candidates: [schema/gameplay-candidates.schema.json](schema/gameplay-candidates.schema.json). Only targets that pass active-step, exact-place, reach, aim, and occlusion checks are published.
- Live interaction result: [schema/gameplay-result.schema.json](schema/gameplay-result.schema.json). It adapts an accepted evidence transition and exact `investigated` quest result to the shared HUD result shape.

Shared ids, coordinates, asset envelopes, material assignments, evidence definitions and state types live in [schema/values.schema.json](schema/values.schema.json).

## Events

- `SceneAssembler.assemble(request)` validates the scene, places bodies and props, fits decals to receiving surfaces, verifies every evidence target has a reachable approach, and returns the assembly.
- `InvestigationRuntime.targets({ state })` projects current evidence availability without mutating state.
- `InvestigationRuntime.perform(request)` applies `inspect` or `take`, then emits only consequence events authored on that evidence and transition.
- `InvestigationGameplay.create(options)` accepts only version 1.1 and 1.2 scenes whose quest, step, scene, evidence, and place match the loaded quest definition exactly. A 1.1 scene is assembled at creation and its Source bodies are read then; a 1.2 scene is assembled when it stages. Without a `renderer` it builds one from `materialFactory`, `physics`, `playerCollider`, `animation`, `loadGltf` and `warmup`.
- The scenery director stages and retires every scene (`lifecycles()`, `stage(sceneId, link)`, `retire(sceneId)`); a scene offers candidates only while staged. A 1.1 scene is drawn by this layer from staging until retirement. A 1.2 scene is the 1.1 request its scenery scene's staging request makes (the same frame, seed and elements in the same order, each evidence on the element `evidenceVisuals` names), so its placement is exactly that scene's; its focus, occlusion and collection go through that scene's visuals.
- `InvestigationGameplay.perform(request)` emits `{ kind: "investigated", sceneId, evidenceId, place }` only after `InvestigationRuntime` accepts the authored completion action. The exact selected quest must accept that event before scene state changes.
- `InvestigationSceneRenderer` `realize(assembly)` builds one scene's mission primitives and fitted decals with resolved PBR materials. It stands an audited Source body, preserves its original textures, applies the final frame of the named Pro death pose, and fails if any required body, pose, or texture is unavailable; a dressed body stands only through its scenery scene. It warms the scene through `warmup` (settable after creation) before adding it and its colliders, so staging mid-game uploads and links nothing new. `prepare(assemblies)` reads every Source body once ahead; a body that failed is read again when its scene stages. `release(sceneId)` removes that scene's visuals and colliders. Its occlusion query excludes the selected entity's own collider and the player collider while retaining every other world collider.

## Errors

- `E_INVESTIGATION_INPUT`: input does not match its JSON Schema.
- `E_INVESTIGATION_OUTPUT`: generated output does not match its JSON Schema.
- `E_INVESTIGATION_GEOMETRY`: ids, references, surface frames, material slots, portable status, or prerequisite graphs disagree.
- `E_INVESTIGATION_NO_FIT`: an entity, decal, or reachable evidence approach cannot fit the measured location.
- `E_INVESTIGATION_STATE`: persisted evidence or emitted transition state disagrees with the assembled scene.
- `E_INVESTIGATION_BINDING`: a live scene does not exactly match its quest definition, a 1.2 scene does not name one element per evidence or stages without its scenery scene, or the exact quest rejects an accepted scene completion.
- `E_INVESTIGATION_ASSET`: a required Source body, rig, texture, or Pro final pose cannot load.
- `E_INVESTIGATION_MATERIAL`: a mission prop or decal material key cannot resolve.
- Interaction result codes are `unknown-target`, `wrong-scene`, `wrong-action`, `prerequisite`, `not-visible`, `occluded`, `out-of-reach`, `inspect-first`, and `already-resolved`.

## Dependencies

- Quest authoring, through the separate `quests/authoring/CONTRACT.md`. That layer must author the facts, visible evidence, prerequisites and consequence events before it requests assembly.
- `mission-assets`, through its public asset assembly and value schemas. Creation remains separate from scene placement. Binary models never cross this contract as bare bytes.
- Character assets, through the audited Source body and Pro animation public APIs.
- Materials, through PBR keys and optional variants in [schema/values.schema.json](schema/values.schema.json). Material resolution remains outside this layer and must fail closed on an unavailable key.
- Three.js, the host Rapier adapter, and the PBR material factory, inside the renderer adapter only.
- [Scenery](../scenery/CONTRACT.md): its staging geometry places every scene, its director stages every scene, and a 1.2 scene stands over one of its scenes.

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
- The renderer never substitutes an untextured body or anonymous prop. Every visible mission primitive and decal resolves its authored MaterialFactory key; Source bodies retain their original mapped materials.
- Collection hides the exact rendered entity and removes its collider. Staging a restored scene repeats that world change before its first interaction frame.
- A scene's visuals and colliders exist only while it is staged.
