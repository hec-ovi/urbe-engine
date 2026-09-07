# Box map

- root box: see CONTRACT.md. Development preview mounts Materials bindings and theme assets separately for the shared material resolver.
- `src/assembly/`: Atlas parcel and shared building grid + Connections apertures -> Exterior BuildingRequest; CLI builds shells, optional interiors and per-floor GLBs, then fits rooftop spans through Connections. City assembly publishes checked Connections bytes bound to the exact blueprint, QA and a final manifest; simulation CLI boots the assembled world (src/assembly/CONTRACT.md). Depends on Atlas, Connections, Exterior, Interior, Naming and Simulation contracts.
- `src/building/`: building preview and shared PBR resolution (src/building/CONTRACT.md); catalog maps retain physical scale and absolute surface values, fitted decals retain alpha, authored interior variants and two-sided surfaces survive material replacement. Depends on Materials, the development build boundary and the game quality profile.
- `src/server/`: checked development routes for previews, exact-blueprint background exterior batches with Connections artifact admission, launcher creation and NPC dialogue (src/server/CONTRACT.md).
- `src/library/`: filesystem catalog for generated city directories and playable game directories, with schema-validated descriptors, atomic revisioned saves and path containment (src/library/CONTRACT.md).
- `src/launcher/`: browser orchestration between the isolated front-door UI and the catalog and generation API; validates every callback result before navigation, download or creation state changes (src/launcher/CONTRACT.md).
- `src/creation/`: size templates to cities and saved games, with optional interiors and quests. Depends on Atlas CLI, Assembly, Quests and Library. Inputs and outputs: [contract](../src/creation/CONTRACT.md).
- `src/mission-assets/`: Engine-owned renderer-neutral mission object creation for its quest and investigation hosts, with exact dimensions, PBR references, collision, interaction anchors, clearances and canonical payload hashes; placement stays in the consuming runtime (src/mission-assets/CONTRACT.md).
- `src/quest-bundle/`: atomic consumer and selector for the Quests v0.8.2 handoff v1.1: definitions, objectives, investigations, fixed mechanic bindings, mission asset requests, item bindings and host capabilities (src/quest-bundle/CONTRACT.md).

- `src/game/`: the playable city (`?mode=game`); first-person controller on Rapier, night scene from the assembled GLBs, ground from the blueprint's cover polygons, neon and lit windows, simulation-driven crowd and lane-graph traffic, doors into continuous interiors (src/game/CONTRACT.md). Depends on ../atlas, ../connections, ../materials, ../simulation contracts.
  - Material-declared opaque windows omit scenic rooms; office and opaque glazing and concrete surface families retain shell collision. Upstairs scenic bays meet published glazing housings with sealed returns; playable entrances carry compact header lights.
  - `data/`: run config, world loading with schema-checked Connections bound to exact blueprint bytes, signal state
  - `ground/`: authored cover, fitted paving with independent road finishes, station-preserving triangulation of simple Float32 boundaries, exact lane/crossing paint and functional-band ownership, kerbs and highways; an infinite safety floor below the world (src/game/ground/CONTRACT.md). Depends on Atlas, Connections, Exterior, Materials and game physics.
  - `city/`: shells, doors, facade scenery, street fixtures and streamed interior rooms. Street markings select Ground's catalog-bound paint or explicit lane diagnostics. Lamp bases fit Ground's authored furnishing regions. Room cuts, centers and player membership consume Interior's contracted outer ring and hole exclusions through its core footprint helpers; floor bands retain all shared core geometry.
    - Door loading retains named closed-pose leaves, applies authored pocket or swing motion, and reports unsupported fixed mechanisms; Physics consumes the resulting complete poses.
  - `links/`: bridges, AC tubes, tunnels and street wires from Connections' link document, plus post-exterior rooftop antenna spans, merged by material; aperture links are sliced onto their exact carved openings (src/game/links/CONTRACT.md)
  - `transit/`: bus shelters, scheduled vehicles, short station stairs and destination terminals; both maps project enabled Connections routes and their served stops or entrances. Terminal journeys connect published stations (src/game/transit/CONTRACT.md).
  - `props/`: asymmetric refuse, delivery and ornament pockets, varied surface wear, full-size containers, imported trees and guardrail variants on Atlas reservations; catalog, arrangement, option and result schemas in src/game/props/CONTRACT.md. Depends on Atlas, Connections, Ground and Materials
  - `light/`: fixture power in lumens, backend light pools, room fill and air glow (src/game/light/CONTRACT.md); play uses one fixed night grade independently of the simulation clock.
  - `look/`: quality tiers with explicit texture budgets, AgX exposure, height fog tinted by the light in the air, environment probe, the render pipeline with emissive-selected bloom, and serial warm-up that builds pipelines and maps before a frame can stall on them (src/game/look/CONTRACT.md)
  - `sky/`: night sky, moon key, stars
  - `physics/`: fixed-step Rapier world, generated trimesh collision, player capsule, measured fatal and nonfatal vehicle contacts and one full Source-rig ragdoll (src/game/physics/CONTRACT.md)
  - `hydro/`: exact Atlas water surfaces and crossing-reservation handoff, with Materials-owned PBR bindings and deterministic normal motion (src/game/hydro/CONTRACT.md)
  - `player/`: input, first-person controller with selectable running speed and time-based inspection zoom, interaction
  - `agents/`: character provenance, proportion-preserving animation transfer, smooth pose baking, crowd, traffic, persistent NPC materialization, crouch, follow, lead, transit passenger carry and schedule return on Connections' authoritative 3D paths (src/game/agents/CONTRACT.md). Character inputs and outputs use the original Three.js scenes and clips; actor requests and results use the linked contract schemas.
  - `investigation/`: deterministic authored incident assembly and live E/R evidence flow, with exact quest bindings, Source final-pose bodies, mission props, PBR decals and catalog restoration (src/game/investigation/CONTRACT.md)
  - `quests/`: all 16 cast quest actions, including fixed-asset rescue, access, hacking and sabotage, follow or lead escort, fatal-impact assassination and measured public-transit completion (src/game/quests/CONTRACT.md)
  - `routes/`: deterministic shortest objective routes to published parcel, station and stop entries over Connections' authoritative 3D walk graph (src/game/routes/CONTRACT.md)
  - `sim/`: the simulation library host and exact NPC continuity pass-through (src/game/sim/CONTRACT.md)
  - `debug/`: the hitch log, and the renderer work (shader links, texture uploads) that explains a gap the world did not cause
  - `time/`, `world/`: simulation clock, sky-state arithmetic, district and parcel lookup, map models from Atlas and Connections, named lighting-review camera poses.

## Scale experiment (docs/RESEARCH.md 9)

Vite app measuring three interchangeable renderings of one seeded placeholder city. Run `npm run dev`, pick variant, count (1k-50k), backend; results panel exports JSON.

- `src/city/`: seeded deterministic city data, pure JS, no rendering types (Rng, archetypes, CityGenerator + its test)
- `src/scene/`: shared stage (ArchetypeGeometries with meshopt LOD chains, SceneBuilder: lights, ground, orbit camera)
- `src/variants/`: the three contenders behind one Variant interface (MeshVariant, BatchedVariant, IndirectVariant with TSL compute cull/LOD into indirect draws, createVariant)
- `src/app/`: run wiring (App, RunConfig via URL query, RendererFactory, Metrics)
- `src/ui/`: overlay only (src/ui/CONTRACT.md); views/GameView with PanelHost over Map3DView, InventoryView, QuestsView, CodexView, SettingsView, ControlsView plus a forward-up MinimapView with north marker, BuildingView, ExperimentView; widgets/TabBar, ChatPanel, AvatarCard, VideoCallPanel, MissionToast, MissionSummary, HudClock, InteractPrompt, LocationReadout, DebugStats, PauseMenu and the viewer panels; components/ primitives and stylesheets; preview.html shows the whole overlay with sample data

Dependency direction: ui -> app -> variants -> scene -> city.
