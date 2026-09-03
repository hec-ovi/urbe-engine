# Box map

- root box: see CONTRACT.md.
- `src/assembly/`: world-assembly slice; atlas parcel + connections apertures -> exterior BuildingRequest, CLI drives exterior to GLB + blueprint and, with --interior, interior to the filled building plus one GLB per floor; `npm run assemble-city` builds every shell and deterministically furnishes five quest-referenced or venue parcels, with a QA report and a manifest separating shells from interiors; `npm run simulate` boots the simulation library over the assembled world (src/assembly/CONTRACT.md). Depends on ../atlas, ../connections, ../exterior, ../interior, ../naming, ../simulation contracts.
- `src/building/`: building viewer logic; asks the development build boundary for the selected parcel, output and shell or interior source, validates asset MIME before loading, resolves material keys against ../materials' theme database (MaterialResolver), builds PBR materials with world-scale tiling and transmission (PbrMaterialFactory), TSL floor slice (FloorSlicer), fly-camera pointer lock and visible loading/error recovery. Open with `npm run dev` then `/?mode=building&parcel=<id>&out=/out/<world>[&source=interior]`; unresolved keys render magenta and are listed.
- `src/server/`: development routes; `/api/building` validates a selected parcel, output and source, then delegates a missing exterior or interior to the assembly CLI against a carried blueprint or known Atlas sample. `/api/talk` connects NPC dialog to the configured local model server.
- `src/library/`: filesystem catalog for generated city directories and playable game directories, with schema-validated descriptors, atomic revisioned saves and path containment (src/library/CONTRACT.md).
- `src/launcher/`: browser orchestration between the isolated front-door UI and the catalog and generation API; validates every callback result before navigation, download or creation state changes (src/launcher/CONTRACT.md).

- `src/game/`: the playable city (`?mode=game`); first-person controller on Rapier, night scene from the assembled GLBs, ground from the blueprint's cover polygons, neon and lit windows, simulation-driven crowd and lane-graph traffic, doors into continuous interiors (src/game/CONTRACT.md). Depends on ../atlas, ../connections, ../materials, ../simulation contracts.
  - `data/`: run config, world loading, signal state
  - `ground/`: cover polygons to geometry, highway ramps, decks and supports from Atlas dimensions and elevation knots, the published kerb strip and a kerb cut from pavement edges where no strip exists
  - `city/`: shells and doors, neon, lit windows, lamps, road paint and the painted crossings at every marked junction, interiors streamed a floor at a time from each floor's own GLB and cut into rooms, and which of them are in view
  - `links/`: bridges, AC tubes, tunnels and wires from the connections links, swept from centerline plus cross-section and sliced onto the exact carved apertures (src/game/links/CONTRACT.md)
  - `transit/`: bus stop shelters and signs, buses driven by the timetables' closed-form vehicle positions, station entrances and the shaft, passage and platform room behind each one (src/game/transit/CONTRACT.md)
  - `props/`: seeded alley and service-corner dressing, bags, crates and boxes, clear of doorways and walk lines (src/game/props/CONTRACT.md)
  - `light/`: every fixture as real light in lumens, clustered or batched by backend, per-room light slots with the computed room fill, air glow, the day switch that puts the city's own lights out at sunrise (src/game/light/CONTRACT.md)
  - `look/`: quality tiers with explicit texture budgets, AgX exposure, height fog tinted by the light in the air, environment probe, the render pipeline with emissive-selected bloom, and serial warm-up that builds pipelines and maps before a frame can stall on them (src/game/look/CONTRACT.md)
  - `sky/`: night sky, moon key, stars
  - `physics/`: Rapier world, colliders, player capsule
  - `player/`: input, first-person controller, interaction
  - `agents/`: character assets, pose baking, crowd, traffic, persistent NPC materialization and quest-follow control on Connections' authoritative 3D paths (src/game/agents/CONTRACT.md)
  - `investigation/`: deterministic measured body, prop and fitted-decal scenes with exact authored evidence, reachable interaction points and save-safe discovery state (src/game/investigation/CONTRACT.md)
  - `quests/`: cast quest sessions, validated player actions, live target props and cast-person focus (src/game/quests/CONTRACT.md)
  - `routes/`: deterministic shortest objective routes to published parcel, station and stop entries over Connections' authoritative 3D walk graph (src/game/routes/CONTRACT.md)
  - `sim/`: the simulation library host and exact NPC continuity pass-through (src/game/sim/CONTRACT.md)
  - `debug/`: the hitch log, and the renderer work (shader links, texture uploads) that explains a gap the world did not cause
  - `time/`, `world/`: game clock, the sun arc and the four sky states it drives, district and parcel lookup, map model for the minimap, named camera poses for the lighting tuning protocol

## Scale experiment (docs/RESEARCH.md 9)

Vite app measuring three interchangeable renderings of one seeded placeholder city. Run `npm run dev`, pick variant, count (1k-50k), backend; results panel exports JSON.

- `src/city/`: seeded deterministic city data, pure JS, no rendering types (Rng, archetypes, CityGenerator + its test)
- `src/scene/`: shared stage (ArchetypeGeometries with meshopt LOD chains, SceneBuilder: lights, ground, orbit camera)
- `src/variants/`: the three contenders behind one Variant interface (MeshVariant, BatchedVariant, IndirectVariant with TSL compute cull/LOD into indirect draws, createVariant)
- `src/app/`: run wiring (App, RunConfig via URL query, RendererFactory, Metrics)
- `src/ui/`: overlay only (src/ui/CONTRACT.md); views/GameView with PanelHost over Map3DView, InventoryView, QuestsView, CodexView, SettingsView, ControlsView plus MinimapView, BuildingView, ExperimentView; widgets/TabBar, ChatPanel, AvatarCard, VideoCallPanel, MissionToast, MissionSummary, HudClock, InteractPrompt, LocationReadout, DebugStats, PauseMenu and the viewer panels; components/ primitives and stylesheets; preview.html shows the whole overlay with sample data

Dependency direction: ui -> app -> variants -> scene -> city.
