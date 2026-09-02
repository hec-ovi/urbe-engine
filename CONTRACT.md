# CONTRACT: engine

Purpose: assembles every layer's export into one world state and renders it as the playable game (orbit mode and play mode) at city scale.

Status: play mode is live (src/game/CONTRACT.md); orbit mode, saves and world queries pending.

## In (must cover)
- every sibling export: world blueprint, connection layers, building GLBs and blueprints, material sets, population model, named world, questlines
- a game save (world state plus player state) for load, import, export
- questlines: `out/<world>/quests/questlines.json`, the definitions of one ../quests creation run (main first), carried beside the city by `npm run carry-quests -- --from <run dir> --out <world out dir>`; absent means a city with no story

## Out (must cover)
- the running game: `?mode=game` plays the assembled city first person at street level (src/game/CONTRACT.md)
- world query functions over the assembled state (by type, zone, tier, schedule)
- game saves
- dev server routes: sibling mounts (/atlas, /materials, /models) and POST /api/talk (src/server/talkRoute.js): the NPC's reply to one player line through ../quests dialog over the OpenAI-compatible server at LLM_BASE_URL (default http://localhost:8080/v1), LLM_MODEL or the first model listed

## Errors
Closed set, to be defined.

## Depends on
- ../atlas/CONTRACT.md
- ../connections/CONTRACT.md
- ../exterior/CONTRACT.md
- ../interior/CONTRACT.md
- ../materials/CONTRACT.md
- ../simulation/CONTRACT.md
- ../naming/CONTRACT.md
- ../quests/CONTRACT.md
