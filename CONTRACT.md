# CONTRACT: engine

Purpose: assembles every layer's export into one world state and renders it as the playable game (orbit mode and play mode) at city scale.

Status: play mode is live (src/game/CONTRACT.md); orbit mode, saves and world queries pending.

## In (must cover)
- every sibling export: world blueprint, connection layers, building GLBs and blueprints, material sets, population model, named world, questlines
- a game save (world state plus player state) for load, import, export

## Out (must cover)
- the running game: `?mode=game` plays the assembled city first person at street level (src/game/CONTRACT.md)
- world query functions over the assembled state (by type, zone, tier, schedule)
- game saves

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
