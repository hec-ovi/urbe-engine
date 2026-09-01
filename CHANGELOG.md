# Changelog

0.3.1: floor feasibility follows exterior v0.8's reqH-aware recipe (pinned floor contains its aperture); interior generation gated by interior's coreFeasibility surface (E_CORE_INFEASIBLE).
0.3: assembly drives interior: InteriorRequest per parcel (derived seed, assignments derived from blueprint slots), --interior CLI flag writing building.glb, floors/*.json and npc.json to <out>/interior/.
0.2.1: assembly floor choice follows exterior's feasibility recipe (schemas/floor-constants.json): seeded pick inside envelope x feasible range, guaranteed-legal counts.
0.2: assembly box, first slice: per-parcel exterior BuildingRequest from atlas + connections, CLI through exterior to GLB and blueprint (src/assembly/CONTRACT.md).
0.1: scale experiment app, three city render variants measured side by side (docs/RESEARCH.md 9).
0.0: scaffold, contract pending.
