# Shell streaming

Loads nearby original building shells and draws distant massing from the published shell catalog.

## Input and output

[Settings and ports](schema/stream.d.ts) describe the public API. Assembly owns the [source catalog](../../../assembly/schema/shell-catalog.schema.json).

`ShellStream` takes a validated catalog, material factory, initial building sources and an asynchronous building-source loader. `load(position)` returns the city shell group, doors, entrances, collider geometries and source centers. `update(position)` schedules nearby cells after 16 m of movement; `settled()` waits for current admission. Every selected interior remains resident. Other cells load within 250 m and drop beyond 350 m, measured against their complete XZ bounds. A world assembled from the piece kit loads within 384 m and drops beyond 640 m: its cells cost instance matrices and cuboids rather than merged geometry and cooked triangles, so a wider window is cheaper than a narrower one of shells.

An optional `prepare(cell)` port prepares rendering and collision before a cell becomes visible. `added(cell)` and `removed(cell)` bind and release host resources. Cells load serially. Stale work is released without becoming visible. Errors reach `onError` and preserve the distant source geometry.

Bands with `topOutline` connect their lower and upper vertices as sloping faces; their caps use the upper outline.

Distant walls and roofs within 1,100 m use exact catalog outlines, elevations and material bindings, merged by material across the visible window. Original shell cells replace their distant counterpart only after complete admission. Dropping a cell restores its distant representation and releases its geometry and noninterior source documents. Factory materials remain shared.

The optional loader port follows `BuildingsLoader.load(sources)`. A cell is admitted with its group hidden and turns visible once the rebuilt skyline no longer carries it, so a port whose draws live outside the cell group waits for that flag before it draws anything. [KitCellLoader](../kit/CONTRACT.md) is that port for a kit world: it appends kit parcels as copies into city-owned material batches when the stream shows that cell, hands landmark parcels to the original GLB loader, and adds `boxColliders` for the cell. `ShellScene` gives that whole cell to `WorldColliders.addBoxes` as one fixed body and releases it by cell id on eviction.

`dispose()` cancels pending work and releases owned geometry. Loaded sources must match the requested catalog IDs. Invalid distances or positions throw `E_SHELL_SETTINGS` or `E_SHELL_POSITION`; source mismatches report `E_SHELL_SOURCE`. Failed initial admission rejects `load` with `E_SHELL_LOAD`. Later loading and preparation failures report through `onError` and keep distant geometry. The optional loader port follows BuildingsLoader's public result and defaults to the original GLB loader.

Release also disposes materials marked `ownedScenicMaterial`; shared factory materials and their maps remain alive. Kit pieces are city-owned: a cell release takes its instances out of the shared draws and never disposes their geometry.
Building model groups call their cell-owned disposer before shell traversal, including cancelled admission, preparation failure and eviction. Their imported textures and instance buffers are released with their geometry.

## Dependencies

Assembly shell catalog, City BuildingsLoader, [Kit runtime](../kit/CONTRACT.md), shared PBR factory and Three.js.
