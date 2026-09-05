# Development server contract

Contract version: 1.0

## Purpose

Expose checked development HTTP routes for world builds, the launcher and NPC dialogue.

## Inputs

- `POST /api/building`: [schema/building-build-request.schema.json](schema/building-build-request.schema.json).
- `GET /api/exteriors`: no input; checks local batch runtime prerequisites.
- `POST /api/exteriors`: [exact displayed blueprint envelope](schema/exterior-build-request.schema.json).
- `GET /api/exteriors/<id>`: job id returned by POST.
- `POST /api/launcher`: [schema/launcher-request.schema.json](schema/launcher-request.schema.json).
- `POST /api/talk`: [schema/talk-request.schema.json](schema/talk-request.schema.json). `quests` is the optional exact `QuestSession.snapshot()` sent by `GameApp`.

## Outputs

- Building success: [schema/building-build-result.schema.json](schema/building-build-result.schema.json).
- Exterior capability: HTTP 200 [schema/exterior-capability.schema.json](schema/exterior-capability.schema.json).
- Exterior POST: HTTP 202 [job](schema/exterior-build-job.schema.json); polling returns HTTP 200 with the same shape.
- Launcher success: the selected result in [the launcher contract](../launcher/CONTRACT.md).
- Talk success: HTTP 200 [schema/talk-response.schema.json](schema/talk-response.schema.json).

## Errors

- Building failures use [schema/building-build-error.schema.json](schema/building-build-error.schema.json).
- Exterior errors: [schema/exterior-build-error.schema.json](schema/exterior-build-error.schema.json). Invalid JSON/envelope/duplicate parcel ids return 400, uploads over 128 MiB return 413, unavailable runtime 503, four retained jobs return 429 `E_BUSY`, absent job 404, storage failure 500. Background failures remain visible in the failed job.
- Launcher failures use `E_INVALID_REQUEST`, the closed library and creation errors, or `E_LAUNCHER` for an internal failure.
- Talk invalid JSON or request values return HTTP 400 [schema/talk-error.schema.json](schema/talk-error.schema.json). World, dialogue, model and invalid output failures return the same shape with HTTP 502.

## Invariants

- A route invokes its service only after its request passes the public boundary.
- Talk uses the visible NPC, current behavior and current quest snapshot supplied by `GameApp`. An empty `LLM_MODEL` selects the first model advertised by `LLM_BASE_URL`.
- Routes return JSON with no undeclared fields.
- Filesystem services keep every resolved path inside the configured output root. Talk world paths contain no `.` or `..` segment.
- Exterior jobs create a unique direct child of Engine `out`, reject a symbolic-link output root, and never replace existing worlds. They carry the supplied blueprint unchanged, without seed lookup or regeneration, and run public `assemble-city --interiors 0`. Connections remains a mandatory gate.
- The exterior boundary checks only its consumed Atlas envelope and safe unique parcel ids, not all Atlas geometry. Assembly performs downstream validation. `blueprintHash` is SHA-256 over recursively key-sorted JSON; arrays keep their order.
- Jobs run in submission order, one city batch at a time. They report complete nonempty regular shell/blueprint file pairs. Success additionally requires a schema-valid manifest matching every requested parcel, seed and Atlas version, no interiors, and an unchanged carried blueprint. Partial results never enable opening a completed city. Job state lives until server restart; generated files remain on disk.
- A declared manifest `connections` reference follows [Assembly's artifact contract](../assembly/CONTRACT.md). Final admission requires its nonempty regular file, the published Connections output schema, both source seeds and SHA-256 over the exact artifact and carried blueprint bytes. Missing or invalid declared data fails with `E_BUILD_INCOMPLETE`; absent-field legacy manifests remain accepted.
- Capability checks current local prerequisites; POST checks again. Four jobs are retained per server session, including terminal jobs, with no replacement. Terminal jobs release their full input blueprint from memory. The upload limit bounds input storage, not generated shell size.

## Dependencies

- [Building assembly](../assembly/CONTRACT.md)
- [Connections](../../../connections/CONTRACT.md)
- [Launcher](../launcher/CONTRACT.md)
- [Library](../library/CONTRACT.md)
- [Quests](../../../quests/CONTRACT.md)
- [Simulation](../../../simulation/CONTRACT.md)

## How to modify this blackbox safely

Change schemas before route shapes. Exercise each route through HTTP, including one accepted request and every declared response class.
