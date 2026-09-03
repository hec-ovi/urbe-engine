# CONTRACT: game hydrology adapter

## Purpose

Turns an optional Atlas hydrology plan into exact render geometry and a physics handoff without owning terrain, player movement, or crossing construction.

## Inputs

- Atlas hydrology plan: [schema/hydrology-plan.schema.json](schema/hydrology-plan.schema.json). `HydrologyAdapter.build(blueprint, materials)` reads only `blueprint.hydrology`. An absent field is the no-water case.
- Material bindings: [schema/material-bindings.schema.json](schema/material-bindings.schema.json). `materials` supplies `{ factory, bindings }`; each Atlas material key in use must map to a tiled materials-database key and optional variant. The factory's resolver must resolve that exact key before any material is built. The resolved entry must satisfy the adapter's required subset of the materials contract: [schema/water-material.schema.json](schema/water-material.schema.json).
- Runtime update: [schema/update.schema.json](schema/update.schema.json). `runtime.update({ elapsedSeconds })` takes absolute elapsed run time so normal-map motion is independent of frame rate.

## Outputs

- Hydrology handoff: [schema/handoff.schema.json](schema/handoff.schema.json). `runtime.handoff` is JSON data naming every exact water polygon, shoreline-band polygon, published elevation and depth, resolved material, deterministic motion/reflection parameters, ground exclusion, and unchanged Atlas bridge/tunnel record.
- Runtime objects: [schema/runtime-summary.schema.json](schema/runtime-summary.schema.json). A water plan returns `{ group, handoff, update, dispose, summary }`; `group` contains Three.js meshes at the published elevations. The JSON `summary` reports object and triangle counts. No hydrology returns `null`, builds no geometry, resolves no material, and schedules no updates.

## Events

- `update` scrolls only each owned normal-map clone. It does not move collision data or surface vertices.
- `dispose` releases every owned geometry, material, and cloned normal map. It is idempotent. Updating after disposal fails closed.
- The later host adds `group` to the scene, sends `handoff.groundExclusions` to player/ground collision policy, and dispatches `handoff.crossings` to bridge/tunnel construction owners.

## Errors

- `E_HYDRO_INPUT`: malformed JSON input, non-finite data, duplicate identity, wrong winding, self-intersection, non-watertight shoreline, or invalid update time.
- `E_HYDRO_MATERIAL`: a binding is absent, unresolved, non-tiled, missing required PBR maps, or the factory returns an unresolved/non-cloneable material.
- `E_HYDRO_GEOMETRY`: an accepted polygon cannot be triangulated into a finite upward-facing surface.
- `E_HYDRO_OUTPUT`: the produced JSON handoff or runtime summary violates its schema.
- `E_HYDRO_DISPOSED`: `update` is called after disposal.

## Dependencies

- Atlas hydrology output contract and schema.
- Materials `MaterialResolver` and `PbrMaterialFactory` boundary.
- Three.js WebGPU-compatible core materials and geometry; the same objects run on WebGL2 fallback.
- Game ground and lighting contracts consume the handoff later. This layer does not import their internals.

## Invariants

- Input polygon coordinates, order, elevation, depth, material key, crossing path, width, and level survive unchanged in the handoff.
- Water and shoreline triangles face +Y, stay inside their source polygon bounds, and use world-metre UVs. No bathymetric bottom or inferred bank geometry is created.
- Motion is deterministic from Atlas `seedId` and hydrology type. It is one scrolling normal-map transform per material, with no render pass, reflection camera, backend branch, or frame-rate accumulation.
- Water meshes never enter the collider output. Every water surface is instead an explicit ground exclusion, while Atlas crossings remain explicit bridge/tunnel handoffs.
- A missing material never becomes the material factory's fallback.

## How to modify this blackbox safely

Read only this folder plus the Atlas, materials, ground, and lighting contracts. Update the schemas and fixtures with every payload change. Run this folder's tests, then the full engine tests and build. Host integration belongs outside this layer.
