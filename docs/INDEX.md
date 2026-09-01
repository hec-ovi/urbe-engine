# Box map

- root box: see CONTRACT.md.
- `src/assembly/`: world-assembly slice; atlas parcel + connections apertures -> exterior BuildingRequest, CLI drives exterior to GLB + blueprint and, with --interior, interior to the filled building; `npm run assemble-city` batches the whole blueprint with a QA report; `npm run simulate` boots the simulation library over the assembled world (src/assembly/CONTRACT.md). Depends on ../atlas, ../connections, ../exterior, ../interior, ../simulation contracts.
- `src/building/`: building viewer logic; loads out/<parcel>/ GLBs, resolves material keys against ../materials' theme database (MaterialResolver), builds PBR materials with world-scale tiling and transmission (PbrMaterialFactory), TSL floor slice (FloorSlicer), orbit stage. Open with `npm run dev` then `/?mode=building&parcel=<id>`; unresolved keys render magenta and are listed. The vite config serves the materials database read-only under /materials/.

- `src/game/`: the playable city (`?mode=game`); first-person controller on Rapier, night scene from the assembled GLBs, ground from the blueprint's cover polygons, neon and lit windows, simulation-driven crowd and lane-graph traffic, doors into continuous interiors (src/game/CONTRACT.md). Depends on ../atlas, ../connections, ../materials, ../simulation contracts.
  - `data/`: run config, world loading, signal state
  - `ground/`: cover polygons to geometry, curbs
  - `city/`: buildings, doors, neon, lit windows, lamps, road paint, interiors cut into rooms and which of them are in view
  - `light/`: every fixture as real light in lumens, clustered or batched by backend, per-room light slots with the computed room fill, air glow (src/game/light/CONTRACT.md)
  - `look/`: quality tiers, AgX exposure, height fog tinted by the light in the air, environment probe, the render pipeline with emissive-selected bloom (src/game/look/CONTRACT.md)
  - `sky/`: night sky, moon key, stars
  - `physics/`: Rapier world, colliders, player capsule
  - `player/`: input, first-person controller, interaction
  - `agents/`: character assets, pose baking, crowd, walk routes, traffic
  - `sim/`: the simulation library host
  - `time/`, `world/`: game clock, district and parcel lookup, map model for the minimap, named camera poses for the lighting tuning protocol

## Scale experiment (docs/RESEARCH.md 9)

Vite app measuring three interchangeable renderings of one seeded placeholder city. Run `npm run dev`, pick variant, count (1k-50k), backend; results panel exports JSON.

- `src/city/`: seeded deterministic city data, pure JS, no rendering types (Rng, archetypes, CityGenerator + its test)
- `src/scene/`: shared stage (ArchetypeGeometries with meshopt LOD chains, SceneBuilder: lights, ground, orbit camera)
- `src/variants/`: the three contenders behind one Variant interface (MeshVariant, BatchedVariant, IndirectVariant with TSL compute cull/LOD into indirect draws, createVariant)
- `src/app/`: run wiring (App, RunConfig via URL query, RendererFactory, Metrics)
- `src/ui/`: overlay only; views/ExperimentView + BuildingView + GameView + MinimapView + InventoryView, widgets/ControlsPanel + ResultsPanel + BuildingControlsPanel + MaterialReportPanel + HudClock + InteractPrompt + LocationReadout + DebugStats + NpcDialogPanel + PauseMenu, components/ primitives and styles

Dependency direction: ui -> app -> variants -> scene -> city.
