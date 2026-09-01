# Box map

- root box: see CONTRACT.md.
- `src/assembly/`: first world-assembly slice; atlas parcel + connections apertures -> exterior BuildingRequest, CLI drives exterior to GLB + blueprint (src/assembly/CONTRACT.md). Depends on ../atlas, ../connections, ../exterior contracts.

## Scale experiment (docs/RESEARCH.md 9)

Vite app measuring three interchangeable renderings of one seeded placeholder city. Run `npm run dev`, pick variant, count (1k-50k), backend; results panel exports JSON.

- `src/city/`: seeded deterministic city data, pure JS, no rendering types (Rng, archetypes, CityGenerator + its test)
- `src/scene/`: shared stage (ArchetypeGeometries with meshopt LOD chains, SceneBuilder: lights, ground, orbit camera)
- `src/variants/`: the three contenders behind one Variant interface (MeshVariant, BatchedVariant, IndirectVariant with TSL compute cull/LOD into indirect draws, createVariant)
- `src/app/`: run wiring (App, RunConfig via URL query, RendererFactory, Metrics)
- `src/ui/`: overlay only; views/ExperimentView, widgets/ControlsPanel + ResultsPanel, components/ primitives and styles

Dependency direction: ui -> app -> variants -> scene -> city.
