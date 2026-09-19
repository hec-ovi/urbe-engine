# Box map

[Engine 0.26.5 contract](../CONTRACT.md), [agent calling guide](../SKILL.md), [cross-box proposals](ISSUES.md). Raw requirements and local verification records stay untracked.

| Folder | Purpose and dependencies | Inputs and outputs |
| --- | --- | --- |
| `src/assembly` | Assemble cities: kit placements over shared plans, generated landmark shells, native streets, interiors; kits and catalogs live once under `out/shared` | [Contract](../src/assembly/CONTRACT.md), [manifest](../src/assembly/schema/world-manifest.schema.json), [shell catalog](../src/assembly/schema/shell-catalog.schema.json) |
| `src/assembly/kit` | Dress a block from its Atlas template, generate each distinct building once per dressing class and give a parcel only the frame it stands in | [Contract](../src/assembly/kit/CONTRACT.md), [placement record](../src/assembly/kit/kit-placements.schema.json), [plan index](../src/assembly/kit/kit-plans.schema.json) |
| `src/world-archive` | Read/write bounded hashed JSON collections using filesystem or fetch | [Contract](../src/world-archive/CONTRACT.md), [ports](../src/world-archive/schema/api.d.ts), [index](../src/world-archive/schema/index.schema.json) |
| `src/server` | HTTP adapters for Library, Creation, Assembly and Quests dialogue | [Contract and route schemas](../src/server/CONTRACT.md) |
| `src/library` | Catalog and revisioned filesystem saves | [Contract and schemas](../src/library/CONTRACT.md) |
| `src/creation` | Create cities and playthroughs through Atlas, Assembly, Quests and Library | [Contract and schemas](../src/creation/CONTRACT.md) |
| `src/launcher` | Call server APIs and pass results to UI | [Contract](../src/launcher/CONTRACT.md), [API](../src/launcher/schema/launcher-api.schema.json) |
| `src/building` | Preview authored models and resolve Materials PBR | [Contract](../src/building/CONTRACT.md), [texture profile](../src/building/pbr-profile.schema.json) |
| `src/quest-bundle` | Validate the Quests handoff | [Contract](../src/quest-bundle/CONTRACT.md), [manifest](../src/quest-bundle/schema/manifest.schema.json) |
| `src/mission-assets` | Build measured mission objects from Materials references | [Contract and schemas](../src/mission-assets/CONTRACT.md) |
| `src/game` | Load, stream and play the city through the runtime interfaces below | [Contract](../src/game/CONTRACT.md), [query](../src/game/data/schema/game-config.d.ts) |
| `src/ui` | Present values and report player actions to Launcher and Game | [Component contract and layout schemas](../src/ui/CONTRACT.md) |

## Game runtime

| Folder | Responsibility and dependencies | Boundary |
| --- | --- | --- |
| `data` | Source admission through Assembly and World Archive, with one read budget and one plan blueprint per city | [Building sources](../src/game/data/schema/world-buildings.d.ts) |
| `ground` | Native street residency plus retained Atlas ground, Materials surfaces and Physics admission | [Contract](../src/game/ground/CONTRACT.md), [stream](../src/game/ground/schema/stream.d.ts) |
| `ground/materials` | Native street shading from authored Materials effects and texture resources | [Contract](../src/game/ground/materials/CONTRACT.md), [ports](../src/game/ground/materials/schema/ports.d.ts) |
| `ground/native` | Read saved street bundles, resolve the street kit from `/out/shared` when `sharedKit` is set, and select retained ground | [Contract](../src/game/ground/native/CONTRACT.md), [ports](../src/game/ground/native/schema/ports.d.ts) |
| `ground/native-stream` | Draw saved streets as one batch per native surface over the shared piece kit, with each copy's tint, wear, scan cell and marquee text on the batch's own table, and admit their cuboids | [Contract](../src/game/ground/native-stream/CONTRACT.md), [stream](../src/game/ground/schema/stream.d.ts) |
| `city` | Exterior shells, furnished floors from shared room modules (three layouts per building), doors, scenic rooms and fixtures; building vegetation uses the Props asset loader | [Contract](../src/game/city/CONTRACT.md), [floor stream](../src/game/city/schema/interior-stream.d.ts), [fixture stream](../src/game/city/schema/street-fixtures.d.ts), [building models](../src/game/city/schema/building-models.d.ts) |
| `city/streaming` | Nearby original shells and source-derived skyline; cells read a couple ahead and build one at a time; kit worlds load within 384 m and drop beyond 640 m through `KitCellLoader` | [Contract](../src/game/city/streaming/CONTRACT.md), [ports](../src/game/city/streaming/schema/stream.d.ts) |
| `city/kit` | Building plans read as the cells that stand on them are admitted, batched by material, each parcel's own word lettered on the sign field its plan carries, with cuboid colliders per streamed cell | [Contract](../src/game/city/kit/CONTRACT.md) |
| `props` | Source land/model placements with Ground clearance and Physics | [Contract](../src/game/props/CONTRACT.md), [stream](../src/game/props/stream.d.ts) |
| `links` | Connection geometry and materials | [Contract](../src/game/links/CONTRACT.md) |
| `physics` | Rapier world, player body and actor impacts | [Contract](../src/game/physics/CONTRACT.md), [band admission](../src/game/physics/schema/band-admission.d.ts) |
| `player` | Captured input and interaction through Physics, City and Agents | [Contract](../src/game/player/CONTRACT.md), [input](../src/game/player/schema/input.d.ts) |
| `sim` | Narrow Simulation adapter | [Contract and schemas](../src/game/sim/CONTRACT.md) |
| `agents` | Nearby characters and cars from Simulation and Connections | [Contract and schemas](../src/game/agents/CONTRACT.md) |
| `animation` | Accepted action clip sequences for Agents | [Contract and schemas](../src/game/animation/CONTRACT.md) |
| `quests` | Exact story action, target and progress coordination | [Contract and schemas](../src/game/quests/CONTRACT.md) |
| `investigation` | Authored evidence scenes and saved discoveries | [Contract and schemas](../src/game/investigation/CONTRACT.md) |
| `routes` | Objective paths over Connections | [Contract and schemas](../src/game/routes/CONTRACT.md) |
| `transit` | Timetables, boarding and station destinations | [Contract and schemas](../src/game/transit/CONTRACT.md) |
| `hydro` | Atlas water surfaces with Materials bindings | [Contract and schemas](../src/game/hydro/CONTRACT.md) |
| `light`, `look`, `sky` | Fixture lighting, prepared rendering and fixed night setting | [Light](../src/game/light/CONTRACT.md), [Look](../src/game/look/CONTRACT.md), [Game](../src/game/CONTRACT.md) |
| `persistence` | Coherent live state and acknowledged Library revisions | [Contract and schemas](../src/game/persistence/CONTRACT.md) |
| `debug` | Frame/subsystem timing and renderer allocation reports | [Contract](../src/game/debug/CONTRACT.md), [report](../src/game/debug/report.schema.json) |
| `time`, `world`, `talk` | Host clock, spatial queries, map values and text transport | [Game](../src/game/CONTRACT.md), [talk request](../src/server/schema/talk-request.schema.json), [reply](../src/server/schema/talk-response.schema.json) |

Catalogs preserve tapered upper outlines for distant rendering; authored podium lights and reflective black glazing use their source properties.

## Previews

The building route accepts output folders under `/out`, including nested city and saved-game catalogs, and reuses their existing models. It draws the game's own frame (night look, shell surface rules, building fixtures and street lamps) so modelling and materials can be judged from it. A preview-only floor slice masks what sits above the chosen floor. Scenic nodes, fallback window boxes and baked scenic receivers are specified in [City](../src/game/city/CONTRACT.md).

`src/city/CityApp.js` shows assembled parcels. `?mode=experiment` wires `src/app` to `src/variants`, `src/scene` and the seeded `src/city/CityGenerator.js`; settings come from `src/app/RunConfig.js`. These previews use `src/ui`. Street models have a [separate preview contract](../src/game/props/preview/CONTRACT.md).
