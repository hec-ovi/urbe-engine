# Mission asset creator skill

Use this skill when a quest or interior needs a measured reusable prop or one of the supported furniture families. This skill creates the asset description only. It does not place the asset or assign story identity.

## Resolve the request

Choose exactly one family from the contract. Preserve the authored purpose as supplied. Do not infer a victim, owner, target, location, evidence meaning, access credential or quest consequence from that purpose.

Measure the required outer width, height and depth in meters. The creator scales its parts to those exact bounds and returns unit scale. Pick a different family or revise the dimensions when they fall outside the family range; do not disguise a dimension error with placement scale.

## Select materials

Resolve keys and variant ids against the Materials contract before creating the catalog projection. Always provide `surface`. Provide `display` for a control terminal. Add only relevant optional slots:

- `accent`: document, data drive, evidence container, tool, control terminal, table, chair, shelf or cabinet.
- `upholstery`: chair, using fabric or compatible plastic.
- `grip`: tool, using rubber, plastic or fabric.
- `seal`: package, using rubber, plastic, fabric or metal.

Use the existing PBR key and the exact variant id. Never submit a raw color, texture bytes, invented key or fallback placeholder. The output assigns every visible primitive to one of these slots.

## Declare interactions

List only interactions gameplay actually requires, using the closed family table in [CONTRACT.md](CONTRACT.md). Each declaration produces one exact local anchor. `close` requires `open` in the same request. This creator does not grant access, solve a hack, discover evidence, add inventory or advance a quest; gameplay consumers bind those authored effects.

## Reserve operating space

Set an approach depth, side margin and overhead allowance for the intended use. Minimum general approach is 0.75 m, side margin is 0.2 m and overhead is 0.1 m. A seat needs at least 0.9 m approach. Opening a cabinet or evidence container also needs the full supported door or lid reach, capped at 2 m.

The output separates physical collision from approach, operation, access, seat and storage clearance volumes. A placement layer must transform all of them together, keep them inside the usable region and reject collisions with doors, entrances, reserved routes, walls or other operating spaces.

## Deterministic variants and media

The unsigned seed, family and asset id select the variant. Identical inputs reproduce the same primitive order, anchors, clearances and canonical JSON hash. Treat `payloadRef` as the integrity envelope for the renderer-neutral JSON. If a renderer emits GLB, it owns that file and publishes a new schema-validated `{ uri, mediaType, byteSize, checksum }` reference. Never pass bare model or texture bytes.

## Verify

Run `verifyAssembly` on stored or transported assemblies. It checks schema, exact fit, collision, materials, interactions and the payload hash. A failed check is a closed contract error, not permission to repair or guess data.

Before shipping a change, cover one valid request for every affected family and invalid schema, dimensions, materials, interactions and clearances. Replay identical inputs and independently recompute the canonical SHA-256.
