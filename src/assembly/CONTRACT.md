# CONTRACT: assembly (engine inner box)

Purpose: turns the atlas blueprint plus the connections document into per-parcel exterior BuildingRequests, drives exterior to produce each building's GLB and blueprint, and optionally drives interior to fill the shell.

## In
- atlas blueprint: `CityBlueprint` per ../../../atlas/CONTRACT.md; every CLI takes `--blueprint <path>` and defaults to the committed sample `../../../atlas/samples/city-urbe.json` (assemble-city requires it explicitly).
- connections document: `ConnectionsOutput` per ../../../connections/CONTRACT.md, produced in-process by `connectionsRunner.js` calling the library entry `generate(atlas, { seed })` with the atlas seed.

## Out
`RequestAssembler(atlas, connections).assemble(parcelId, { glb })` returns a `BuildingRequest` per ../../../exterior/schemas/building-request.schema.json:
- seed: `<atlas seed>:<parcelId>`
- parcel: footprint, access point and nominal maxHeight from the atlas parcel, verbatim
- building: atlas type and tier verbatim; floors seeded inside the intersection of the atlas envelope and exterior's feasible range, computed with the recipe and constants in ../../../exterior/schemas/floor-constants.json (`floorFeasibility.js`); basements added when a tunnel aperture sits below ground, deep enough at the type's max floor height to reach its base
- theme: `cyberpunk`
- apertures: the connections apertures whose buildingId equals the parcel id, verbatim
- options.glb: `merged` (engine runtime default) or `named`

`assembleInterior(parcelId, { blueprint, shellGlb })` returns an `InteriorRequest` per ../../../interior/schemas/request.schema.json: same derived seed, building id/type/tier verbatim, the exterior blueprint and shell path, materialTheme `cyberpunk`; assignments omitted so interior derives floor kinds from the blueprint slots. `interiorRunner.js` calls interior's library entries `generateInterior(request)` and `coreFeasibility(blueprint)` as black boxes; the latter gates generation (footprint-shape driven, per ../../../interior/schemas/core-feasibility.json; modes standard, compact, walkup, none). Standard and compact flow straight through. When the gate reports walkup mode and the chosen floors exceed its cap, the CLI re-picks floors with `assemble(parcelId, { floorCap })` (the cap wins over the atlas envelope minimum, aperture-driven minimums stay hard) and regenerates the shell before running interior. Mode none fails as E_CORE_INFEASIBLE.

The per-parcel chain lives in `BuildingPipeline.js` (assemble + validate, exterior CLI, core gate with walkup re-pick, interior files) and is shared by both CLIs; interior accepts merged shells since its 0.5, so `merged` is the default everywhere.

CLI: `npm run assemble -- --parcel <id> --out <dir> [--blueprint <path>] [--glb merged|named] [--interior]` validates each request against its schema (ajv, draft 2020-12), writes `<id>.request.json` to `<dir>`, then runs exterior's CLI (`npm run generate` in ../../../exterior) so `<dir>` ends with request, GLB and blueprint. With `--interior` it also writes `<dir>/interior/`: `building.glb`, `floors/NNN.json` (zero-padded floor index, basements negative), `npc.json`. Prints each output file with its size.

City batch: `npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--parcel <id,id,...>]` runs connections once, then the pipeline (merged runtime GLB + blueprint + interior) for every parcel, N in parallel (default 4). Failures are recorded, never fatal; `<dir>/qa-report.json` carries per-parcel pass/fail with verbatim errors, timing and disk totals. Exit 0 only when every parcel passed.

Simulation: `simulationRunner.js` calls simulation's `createSimulation(input)` as a black box. `npm run simulate -- --time <minutes> [--district <id>] [--blueprint <path>] [--interiors <dir>]` boots it over the blueprint, connections' networks and the npc.json of every assembled building under the interiors dir (default `out/`) (synthetic fallback elsewhere, default npcTypes and name pool), prints population stats, the scoped crowd slice, three instantiated lives (a sampled crowd agent's handle, coffee vendor at midday, a reservation), latency measurements and a conservation check; usage error exit 2, no live crowd agent exit 1.

## Errors
- `E_PARCEL_UNKNOWN`: parcel id not in the atlas blueprint (thrown as `AssemblyError`; CLI exit 1)
- `E_ENVELOPE_INFEASIBLE`: no floor count satisfies both the atlas envelope and exterior's feasibility recipe for the parcel's apertures (thrown as `AssemblyError`; CLI exit 1)
- `E_REQUEST_INVALID`: an assembled request fails its schema (CLI exit 1, ajv errors printed)
- `E_EXTERIOR_FAILED`: exterior CLI exited nonzero (CLI exit 1, its output printed)
- `E_CORE_INFEASIBLE`: interior's coreFeasibility gate reports mode none, the footprint cannot hold any core (CLI exit 1; mode, band and core lengths printed)
- `E_INTERIOR_FAILED`: interior's generateInterior threw (CLI exit 1, its InteriorError code and message printed)
- usage error: CLI exit 2

## Invariants
- Deterministic: same atlas and connections inputs, byte-identical request JSON.
- Apertures are passed through untouched; assembly never edits connections geometry.
- The CLI needs a TS-capable loader for the connections and interior entries; the npm script runs it under tsx.

## Depends on
- ../../../atlas/CONTRACT.md
- ../../../connections/CONTRACT.md
- ../../../exterior/CONTRACT.md
- ../../../interior/CONTRACT.md
- ../../../simulation/CONTRACT.md
