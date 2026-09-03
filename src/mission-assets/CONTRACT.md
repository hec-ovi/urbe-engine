# CONTRACT: mission assets

Purpose: creates and registers deterministic renderer-neutral mission objects and reusable furniture without deciding where they are placed.

Status: v1.0.

## Inputs

- `new MissionAssetCreator(materialCatalog)` and `new MissionAssetRegistry(materialCatalog)`: `materialCatalog` is [schema/material-catalog.schema.json](schema/material-catalog.schema.json). Each entry names an existing Materials key, its aliases and its available variant ids. Duplicate keys or aliases fail closed.
- `MissionAssetCreator.create(request)` and `MissionAssetRegistry.create(request)`: `request` is [schema/create-request.schema.json](schema/create-request.schema.json). It declares one exact asset id, purpose, family, dimensions in meters, visible material key and variant assignments, required interactions, clearance policy and unsigned 32-bit seed. Placement, cast identity, quest facts and world location are not accepted fields.
- `MissionAssetCreator.verifyAssembly(assembly)` and `MissionAssetRegistry.verify(assembly)`: `assembly` is [schema/asset-assembly.schema.json](schema/asset-assembly.schema.json). Verification checks the schema, canonical payload reference, exact geometry bounds, collision bounds, material slots and family interactions.
- `MissionAssetRegistry.get(lookup)`: `lookup` is [schema/asset-lookup.schema.json](schema/asset-lookup.schema.json). The exact registered asset id is required.
- `MissionAssetRegistry.list(query)`: `query` is [schema/registry-query.schema.json](schema/registry-query.schema.json). Optional family and interaction filters are closed enums.

Family and interaction compatibility is closed:

| family | allowed interactions | portability |
| --- | --- | --- |
| `document` | inspect, read, take | portable |
| `data-drive` | inspect, take, use | portable |
| `evidence-container` | inspect, open, close, store | fixed |
| `tool` | inspect, take, use | portable |
| `control-terminal` | inspect, use, access, hack, sabotage | fixed |
| `package` | inspect, take, open | portable |
| `table` | inspect, place-item | fixed |
| `chair` | inspect, sit | fixed |
| `shelf` | inspect, store, place-item | fixed |
| `cabinet` | inspect, open, close, store | fixed |

Every family requires a `surface` material slot. A control terminal also requires `display`. Optional closed slots are `accent`, `upholstery`, `grip` and `seal`, each allowed only on compatible families and material kinds. Keys and variant ids must resolve through the supplied catalog. There is no color fallback.

## Outputs

- `create` and `get` return [schema/asset-assembly.schema.json](schema/asset-assembly.schema.json): the exact dimensions; selected deterministic variant; local coordinate frame; unit scale; pivot and ground-contact origin; box primitive assembly; visible material assignments; compound collision bounds; one anchor per required interaction; approach, operation, access, seat or storage clearances; portability; and a canonical payload media reference.
- `verifyAssembly` and `verify` return the same validated [schema/asset-assembly.schema.json](schema/asset-assembly.schema.json) value.
- `list` returns [schema/registry-result.schema.json](schema/registry-result.schema.json), sorted by asset id.
- Errors serialize as [schema/error.schema.json](schema/error.schema.json).

The payload reference is `{ uri, mediaType, byteSize, checksum }`. Its byte size and `sha256:` checksum cover the canonical JSON assembly without `payloadRef`; no bare bytes cross this boundary. The renderer may serialize that assembly to GLB in its own layer and publish a separate validated model reference.

## Events

None. This layer creates descriptions and keeps an in-memory registry. It does not place objects, run interactions or change quest state.

## Errors

Closed error envelope: [schema/error.schema.json](schema/error.schema.json).

- `E_SCHEMA`: an input or output violates its JSON Schema, material slots are duplicated, or catalog keys and aliases collide.
- `E_DIMENSIONS`: dimensions are outside the selected family's supported range or produced geometry and collision do not exactly fit them.
- `E_MATERIAL`: a material key or variant is unresolved, incompatible with the family or slot, or a visible primitive lacks an assignment.
- `E_INTERACTION`: an interaction is unsupported for the family or `close` is authored without `open`.
- `E_CLEARANCE`: the supplied approach, side or overhead clearance cannot support the requested interactions.
- `E_HASH`: payload URI, byte size or SHA-256 does not match the canonical assembly.
- `E_NOT_FOUND`: a registry lookup has no exact id match.
- `E_CONFLICT`: an existing asset id is reused for a different deterministic assembly.

## Dependencies

- Materials contract: material keys and variant ids only. The caller supplies the schema-validated catalog projection, so this layer never imports Materials internals or map files.
- Web `TextEncoder`. Canonical SHA-256 is synchronous and produces the same payload reference in Node and the browser.

## Invariants

- Identical catalog and request values produce byte-identical canonical payloads, variant ids and SHA-256 references.
- Coordinates are local meters, +Y is up, +Z is front, and `{ x: 0, y: 0, z: 0 }` is both pivot and declared ground-contact origin.
- The primitive union and collision outer bounds exactly equal the requested width, height and depth. Scale remains `{ x: 1, y: 1, z: 1 }`.
- Every primitive names a material slot and every slot resolves to an existing compatible PBR key and variant. No anonymous color or placeholder surface exists.
- Every required interaction names an exact local anchor. Clearances are explicit volumes and never hidden placement guesses.
- Asset creation has no placement input or output. Interior and scene layers rotate and place the assembly only after checking physical bounds, clearance volumes, door movement, entrances and continuous walk routes.
- The creator does not invent cast, target, evidence, place or consequence facts. Consumers bind authored gameplay identities and events.
- Registry iteration is sorted and deterministic. Re-registering identical content is idempotent; conflicting content fails closed.

## How to modify this blackbox safely

1. Read this contract, every schema in `schema/`, and [SKILL.md](SKILL.md).
2. Add a family or interaction to the closed schemas, family rules, geometry builder and skill table together.
3. Use measured multi-part geometry whose primitive union reaches every declared outer bound. Keep placement out of this layer.
4. Resolve every visible primitive through a declared material slot. Add no raw colors, map bytes or sibling-layer source imports.
5. Add valid and invalid contract tests, including deterministic replay, exact dimensions, payload hashes, interaction compatibility and clearance rules.
6. Run the focused suite, full engine tests and engine build. Modify no integration layer until its own contract explicitly adopts this output.
