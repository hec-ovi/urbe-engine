# CONTRACT: assembly (engine inner box)

Purpose: turns the atlas blueprint plus the connections document into per-parcel exterior BuildingRequests, drives exterior to produce each building's GLB and blueprint, and optionally drives interior to fill the shell.

## In
- atlas blueprint: `CityBlueprint` per ../../../atlas/CONTRACT.md; every CLI takes `--blueprint <path>` and defaults to the committed sample `../../../atlas/samples/city-urbe.json` (assemble-city requires it explicitly). A named world per ../../../naming/CONTRACT.md (the same blueprint with `name` on its nameables and `meta.naming`) is taken through the same flag: parcel names become sign text, district names are not read.
- connections document: `ConnectionsOutput` per ../../../connections/CONTRACT.md, produced in-process by `connectionsRunner.js` calling the library entry `generate(atlas, { seed })` with the atlas seed.
- rooftop fitting runs after every shell. `RooftopSpanPlan` takes each finished Exterior blueprint's nested mast `externalAttachments`, plus closed building, roof-access and non-mast equipment prisms, and calls Connections `generateRooftopSpans(request)`. The complete scene comes from generated blueprints; assembly adds no endpoint or obstacle geometry.

## Out
`RequestAssembler(atlas, connections).assemble(parcelId, { glb })` returns a `BuildingRequest` per ../../../exterior/schemas/building-request.schema.json:
- seed: `<atlas seed>:<parcelId>`
- parcel: footprint, access point and nominal maxHeight from the atlas parcel, verbatim
- building: atlas type and tier verbatim; floors seeded inside the intersection of the atlas envelope and exterior's feasible range, computed with the recipe and constants in ../../../exterior/schemas/floor-constants.json (`floorFeasibility.js`); basements added when a tunnel aperture sits below ground, deep enough at the type's max floor height to reach its base
- theme: `cyberpunk`
- apertures: the connections apertures whose buildingId equals the parcel id, verbatim
- options.glb: `merged` (engine runtime default) or `named`
- options.signage: a `marquee` for the parcel types a passer-by reads off the street (hotel, coffee_shop, commerce, clinic, police, restaurant); every other type gets none, because a blank sign is worse than no sign. The text is the parcel's `name` lettered for exterior's atlas (`signText.js`): diacritics folded onto their base letter, uppercased, any character still outside the charset in ../../../exterior/CONTRACT.md read as the space it reserves (runs collapsed), then whole words in order while they fit the marquee limit exterior's request schema sets (40 characters). A parcel with no name, an empty one, or one whose first word alone passes the limit reads its venue word instead (hotel HOTEL, coffee_shop COFFEE, commerce MARKET, clinic CLINIC, police POLICE, restaurant DINER). `assemble(parcelId, { signage })` picks the rung: `name` (default), `venue` (the word), `none`.

`assembleInterior(parcelId, { blueprint, shellGlb })` returns an `InteriorRequest` per ../../../interior/schemas/request.schema.json: same derived seed, building id/type/tier verbatim, the exterior blueprint and shell path, materialTheme `cyberpunk`; assignments omitted so interior derives floor kinds from the blueprint slots. `interiorRunner.js` calls interior's library entries `generateInterior(request)` and `coreFeasibility(blueprint)` as black boxes; the latter gates generation (footprint-shape driven, per ../../../interior/schemas/core-feasibility.json; modes standard, compact, walkup, none). Standard and compact flow straight through. When the gate reports walkup mode and the chosen floors exceed its cap, the CLI re-picks floors with `assemble(parcelId, { floorCap })` (the cap wins over the atlas envelope minimum, aperture-driven minimums stay hard) and regenerates the shell before running interior. Mode none fails as E_CORE_INFEASIBLE.

The per-parcel chain lives in `BuildingPipeline.js` (assemble + validate, exterior CLI, core gate with walkup re-pick, interior files) and is shared by both CLIs. A facade the sign text does not fit on throws `E_SIGNAGE_TEXT_TOO_LONG`; the building steps down one rung (name, venue word, no sign) and is regenerated rather than failing the parcel. Interior accepts merged shells since its 0.5, so `merged` is the default everywhere.

CLI: `npm run assemble -- --parcel <id> --out <dir> [--blueprint <path>] [--glb merged|named] [--interior]` validates each request against its schema (ajv, draft 2020-12), writes `<id>.request.json` to `<dir>`, then runs exterior's CLI (`npm run generate` in ../../../exterior) so `<dir>` ends with request, GLB and blueprint. With `--interior` it also writes `<dir>/interior/`: `building.glb` (the whole furnished building, for the building viewer), `npc.json`, and per floor `floors/<tag>.json` plus `floors/<tag>.glb` (tag: zero-padded floor index, basements negative, `-001`), the floor's own geometry as interior's `floorGlbs` option returns it, which is what the game streams. Prints each output file with its size.

City batch: `npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--interiors N] [--parcel <id,id,...>] [--reuse-shells true] [--interior-parcels <id,id,...>]` runs connections once, then builds the merged runtime shell and blueprint for every parcel, N in parallel (default 4). `--reuse-shells true` makes the command require and retain every existing shell instead, so a generated city can become a game without rebuilding its geometry; it cannot be combined with `--parcel`. It furnishes five buildings by default. `--interior-parcels` supplies the exact unique subset for a manual build and makes its length the target. Otherwise parcels explicitly referenced anywhere in carried `<out>/quests/questlines.json` rank first; remaining slots come from commerce, mall, restaurant, coffee shop, hotel, clinic, hospital and police parcels. Both automatic groups use a stable hash of the atlas seed and parcel id, never input order. A candidate whose interior fails keeps its complete shell closed and the next candidate is tried. `<dir>/qa-report.json` separates shell failures from interior failures. Exit 0 only when every shell and the requested interior count finish.

The out dir contains exactly the blueprint it was built from (`OutDir.js`). Parcel folders absent from that blueprint are removed before the run, and only folders carrying an assembly request or blueprint are touched. `<dir>/blueprint.json` is the batch blueprint and `<dir>/npc-types.json` is the naming box's typed set found beside it, so the folder is the whole world the game loads; `<dir>/manifest.json` conforms to [schema/world-manifest.schema.json](schema/world-manifest.schema.json) and is written last:

```
{
  "contractVersion": "1.0.0", "seed": "urbe-tiny", "atlasVersion": "0.2.4",
  "named": true, "namingTheme": "rain-soaked port city",
  "parcels": [ "p0", "p1", ... ],
  "interiors": [ "p1", ... ],
  "floors": { "p1": [ "-001", "000", "001" ], ... },
  "rooftopSpans": { "meta": { "seed": "urbe-tiny:rooftop-spans", "schemaVersion": "1.0.0", "generatorVersion": "0.10.0" }, "spans": [] }
}
```

`named` says whether the blueprint's parcels carry names, and `namingTheme` is `meta.naming.theme` when the blueprint records one, else null. `parcels` is every id with a complete exterior blueprint and GLB. `interiors` is the subset with `interior/building.glb`, `interior/npc.json`, and a GLB beside every floor document; `floors` has exactly those ids and lists their tags lowest first. `rooftopSpans` is Connections' validated schema 1.0.0 output and may be empty. Older manifest 1.0.0 documents without that additive field load as an empty span set. A shell that is deliberately closed remains in `parcels` and is not a failure. This is the only list of buildings, floors and rooftop spans the game loads: a directory listing would pick up stale output, and the seed and version let the game refuse an out dir assembled from a different blueprint outright.

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
- After a city batch the out dir holds a folder for no parcel outside the blueprint. `manifest.json` lists all complete shells, lists complete interiors as a subset, has floor files for exactly that subset, and carries exactly the rooftop span document generated from those shell blueprints.
- The per-floor GLBs together hold exactly the interior meshes of `building.glb` (../../../interior/CONTRACT.md), so streaming floors draws the same building the viewer shows.
- The CLI needs a TS-capable loader for the connections and interior entries; the npm script runs it under tsx.

## Depends on
- ../../../atlas/CONTRACT.md
- ../../../connections/CONTRACT.md
- ../../../exterior/CONTRACT.md
- ../../../interior/CONTRACT.md
- ../../../naming/CONTRACT.md
- ../../../simulation/CONTRACT.md
