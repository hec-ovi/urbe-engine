# CONTRACT: engine

Purpose: assembles every layer's export into one world state and renders it as the playable game (orbit mode and play mode) at city scale.

Status: play mode is live (src/game/CONTRACT.md); orbit mode, saves and world queries pending.

## In (must cover)
- every sibling export: world blueprint, connection layers, building GLBs and blueprints, material sets, population model, named world, questlines
- a game save (world state plus player state) for load, import, export
- questlines: `out/<world>/quests/questlines.json`, the definitions of one ../quests creation run (main first), carried beside the city by `npm run carry-quests -- --from <run dir> --out <world out dir>`; absent means a city with no story
- building preview build request: [src/server/schema/building-build-request.schema.json](src/server/schema/building-build-request.schema.json), one parcel and one served `/out` world

## Out (must cover)
- the running game: `?mode=game` plays the assembled city first person at street level (src/game/CONTRACT.md)
- world query functions over the assembled state (by type, zone, tier, schedule)
- game saves
- the city preview: `?mode=city[&out=/out/small]`: every parcel as its published floors stacked (unbuilt ones as the atlas envelope) over the atlas ground cover; hover names the parcel, a click opens `?mode=building&parcel=<id>&out=<out>`
- the building viewer: `?mode=building&parcel=<id>[&out=/out/small]` opens the exterior shell by default, with a fly camera (W A S D walk, Q and E down and up, drag to look, Shift fast, no zoom)
- preview build result: [src/server/schema/building-build-result.schema.json](src/server/schema/building-build-result.schema.json), returned by `POST /api/building`; the development server builds a missing exterior from that world's carried blueprint or a known Atlas sample, through the schema-validated assembly CLI
- dev server routes: sibling mounts (/atlas, /materials, /models), POST /api/building, and POST /api/talk (src/server/talkRoute.js): the NPC's reply to one player line through ../quests dialog over the OpenAI-compatible server at LLM_BASE_URL (default http://localhost:8080/v1), LLM_MODEL or the first model listed

## Errors
Building preview build errors use [src/server/schema/building-build-error.schema.json](src/server/schema/building-build-error.schema.json): `E_INVALID_REQUEST`, `E_WORLD_NOT_FOUND`, `E_WORLD_INVALID`, `E_PARCEL_NOT_FOUND`, `E_BUILD_FAILED`, `E_BUILD_INCOMPLETE`. The viewer shows the code and message.

## Depends on
- ../atlas/CONTRACT.md
- ../connections/CONTRACT.md
- ../exterior/CONTRACT.md
- ../interior/CONTRACT.md
- ../materials/CONTRACT.md
- ../simulation/CONTRACT.md
- ../naming/CONTRACT.md
- ../quests/CONTRACT.md
