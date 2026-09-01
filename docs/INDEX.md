# Box map

- root box: see CONTRACT.md.
- `src/assembly/`: world-assembly slice; atlas parcel + connections apertures -> exterior BuildingRequest, CLI drives exterior to GLB + blueprint and, with --interior, interior to the filled building (src/assembly/CONTRACT.md). Depends on ../atlas, ../connections, ../exterior, ../interior contracts.
- `src/building/`: building viewer logic; loads out/<parcel>/ GLBs, resolves material keys against ../materials' theme database (MaterialResolver), builds PBR materials with world-scale tiling and transmission (PbrMaterialFactory), TSL floor slice (FloorSlicer), orbit stage. Open with `npm run dev` then `/?mode=building&parcel=<id>`; unresolved keys render magenta and are listed. The vite config serves the materials database read-only under /materials/.

## Scale experiment (docs/RESEARCH.md 9)

Vite app measuring three interchangeable renderings of one seeded placeholder city. Run `npm run dev`, pick variant, count (1k-50k), backend; results panel exports JSON.

- `src/city/`: seeded deterministic city data, pure JS, no rendering types (Rng, archetypes, CityGenerator + its test)
- `src/scene/`: shared stage (ArchetypeGeometries with meshopt LOD chains, SceneBuilder: lights, ground, orbit camera)
- `src/variants/`: the three contenders behind one Variant interface (MeshVariant, BatchedVariant, IndirectVariant with TSL compute cull/LOD into indirect draws, createVariant)
- `src/app/`: run wiring (App, RunConfig via URL query, RendererFactory, Metrics)
- `src/ui/`: overlay only; views/ExperimentView + BuildingView, widgets/ControlsPanel + ResultsPanel + BuildingControlsPanel + MaterialReportPanel, components/ primitives and styles

Dependency direction: ui -> app -> variants -> scene -> city.
