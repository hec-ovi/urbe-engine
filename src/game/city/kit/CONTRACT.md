# Kit runtime

Draws every ordinary building from the shared plan it is a copy of: one batch per material the plans wear, cuboid colliders per building, cells streamed by distance.

## In

- The world's plan index `kit.json` and the plan shells it names, which every city shares from `/out/shared/`, loaded once through the city GLTF loader. `KitPieces({ kit, baseUrl, factory, loader?, readBinary?, readJson? })` starts that load, `baseUrl` being the store root the index's paths are relative to; `ready` resolves when every plan is standing.
- Per building `<out>/<parcel>/<parcel>.placements.json`: the id of the plan it is a copy of, `origin` and `rotationY`, plus `parcel`, `family`, `floors`, `signText`, `lot`, `bounds` and `tint`. Under a kilobyte. All of a cell's records are read at once, eight requests deep.
- Per distinct building `<store>/plans/<hash>/<plan>.glb` and `<plan>.blueprint.json`, in the plan's own metres with its origin at zero and face 0 along +X. A city has a hundred or so plans and hundreds of buildings, so each one is read once for the whole city.
- The building blueprint, which `BuildingSource` composes from the plan's and the record's frame, and which is where the doors and the colliders read every opening.
- `BuildingSource` entries with `source: "kit"` and `placementsUrl`. Anything else stays a landmark shell and loads through `BuildingsLoader`.
- The shared PBR factory for plan materials and `WorldColliders.addBoxes` for collision.

## Out

- `KitPieces`: one batch per material for the whole city, in `group`. `batchCount` is that number and admitting cells never adds to it. `admit` appends one instance per surface, each naming the geometry that surface was registered as and the copy's world matrix, and `release` takes exactly those back out. `reserve(planIds)` grows every batch a cell will touch in one reallocation before the first copy; a batch that still runs out doubles. A plan's street entrance leaves are a batch entry of their own, so a parcel that swings them leaves the shared copies out.
- `MaterialBatches` ([MaterialBatches.js](MaterialBatches.js)) is the batching itself, and the street kit and the room modules use the same class. It takes entries of `{ id, surfaces: [{ bucket, geometry, material, castShadow? }] }`, gives each material a `BatchedMesh` holding exactly the vertices and indices of the primitives that wear it, and answers `admit`, `release`, `reserve`, `batchCount`, `instanceCount` and `copies`. Geometries are prepared first ([BatchGeometry.js](BatchGeometry.js)): a primitive holding vertices it does not draw, or sharing its buffer with the primitives beside it, is compacted to the vertices it draws; a bucket that mixes indexed with non indexed primitives gives the non indexed ones their own index, because a batch is indexed or not as a whole; and a batch has one buffer per attribute, so an attribute the geometries quantize differently, or one that only some of them carry, becomes plain floats across the batch. A caller that hands over loader primitives untouched gets all three.
- `KitCellLoader.load(sources)` returns the shell loader's result: `group`, `doors`, `entrances`, `shellColliders` (empty for kit parcels), `centers`, `triangles` and `disposeModelInstances`, plus `boxColliders` for the cell. The copies enter the shared batches when the stream turns that group visible, which is after the skyline stops carrying the cell's impostors, so no building is ever drawn twice; a cell dropped before it is shown draws nothing at all. Dropping a cell calls that disposer, which takes exactly this cell's copies back out.
- `boxColliders`: per building, its four lot walls by envelope height, a cap over the roof, and the entrance leaf as its own cuboid when nothing is going to move it. A wall is cut into piers, sills and lintels around every passable opening the blueprint carries: the street entrance, and every door, balcony door, open front and aperture behind it. Openings that meet become one hole. The cap is cut around the stair head the blueprint's roof bulkhead reserves. Windows stay solid. No trimesh and no cooking.
- Doors from the blueprint, through the same `DoorGeometry` frames a generated shell publishes: hinge, along, normal, centre, outside, inside, width, height and pivots. A parcel with an interior gets the street entrance's leaves as its own pivots, posed from the plan's, so `Interactor`, `DoorMotion` and `DoorColliders` run unchanged; a closed parcel draws those leaves with its shell and keeps them solid.
- Source centres from the lot centre, which is what interior residency and room culling measure from.

## Rules

- Streaming radii for kit cells: load within 384 m, keep within 640 m, skyline beyond, matching the shell stream.
- A plan shell is drawn as a closed building: the fake rooms behind its glass stand with the room's own light baked in, because the geometry is shared and most of its copies have no interior.
- A facade stands behind its lot line, by a metre on some families and by three and a half on others, so an opening is matched to the lot wall it faces rather than to the one it touches.
- A batch is a three `BatchedMesh`, which serves both backends. WebGPU has no multi-draw, so it loops one indexed draw per visible copy inside the batch's single pipeline and bind group; WebGL2 uses `WEBGL_multi_draw`, or the per-draw fallback where the extension is missing. What the batch saves is the pipeline and the per-mesh render object, not the draw command.
- A batch that grows, and a batch taking its first coloured copy, gets new instance buffers, and a draw already built reads the ones it was built from. Both dispose the batch material, which is what makes the renderer build the draws again, in the shadow pass as well as the colour pass; the material keeps drawing unchanged.
- Kit batches cast and receive shadows. The batch object is not frustum tested, because one sphere over every copy in the city can only answer "visible"; each copy is tested instead, against the geometry it draws. Opaque batches do not sort.
- Per-copy variety is the instance colour the record's tint seed hashes to inside its family's tint range, which multiplies the plan's own albedo. Never a unique geometry.
- Landmark parcels in the same cell still load their own shell through the original path, and both results merge into one cell.

## Errors

`E_KIT_PIECES` (a plan file is missing, fails to decode, or differs from the length and hash the index publishes for it), `E_KIT_PLACEMENT` (a record names a plan this world does not publish, or a building has no lot extent or envelope height). A failed cell releases every copy it had already appended.

## Depends on

Kit assembly output, [City GLTF loader](../../data/CityGltfLoader.js), [shell streaming](../streaming/CONTRACT.md), [door geometry](../DoorGeometry.js), [shell surfaces](../ShellSurface.js), [PBR factory](../../../building/CONTRACT.md), [Physics](../../physics/CONTRACT.md).
