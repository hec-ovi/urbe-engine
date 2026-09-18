# Kit runtime

Draws every kit building from shared pieces: one instanced draw per piece surface, cuboid colliders per building, cells streamed by distance.

## In

- `<out>/kit/kit.json` and its piece GLBs, loaded once per city through the city GLTF loader. `KitPieces({ kit, baseUrl, factory, loader?, readBinary? })` starts that load; `ready` resolves when every piece is standing.
- Per building `<out>/<parcel>/<parcel>.placements.json`: Exterior's own plan under `plan`, plus `parcel`, `family`, `baysAcross`, `baysDeep`, `floors`, `footprint`, `bounds` and the `transform` (`{position: [x,y,z], rotationY}`) that puts the plan's lot frame on the parcel. A bare plan reads the same way. All of a cell's tables are read at once, eight requests deep. The building blueprint stays in its own `<parcel>.blueprint.json`, which the building source already carries, and is where the colliders read every opening past the street entrance.
- `BuildingSource` entries with `source: "kit"` and `placementsUrl`. Anything else stays a landmark shell and loads through `BuildingsLoader`.
- The shared PBR factory for piece materials and `WorldColliders.addBoxes` for collision.

## Out

- `KitPieces`: piece geometries and factory materials keyed by the kit's piece id, and one `InstancedMesh` per piece surface for the whole city, in `group`. Every surface of a piece reads one shared matrix and colour buffer, and each write names the slots it touched, so a cell uploads its own copies instead of the city's. Capacity grows by reallocation when a cell wants more copies than the buffers hold. Six families give 204 draws: 198 shared surfaces plus the six entrance leaf pairs a closed building draws with its piece. Admitting cells never adds a draw.
- `KitCellLoader.load(sources)` returns the shell loader's result: `group`, `doors`, `entrances`, `shellColliders` (empty for kit parcels), `centers`, `triangles` and `disposeModelInstances`, plus `boxColliders` for the cell. The copies enter the shared draws when the stream turns that group visible, which is after the skyline stops carrying the cell's impostors, so no building is ever drawn twice; a cell dropped before it is shown draws nothing at all. Dropping a cell calls that disposer, which takes exactly this cell's instances back out by swapping the last copy into each freed slot.
- `boxColliders`: per building, its four footprint walls by envelope height, a cap over the roof, and the door leaf as its own cuboid when nothing is going to move it. A wall is cut into piers, sills and lintels around every opening it carries: the entrance from the placement table, and from the blueprint every door, balcony door, open front and aperture the interior reserves. Openings that meet become one hole. The cap is cut around the stair head the blueprint's roof bulkhead reserves. A building with only its entrance is eight cuboids, seven when it swings its own door. Windows stay solid. No trimesh and no cooking.
- Doors and entrances from the placement table's door record, in the frame `DoorGeometry` publishes: hinge, along, normal, centre, outside, inside, width, height and pivots. A parcel with an interior gets the entrance bay's addressable leaves as its own pivots, so `Interactor`, `DoorMotion` and `DoorColliders` run unchanged; a closed parcel draws those leaves with its piece and keeps them solid.
- Source centres from the lot centre, which is what interior residency and room culling measure from.

## Rules

- Streaming radii for kit cells: load within 384 m, keep within 640 m, skyline beyond, from the shell catalog as today.
- Kit draws cast and receive shadows. Their frustum culling is off: one bounding sphere would have to cover every copy in the city, so the test can only answer "visible" and rebuilding it on each admission buys nothing.
- Per-instance variety is the instance colour a parcel id hashes to inside its family's tint range, which multiplies the piece's own albedo. Never a unique geometry.
- Landmark parcels in the same cell still load their own shell through the original path, and both results merge into one cell.

## Errors

`E_KIT_PIECES` (a piece file is missing, fails to decode, or differs from the length and hash `kit.json` publishes for it), `E_KIT_PLACEMENT` (a table places a piece the kit lacks, has no pieces, lot extent or envelope height, or names a leaf count its entrance piece does not have). A failed cell releases every instance it had already appended.

## Depends on

Kit assembly output, [City GLTF loader](../../data/CityGltfLoader.js), [shell streaming](../streaming/CONTRACT.md), [PBR factory](../../../building/CONTRACT.md), [Physics](../../physics/CONTRACT.md).
