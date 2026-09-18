# Kit runtime

Draws every kit building from shared pieces and a plan the city repeats: one batch per material the kit wears, cuboid colliders per building, cells streamed by distance.

## In

- The piece kit `kit.json` and its GLBs, which every city shares from `/out/shared/kit/<hash>/`, loaded once through the city GLTF loader. `KitPieces({ kit, baseUrl, factory, loader?, readBinary? })` starts that load; `ready` resolves when every piece is standing.
- Per building `<out>/<parcel>/<parcel>.placements.json`: the id of the plan it stands from, `origin`, `rotationY` and `face` (where that plan's origin stands, how far it is turned and which lot face it fronts), plus `parcel`, `family`, `floors`, `floorKinds`, `exteriorStyle`, `signText`, `lot`, `bounds` and `tint`. Under a kilobyte. All of a cell's records are read at once, eight requests deep.
- Per distinct building `<out>/kit/plans/<plan>.json`: every piece of it in its own metres, origin at zero and face 0 along +X, with `pieces` naming each file once and a copy carrying its index. A city has a few dozen plans and thousands of buildings, so each plan is read once and every cell that wants it waits on that read. The world matrix of a copy is the parcel's frame times the plan's placement.
- The building blueprint, which `BuildingSource` carries as it always did and now composes from `<out>/kit/plans/<plan>.blueprint.json` and the record's frame, and which is where the colliders read every opening past the street entrance.
- `BuildingSource` entries with `source: "kit"` and `placementsUrl`. Anything else stays a landmark shell and loads through `BuildingsLoader`.
- The shared PBR factory for piece materials and `WorldColliders.addBoxes` for collision.

## Out

- `KitPieces`: piece geometries and factory materials keyed by the kit's piece id, and one batch per material for the whole city, in `group`. `batchCount` is that number and admitting cells never adds to it. Six families wear 15 materials over 204 piece surfaces: the 198 shared ones plus the six entrance leaf pairs a closed building draws with its piece. `admit` appends one instance per surface, each naming the geometry that surface was registered as and the copy's world matrix, and `release` takes exactly those back out. `reserve(pieceIds)` grows every batch a cell will touch in one reallocation before the first copy; a batch that still runs out doubles.
- `MaterialBatches` ([MaterialBatches.js](MaterialBatches.js)) is the batching itself, and the street kit and the room modules use the same class. It takes entries of `{ id, surfaces: [{ bucket, geometry, material, castShadow? }] }`, gives each material a `BatchedMesh` holding exactly the vertices and indices of the primitives that wear it, and answers `admit`, `release`, `reserve`, `batchCount`, `instanceCount` and `copies`. Geometries are prepared first ([BatchGeometry.js](BatchGeometry.js)): a primitive holding vertices it does not draw, or sharing its buffer with the primitives beside it, is compacted to the vertices it draws; a bucket that mixes indexed with non indexed primitives gives the non indexed ones their own index, because a batch is indexed or not as a whole; and a batch has one buffer per attribute, so an attribute the geometries quantize differently, or one that only some of them carry, becomes plain floats across the batch. A caller that hands over loader primitives untouched gets all three.
- `KitCellLoader.load(sources)` returns the shell loader's result: `group`, `doors`, `entrances`, `shellColliders` (empty for kit parcels), `centers`, `triangles` and `disposeModelInstances`, plus `boxColliders` for the cell. The copies enter the shared batches when the stream turns that group visible, which is after the skyline stops carrying the cell's impostors, so no building is ever drawn twice; a cell dropped before it is shown draws nothing at all. Dropping a cell calls that disposer, which takes exactly this cell's copies back out.
- `boxColliders`: per building, its four lot walls by envelope height, a cap over the roof, and the door leaf as its own cuboid when nothing is going to move it. A wall is cut into piers, sills and lintels around every opening it carries: the entrance from the plan, and from the blueprint every door, balcony door, open front and aperture the interior reserves. Openings that meet become one hole. The cap is cut around the stair head the blueprint's roof bulkhead reserves. A building with only its entrance is eight cuboids, seven when it swings its own door. Windows stay solid. No trimesh and no cooking.
- Doors and entrances from the plan's door record, turned into this building's frame, in the frame `DoorGeometry` publishes: hinge, along, normal, centre, outside, inside, width, height and pivots. A parcel with an interior gets the entrance bay's addressable leaves as its own pivots, so `Interactor`, `DoorMotion` and `DoorColliders` run unchanged; a closed parcel draws those leaves with its piece and keeps them solid.
- Source centres from the lot centre, which is what interior residency and room culling measure from.

## Rules

- Streaming radii for kit cells: load within 384 m, keep within 640 m, skyline beyond, from the shell catalog as today.
- A batch is a three `BatchedMesh`, which serves both backends. WebGPU has no multi-draw, so it loops one indexed draw per visible copy inside the batch's single pipeline and bind group; WebGL2 uses `WEBGL_multi_draw`, or the per-draw fallback where the extension is missing. What the batch saves is the pipeline and the per-mesh render object, not the draw command.
- A batch that grows, and a batch taking its first coloured copy, gets new instance buffers, and a draw already built reads the ones it was built from. Both dispose the batch material, which is what makes the renderer build the draws again, in the shadow pass as well as the colour pass; the material keeps drawing unchanged.
- Kit batches cast and receive shadows. The batch object is not frustum tested, because one sphere over every copy in the city can only answer "visible"; each copy is tested instead, against the geometry it draws. Opaque batches do not sort.
- Per-copy variety is the instance colour the record's tint seed hashes to inside its family's tint range, which multiplies the piece's own albedo. Never a unique geometry.
- Landmark parcels in the same cell still load their own shell through the original path, and both results merge into one cell.

## Errors

`E_KIT_PIECES` (a piece file is missing, fails to decode, or differs from the length and hash `kit.json` publishes for it), `E_KIT_PLACEMENT` (a plan places a piece the kit lacks, has no pieces, lot extent or envelope height, or names a leaf count its entrance piece does not have). A failed cell releases every copy it had already appended.

## Depends on

Kit assembly output, [City GLTF loader](../../data/CityGltfLoader.js), [shell streaming](../streaming/CONTRACT.md), [PBR factory](../../../building/CONTRACT.md), [Physics](../../physics/CONTRACT.md).
