# CONTRACT: engine

Purpose: assembles the generated city boxes into a cataloged world and serves its launcher, previews, creation flow and playable first-person game.

Status: v0.17.2.

## Inputs

- World assembly consumes Atlas, Connections, Exterior, Interior, Materials, Simulation, Naming and Quests only through the contracts listed below.
- `npm run assemble` and `npm run assemble-city` take the requests in [src/assembly/CONTRACT.md](src/assembly/CONTRACT.md) and publish [world-manifest.schema.json](src/assembly/schema/world-manifest.schema.json).
- A playable story is the Quests v0.8.0 handoff `quest-bundle.json` v1.1 plus its six counted catalogs and object-valued `host-capabilities.json`, validated by [src/quest-bundle/CONTRACT.md](src/quest-bundle/CONTRACT.md).
- Catalog, import, export, staged creation and revisioned save calls use [launcher-request.schema.json](src/server/schema/launcher-request.schema.json) at `POST /api/launcher`. Browser values use [launcher-api.schema.json](src/launcher/schema/launcher-api.schema.json); stored values use [src/library/CONTRACT.md](src/library/CONTRACT.md).
- A missing building preview takes [building-build-request.schema.json](src/server/schema/building-build-request.schema.json) at `POST /api/building`.
- NPC text dialogue takes [talk-request.schema.json](src/server/schema/talk-request.schema.json), including optional live quest state, at `POST /api/talk`. `LLM_BASE_URL` selects an OpenAI-compatible endpoint and `LLM_MODEL` selects its model.
- Browser modes are `?mode=game`, `?mode=city`, `?mode=building` and `?mode=experiment`, with their exact query settings in the relevant contracts.

## Outputs

- `/` is the launcher for separate generated-city and saved-game catalogs. Creation runs city shells, selected interiors, the selected quest bundle and the final game as four validated stages.
- `?mode=game` plays the assembled city through [src/game/CONTRACT.md](src/game/CONTRACT.md), including revisioned saves, library discovery, world queries, objective guidance, authored investigations and all 16 quest action kinds.
- The seven measured quest hosts are assassination by fatal Rapier vehicle impact, fixed-asset rescue, escort follow or lead arrival, fixed access, fixed hacking, fixed sabotage and a verified public-transit journey. Each keeps its authored quest, step, actor, target, place and asset identities.
- `?mode=city&out=/out/<world>` shows each manifest parcel and opens its building viewer. `?mode=building&parcel=<id>&out=/out/<world>[&source=interior]` shows the exterior or furnished interior and can request a missing build.
- `POST /api/building` returns [building-build-result.schema.json](src/server/schema/building-build-result.schema.json).
- `POST /api/talk` returns [talk-response.schema.json](src/server/schema/talk-response.schema.json).

## Errors

- Building preview failures use [building-build-error.schema.json](src/server/schema/building-build-error.schema.json): `E_INVALID_REQUEST`, `E_WORLD_NOT_FOUND`, `E_WORLD_INVALID`, `E_PARCEL_NOT_FOUND`, `E_BUILD_FAILED`, `E_BUILD_INCOMPLETE`.
- Development route, launcher, library, creation, gameplay, quest and hydrology failures use the closed sets in their linked contracts. Startup failures are visible and publish no partial world.

## Invariants

- Generated data and contracted external model assets are authoritative. Engine does not invent parcels, population, story targets, materials or fallback geometry.
- A catalog game and every save revision remain tied to one validated city, quest bundle, simulation replay and player state.
- WebGPU is the default renderer. WebGL2 uses the same world and gameplay data through its documented quality fallback.

## Dependencies

- [Development server](src/server/CONTRACT.md)

- [Atlas](../atlas/CONTRACT.md)
- [Connections](../connections/CONTRACT.md)
- [Exterior](../exterior/CONTRACT.md)
- [Interior](../interior/CONTRACT.md)
- [Materials](../materials/CONTRACT.md)
- [Simulation](../simulation/CONTRACT.md)
- [Naming](../naming/CONTRACT.md)
- [Quests](../quests/CONTRACT.md)
