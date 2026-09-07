# Street props

Takes authored city land and models, returns sparse street arrangements and tree instances.

## Input

- `await new Dressing(atlas, walk, factory, options?).build()`.
- Atlas [blueprint](../../../../atlas/schema/blueprint.ts): parcels, streets, planting, ground cover and station reservations.
- Connections [walk graph](../../../../connections/schemas/networks.schema.json): full widths and elevated `path3`.
- Materials [factory](../../building/CONTRACT.md): `build(key, variantId)`.
- [Options](options.schema.json): optional `loadAsset(url) -> Promise<{scene}>` replaces GLTFLoader transport; `obstacles: [{footprint,bottom,top}]` reserves already-built fixture volumes.
- [Catalog](catalog.json), [schema](catalog.schema.json): model sources, metre dimensions and materials. [Arrangements](arrangements.json), [schema](arrangements.schema.json): site frequency and supported delivery/refuse slots.

## Output

[Result schema](result.schema.json) describes counts, placements and scene identities. `group` contains instanced material parts in 64 m cells. `colliders` is a Map of position-only triangle geometry for solid props and tree trunks. `dispose()` releases owned geometry, imported textures and material clones, retaining factory resources.

Cardboard cartons have folded flaps and tape; wooden crates have separate boards and braces. Four dark molded-plastic variants have grip openings, reinforced rims, latches or loose lids, measured dents and twisted walls. Continuous polymer grain covers the body; a fitted scuffed panel adds localized wear. Placement and collision use the deformed bounds. Downloaded bags, dumpsters and containers retain their authored geometry. Container variants have physical ribs, framing and door hardware. Carton tape and label details share one vertex-colored material part. Trees use Atlas tree anchors, with measured crown bounds and trunk collision.

## Placement

The seed selects refuse, delivery and service-yard arrangements. Whole footprints must fit equal-height authored land, clear buildings, door aprons, street fixtures, walk widths and station reservations. Large containers require block/open land and are never shrunk to fit. A failed arrangement is omitted atomically. Trees reserve their trunk at ground level and their crown against buildings; low foliage also clears pedestrian paths. Draw count depends on occupied cells, geometry variants and material parts, never one mesh per item.

Missing or malformed model assets throw `E_PROP_ASSET` with the URL. Missing authored support admits no decoration. Unknown planting kinds are skipped. Same inputs give the same placements.

## Review

[Review page](preview/CONTRACT.md): `/src/game/props/preview/` shows every model and authored service pockets in daylight or night.

## Assets

`node src/game/props/install.mjs --source <downloads>` installs catalog GLBs under `$URBE_MODELS_DIR/street-props`; the default model root is `~/models/quaternius`. `--check` audits installed files. Source models and their embedded license metadata stay local. Native PBR sources and requests live in Materials `sources/street-props` and `batch/cyberpunk/street-props`.

## Dependencies

[Atlas](../../../../atlas/CONTRACT.md), [Connections](../../../../connections/CONTRACT.md), [Ground](../ground/CONTRACT.md), [Materials](../../../../materials/CONTRACT.md), [material factory](../../building/CONTRACT.md).
