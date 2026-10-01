# CONTRACT: contacts

Purpose: the people whose number the player has, and calling them: whether a person gives their number, whether they pick up, and one call from ringing to the call screen going away.

## In

- `ContactBook`: `add( npcId, addedMin )` keeps a person, the first minute they gave their number standing; `restore( saved )` takes a save's book, a person listed twice keeping their first entry.
- `givesNumber( disposition )`: whether a person gives their number when no model can answer for them, as private as their home (Quests `willingTo`): only a friendly one does. With a model, the person decides in their own words by the same rule and how the talk has gone (Quests `give_number`).
- `answerOf({ npc, disposition, activity })`: how a contact takes a call now, from the simulation's person, their Quests `dispositionOf` and what their day has them doing (`behaviorAt(...).activity`).
- `PhoneCalls({ view, answerOf, open, close, contactOf, portraitOf?, reach?, busyLine? })`: the call screen (a [CallPanel](../../ui/CONTRACT.md)), `open( npcId )` opening the conversation over the phone (GameApp: `Interactor.call`, null when it cannot), `close()` closing it, `contactOf( npcId )` `{ name, role, handle }`, `portraitOf( npcId )` a promise of the person's own [portrait](../portraits/CONTRACT.md), `reach( npcId )` `{ relay, signal }` (where the call reaches them and how clear the line is) and `busyLine( npcId )`. `call( npcId )`, `update( seconds )` once a frame in the player's own time, `hangUp()` for the player, `closed( npcId )` when the conversation closed on its own, `drop()`.
- `contactLines( markdown? )`: the asks' labels and what people say, [lines.md](lines.md) by default, read as the companion's lines are (`CompanionLines` with these keys).

## Out

- `ContactBook.serialize()`: `[{ npcId, addedMin }]` in the order added, [schema/contacts.schema.json](schema/contacts.schema.json) (`urn:urbe:engine:contacts:contacts`), the save's `contacts`. `has`, `get`, `list`, `size`.
- `answerOf`: `answered`; `no-answer` for a person the simulation no longer holds, the dead and the asleep; `declined` for a hostile person, who lets it ring out; `busy` for a person at work who is not friendly, who picks up to say so (`call-busy`) and hangs up.
- `CallSession({ npcId, answer })`: `connecting` for `RING_SECONDS` (2.5), then `connected` or the answer; `busy` ends by itself 4 s later; `hangUp()` ends a live call. `duration` is the time talked as `m:ss`, `endedAt` the session second it stopped being live.
- `PhoneCalls`: rings with the person's name, role, handle and, once drawn, portrait on the call screen; when the person picks up and `open` gives a conversation it is connected, else it ends; the screen shows the state, the time talked (once a second), `reach` and a busy person's line, and goes `LINGER_SECONDS` (6) after the call is over. Calling while a call is connected closes it first. `live` and `npcId` read the call.

## Errors

- `E_COMPANION_LINES` from `contactLines` for a document that lacks a key or names an unknown field.
- `PhoneCalls` throws nothing of its own: a person who cannot be talked to when they pick up ends the call.

## Depends on

[Companion lines](../companion/CONTRACT.md) (`CompanionLines`), Quests `dispositionOf` through the host, the [player's Interactor](../player/CONTRACT.md) through the host's `open`.
