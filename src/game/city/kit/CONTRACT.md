# Kit runtime

Draws every kit building from shared pieces: one instanced draw per piece surface, cuboid colliders per building, cells streamed by distance.

## In

- `<out>/kit/kit.json` and its piece GLBs (quantized, meshopt-compressed), loaded once per city through the city GLTF loader.
- Per building `<parcel>.placements.json` and `<parcel>.blueprint.json` from Kit assembly, admitted per 128 m cell by the shell stream.
- The shared PBR factory for piece materials and the physics port for colliders.

## Out

- `KitPieces`: piece geometries and materials, keyed by family and piece id; disposed with the city.
- `KitCells`: for each resident cell, instance matrices appended to the piece draws; dropping a cell removes its instances. One `InstancedMesh` per piece surface city-wide, so draw count stays near the number of distinct piece surfaces (about 300 for seven families) and does not grow with the city.
- Colliders per building: one fixed body per cell holding a cuboid compound per building (footprint by envelope height, split at the entrance bay into two jambs and a lintel), and the door leaf as its own cuboid from the blueprint door record. No trimesh for kit buildings.
- Sign anchors, doors, entrances and lit-window positions read from the placement table and blueprint, so Neon, LitWindows and DoorColliders work unchanged.

## Rules

- Streaming radii for kit cells: load within 384 m (3 x 3 cells), keep within 640 m (5 x 5), skyline massing beyond, from the shell catalog as today.
- Shadows: kit draws cast shadows only within the load radius; the skyline never casts.
- Per-instance variety is instance color and per-family material tier; never a unique geometry.
- Landmark parcels still load their own shell through the original path.

## Errors

`E_KIT_PIECES` (piece file missing, fails to decode or differs from its manifest hash), `E_KIT_PLACEMENT` (a placement names a piece the kit lacks).

## Depends on

Kit assembly output, City GLTF loader, shell streaming, PBR factory, Physics.
