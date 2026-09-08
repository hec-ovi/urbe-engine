# Shell streaming

Loads nearby original building shells and draws distant massing from the published shell catalog.

## Input and output

[Settings and ports](schema/stream.d.ts) describe the public API. Assembly owns the [source catalog](../../../assembly/schema/shell-catalog.schema.json).

`ShellStream` takes a validated catalog, material factory, initial building sources and an asynchronous building-source loader. `load(position)` returns the city shell group, doors, entrances, collider geometries and source centers. `update(position)` schedules nearby cells after 16 m of movement; `settled()` waits for current admission. Every selected interior remains resident. Other cells load within 250 m and drop beyond 350 m, measured against their complete XZ bounds.

An optional `prepare(cell)` port prepares rendering and collision before a cell becomes visible. `added(cell)` and `removed(cell)` bind and release host resources. Cells load serially. Stale work is released without becoming visible. Errors reach `onError` and preserve the distant source geometry.

Distant walls and roofs within 1,100 m use exact catalog outlines, elevations and material bindings, merged by material across the visible window. Original shell cells replace their distant counterpart only after complete admission. Dropping a cell restores its distant representation and releases its geometry and noninterior source documents. Factory materials remain shared.

`dispose()` cancels pending work and releases owned geometry. Loaded sources must match the requested catalog IDs. Invalid distances or positions throw `E_SHELL_SETTINGS` or `E_SHELL_POSITION`; source mismatches report `E_SHELL_SOURCE`. Failed initial admission rejects `load` with `E_SHELL_LOAD`. Later loading and preparation failures report through `onError` and keep distant geometry. The optional loader port follows BuildingsLoader's public result and defaults to the original GLB loader.

## Dependencies

Assembly shell catalog, City BuildingsLoader, shared PBR factory and Three.js.
