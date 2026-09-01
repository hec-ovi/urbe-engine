# CONTRACT: assembly (engine inner box)

Purpose: turns the atlas blueprint plus the connections document into per-parcel exterior BuildingRequests and drives exterior to produce each building's GLB and blueprint.

## In
- atlas blueprint: `CityBlueprint` per ../../../atlas/CONTRACT.md; the CLI loads the committed sample `../../../atlas/samples/city-urbe.json`.
- connections document: `ConnectionsOutput` per ../../../connections/CONTRACT.md, produced in-process by `connectionsRunner.js` calling the library entry `generate(atlas, { seed })` with the atlas seed.

## Out
`RequestAssembler(atlas, connections).assemble(parcelId, { glb })` returns a `BuildingRequest` per ../../../exterior/schemas/building-request.schema.json:
- seed: `<atlas seed>:<parcelId>`
- parcel: footprint, access point and nominal maxHeight from the atlas parcel, verbatim
- building: atlas type and tier verbatim; floors seeded inside the envelope and raised so the nominal height covers the topmost above-ground aperture; basements added when a tunnel aperture sits below ground
- theme: `cyberpunk`
- apertures: the connections apertures whose buildingId equals the parcel id, verbatim
- options.glb: `merged` (engine runtime default) or `named`

CLI: `npm run assemble -- --parcel <id> --out <dir> [--glb merged|named]` validates the request against exterior's schema, writes `<id>.request.json` to `<dir>`, then runs exterior's CLI (`npm run generate` in ../../../exterior) so `<dir>` ends with request, GLB and blueprint. Prints each output file with its size.

## Errors
- `E_PARCEL_UNKNOWN`: parcel id not in the atlas blueprint (thrown as `AssemblyError`; CLI exit 1)
- `E_REQUEST_INVALID`: assembled request fails exterior's schema (CLI exit 1, ajv errors printed)
- `E_EXTERIOR_FAILED`: exterior CLI exited nonzero (CLI exit 1, its output printed)
- usage error: CLI exit 2

## Invariants
- Deterministic: same atlas and connections inputs, byte-identical request JSON.
- Apertures are passed through untouched; assembly never edits connections geometry.
- The CLI needs a TS-capable loader for the connections entry; the npm script runs it under tsx.

## Depends on
- ../../../atlas/CONTRACT.md
- ../../../connections/CONTRACT.md
- ../../../exterior/CONTRACT.md
