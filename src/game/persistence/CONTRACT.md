# CONTRACT: playable game persistence

Purpose: restores one cataloged game and saves its live player and quest state through the launcher boundary.

## Inputs

- Loaded game descriptor: [schema/game-state.schema.json](schema/game-state.schema.json). The id must equal the `game` URL parameter.
- Live state at save time: [schema/live-state.schema.json](schema/live-state.schema.json). Position is the player's foot point in world metres, elapsed time is seconds since this run became playable, optional `transitJourney` is the exact serializable transit state, optional `npcState` is the exact simulation replay plus continuity save at the same world minute, and optional `investigations` contains complete evidence, collection, and one-shot transition state.

## Outputs

- Launcher `saveCurrent` payload: [schema/save-current-payload.schema.json](schema/save-current-payload.schema.json).
- Updated game descriptor returned by the launcher: [schema/save-result.schema.json](schema/save-result.schema.json).

## Events

- `save(liveState)` posts one `saveCurrent` request to `/api/launcher`. Saves are serialized so a later request uses the revision returned by the previous one.

## Errors

- `E_GAME_STATE`: the loaded descriptor or its requested id is invalid.
- `E_LIVE_STATE`: the state supplied by the game is invalid.
- `E_SAVE_PAYLOAD`: the constructed request is invalid.
- `E_SAVE_RESPONSE`: the launcher response is invalid.
- `E_SAVE_HTTP`: the launcher refused or could not process the request.

## Dependencies

- `library/game-descriptor`, by schema only.
- `server/launcher`, by its HTTP contract only.

## Invariants

- The save revision sent is the revision that was loaded or last returned.
- Existing non-quest inventory is retained. Quest-owned items are replaced by the runtime's current inventory, so consumed quest items do not return.
- A quest that could not be restored or cast stays in the save at its previous progress instead of disappearing.
- Discovered locations are unique by id and include the current location.
- An optional transit journey is validated exactly, sent through `saveCurrent`, returned in the game descriptor and restored by the game. Older descriptors without it remain valid.
- Optional NPC state is validated through the simulation and NPC agent schemas, sent and returned unchanged, and restored before the first live frame. Older descriptors without it remain valid.
- Optional investigation state is validated, sent and returned unchanged. The investigation blackbox validates every saved scene and evidence id against current authored scenes before rendering. Older descriptors without it remain valid.

## How to modify this blackbox safely

Keep payload changes additive unless the launcher and game descriptor accept the new shape first. Run the persistence tests and the complete engine test suite.
