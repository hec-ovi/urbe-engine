# Street props

Takes authored city land and models, returns sparse street arrangements, ornaments, trees and guardrails.

## Input

- `await new Dressing(atlas, walk, factory, options?).build()` creates the complete static view.
- `await new Dressing(atlas, walk, factory, options?).stream(settings?)` creates [spatial rendering and collision ports](stream.d.ts). Owner cells default to 128 m, visibility to 900 m and collision to 256 m. Settings and ports persist across updates; same-cell calls share pending work and a newer window cancels obsolete admission.
- Atlas [blueprint](../../../../atlas/schema/blueprint.ts): parcels, streets, planting, ground cover and station reservations.
- Connections [walk graph](../../../../connections/schemas/networks.schema.json): full widths and elevated `path3`.
- Materials [factory](../../building/CONTRACT.md): `build(key, variantId)`.
- [Options](options.schema.json): optional `loadAsset(url) -> Promise<{scene}>` replaces GLTFLoader transport; `obstacles: [{footprint,bottom,top}]` reserves already-built fixture volumes.
- [Catalog](catalog.json), [schema](catalog.schema.json): model sources, metre dimensions and materials. [Arrangements](arrangements.json), [schema](arrangements.schema.json): site frequency and supported delivery/refuse slots.

## Output

[Static result schema](result.schema.json) describes counts, placements and scene identities. `group` contains instanced material parts in 64 m cells. `colliders` is a Map of position-only triangle geometry for solid props and tree trunks. `dispose()` releases owned geometry, imported textures and material clones, retaining factory resources.

A stream retains the same source-ordered placement plan and global clearance decisions. Nearby cells share one instanced batch per model, finish and material part across the visible window. Full source geometry and authored finishes remain shared in one model cache. Instance updates yield between complete material batches after 4 ms of work; the longest measured slice is reported in `stats.maxWorkMs`. Only nearby cells expand their exact model collider triangles, in arrays of at most 2,048 triangles, through Physics `addBand` and `dropBand`. Rendering and collision radii are independent. Eviction releases instance buffers and local collision; disposal releases owned model resources after pending preparation settles. `counts` describes the complete plan; `stats` reports resident placements, ready collision and actual material-part draws. Initial updates can attach preparation and collision ports later.

Cardboard cartons have folded flaps and tape; wooden crates have separate boards and braces. Four dark molded-plastic variants have grip openings, reinforced rims, latches or loose lids, measured dents and twisted walls. Continuous polymer grain covers the body; a fitted scuffed panel adds localized wear. Placement and collision use the deformed bounds. Downloaded bags, dumpsters and containers retain their authored geometry. Container variants have physical ribs, framing and door hardware. Carton tape and label details share one vertex-colored material part. Trees use Atlas tree anchors, with measured crown bounds and trunk collision.

## Placement

The seed selects refuse, delivery and service-yard arrangements. Slots vary their spacing, angle, finish and presence within catalog limits; stacked items remain supported. Facade stations use uneven intervals. Utility cabinets, worn benches and memorial fixtures occupy the same checked pockets. Whole footprints must fit equal-height authored land, clear buildings, door aprons, street fixtures, walk widths and station reservations. Large containers require block/open land and are never shrunk to fit. A failed arrangement is omitted atomically. Trees reserve their trunk at ground level and their crown against buildings; low foliage also clears pedestrian paths.

Procedural props have three shared finishes with independently placed grain and localized wear. Exact panel UVs retain their full artwork. Every placement reports its finish. Guardrails consume Atlas module placements, retaining their posts, bars, metre extents and quarter turns; open, braced and slatted infill variants stay within the authored envelope. Rails reserve that envelope against loose props and use their visible triangles for collision. No module records means no rails.

`E_PROP_STREAM` rejects invalid cell size, window parameters or updates after disposal. Preparation and collision errors propagate; subsequent updates can retry.

Missing or malformed model assets throw `E_PROP_ASSET` with the URL. Missing authored support admits no decoration. Unknown planting kinds are skipped. Same inputs give the same placements.

## Review

[Review page](preview/CONTRACT.md): `/src/game/props/preview/` shows every model and authored service pockets in daylight or night.

## Assets

`node src/game/props/install.mjs --source <downloads>` installs catalog GLBs under `$URBE_MODELS_DIR/street-props`; the default model root is `~/models/quaternius`. `--check` audits installed files. Source models and their embedded license metadata stay local. Native PBR sources and requests live in Materials `sources/street-props` and `batch/cyberpunk/street-props`.

## Dependencies

[Atlas](../../../../atlas/CONTRACT.md), [Connections](../../../../connections/CONTRACT.md), [Ground](../ground/CONTRACT.md), [Materials](../../../../materials/CONTRACT.md), [material factory](../../building/CONTRACT.md), [Physics band admission](../physics/schema/band-admission.d.ts).
