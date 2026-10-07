# Street props

Takes authored city land and models, returns sparse street arrangements, ornaments, trees and guardrails.

## Input

- `await new Dressing(atlas, walk, factory, options?).build()` creates the complete static view.
- `await new Dressing(atlas, walk, factory, options?).stream(settings?)` creates [spatial rendering and collision ports](stream.d.ts). Owner cells default to 128 m, visibility to 900 m and collision to 256 m. Settings and ports persist across updates; same-cell calls share pending work and a newer window cancels obsolete admission.
- Atlas [blueprint](../../../../atlas/schema/blueprint.ts): parcels, streets, planting, ground cover and station reservations.
- Connections [walk graph](../../../../connections/schemas/networks.schema.json): full widths and elevated `path3`.
- Materials [factory](../../building/CONTRACT.md): `build(key, variantId)`.
- [Options](options.schema.json): optional `loadAsset(url) -> Promise<{scene}>` replaces GLTFLoader transport; `obstacles: [{footprint,bottom,top}]` reserves already-built fixture volumes. `replacedModuleOwnerIds` excludes exactly those Atlas owners from authored rail construction. Original Atlas land remains available for prop clearance; native street features enter through obstacle volumes.
- [Catalog](catalog.json), [schema](catalog.schema.json): model sources, metre dimensions and materials. [Arrangements](arrangements.json), [schema](arrangements.schema.json): site frequency and supported delivery/refuse slots.
- `new ImportedModels(loadAsset?, baseUrl?).load(spec)` reads `<baseUrl>/<spec.file>`, `/models/street-props` by default, and accepts one catalog asset and returns normalized `{geometry, material, tintable}` mesh parts. Tree origins stay at their authored root; every model rests at Y=0. Original maps remain attached. `dispose()` releases all loaded geometry, cloned/source materials, maps and decoded images; callers await pending loads first. The [asset-loader schema](asset-loader.d.ts) defines these ports.

## Output

[Static result schema](result.schema.json) describes counts, placements and scene identities. `group` contains instanced material parts in 64 m cells. `colliders` is a Map of position-only triangle geometry for solid props and tree trunks. `dispose()` releases owned geometry, imported textures and material clones, retaining factory resources.

A stream retains the same source-ordered placement plan and global clearance decisions. The visible window draws every prop as a copy in one batch per material and vertex layout, the kit's own batching ([MaterialBatches](../city/kit/MaterialBatches.js)): a model and finish joins the batches once, the first time the window holds it, each part's geometry in the batch of the material it wears, and each placement is a copy at its matrix, tinted on the parts that take a tint and white on the others, culled on its own sphere. Parts that wear one material with another vertex layout go to a batch of their own, so no attribute is rewritten. Within that window a prop is drawn only out to 372 m per metre of its height, where it still stands two pixels tall on a 1080-line screen, plus the owner cell's diagonal, because the window moves only when the player leaves that cell: a bag or a carton a few hundred metres off is left out, a tree never. A batch a model brings goes through the `prepare` port, held out of the scene, before it first draws; the batches grow inside the buffers their draws read, so more copies or more models never build a draw again, and a model the window leaves keeps its geometry in them for the window that finds it again. Full source geometry and authored finishes remain shared in one model cache. Admitting copies yields to the frame budget every 64 copies once 4 ms are spent; the longest measured slice is reported in `stats.maxWorkMs`. Only nearby cells expand their exact model collider triangles, in arrays of at most 2,048 triangles, through Physics `addBand` and `dropBand`. Rendering and collision radii are independent. Eviction takes the window's copies out of the batches and releases local collision; disposal releases owned model resources after pending preparation settles. `counts` describes the complete plan; `stats` reports resident placements, ready collision and actual material-part draws. Initial updates can attach preparation and collision ports later.

A tarp lean-to hangs from a pole-held rope over a bedroll on cardboard; a food cart has wheels, a steel counter, an awning on four poles and a sign board; an oil drum has rolling hoops and a dark lid. Cardboard cartons have folded flaps and tape; wooden crates have separate boards and braces. Four dark molded-plastic variants have grip openings, reinforced rims, latches or loose lids, measured dents and twisted walls. Continuous polymer grain covers the body; a fitted scuffed panel adds localized wear. Placement and collision use the deformed bounds. Downloaded bags, dumpsters and containers retain their authored geometry. Container variants have physical ribs, framing and door hardware. Carton tape and label details share one vertex-colored material part. Trees use Atlas sidewalk and median tree anchors, with measured crown bounds and trunk collision. Median trees reuse the installed tree catalog and retain the same land/obstacle admission.

## Placement

The seed selects refuse, delivery and service-yard arrangements, and at the feet of highway piers with 4 m of headroom (a site off each face, chance 0.55) a camp under a tarp lean-to, a food cart, a hoard on a pallet or a shrine, with oil drums, cartons, bags and litter; an underpass site stands on whatever ground is under the deck, the carriageway included. Slots vary their spacing, angle, finish and presence within catalog limits; stacked items remain supported. Facade stations use uneven intervals. Utility cabinets, worn benches and memorial fixtures occupy the same checked pockets. Whole footprints must fit equal-height authored land, clear buildings, door aprons, street fixtures, walk widths and station reservations. Large containers require block/open land and are never shrunk to fit. A failed arrangement is omitted atomically. Trees reserve their trunk at ground level and their crown against buildings; low foliage also clears pedestrian paths.

Procedural props have three shared finishes with independently placed grain and localized wear. Exact panel UVs retain their full artwork. Every placement reports its finish. Guardrails consume Atlas module placements, retaining their posts, bars, metre extents and quarter turns; open, braced and slatted infill variants stay within the authored envelope. Rails reserve that envelope against loose props and use their visible triangles for collision. No module records means no rails.

`E_PROP_STREAM` rejects invalid cell size, window parameters or updates after disposal. Preparation and collision errors propagate; subsequent updates can retry.

Missing or malformed model assets throw `E_PROP_ASSET` with the URL. Missing authored support admits no decoration. Unknown planting kinds are skipped. Same inputs give the same placements.

## Review

[Review page](preview/CONTRACT.md): `/src/game/props/preview/` shows every model and authored service pockets in daylight or night.

## Assets

`node src/game/props/install.mjs --source <downloads>` installs catalog GLBs under `$URBE_MODELS_DIR/street-props`; the default model root is `~/models/quaternius`. `--check` audits installed files. Source models and their embedded license metadata stay local. Native PBR sources and requests live in Materials `sources/street-props` and `batch/cyberpunk/street-props`.

## Dependencies

[Atlas](../../../../atlas/CONTRACT.md), [Connections](../../../../connections/CONTRACT.md), [Ground](../ground/CONTRACT.md), [Materials](../../../../materials/CONTRACT.md), [material factory](../../building/CONTRACT.md), [Physics band admission](../physics/schema/band-admission.d.ts).
