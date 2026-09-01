# Changelog

0.6: city batch (assemble-city): connections once, then the shared BuildingPipeline per parcel with parallel workers, QA report with verbatim failures; blueprint path is an option on every CLI; simulate takes an interiors dir.
0.5.1: simulate takes its crowd handle from the scoped slice's sampled agents (simulation 0.2 samples up to 64 per scope; every district addressable).
0.5: simulation wiring: npm run simulate boots createSimulation over the sample blueprint, connections networks and assembled interiors; prints stats, crowd slice, three NPC lives, latencies and a conservation check.
0.4.2: core gate follows interior 0.5 modes (standard, compact, walkup, none); the full bridged sample assembles end to end.
0.4.1: core gate follows interior 0.4 modes (standard, walkup, none); walkup parcels re-pick floors inside the cap and regenerate the shell before interior runs.
0.4: building viewer (?mode=building&parcel=<id>): assembled GLBs textured through the materials database, world-scale tiling, glass transmission, TSL floor slice, magenta fallback plus report for unresolved keys.
0.3.1: floor feasibility follows exterior v0.8's reqH-aware recipe (pinned floor contains its aperture); interior generation gated by interior's coreFeasibility surface (E_CORE_INFEASIBLE).
0.3: assembly drives interior: InteriorRequest per parcel (derived seed, assignments derived from blueprint slots), --interior CLI flag writing building.glb, floors/*.json and npc.json to <out>/interior/.
0.2.1: assembly floor choice follows exterior's feasibility recipe (schemas/floor-constants.json): seeded pick inside envelope x feasible range, guaranteed-legal counts.
0.2: assembly box, first slice: per-parcel exterior BuildingRequest from atlas + connections, CLI through exterior to GLB and blueprint (src/assembly/CONTRACT.md).
0.1: scale experiment app, three city render variants measured side by side (docs/RESEARCH.md 9).
0.0: scaffold, contract pending.
