# CONTRACT: companion

Purpose: lets the player ask one person along, to follow them or to lead them to a place and talk about it there. Code decides who may come and where to; [NPC continuity](../agents/CONTRACT.md) moves the body.

## Inputs

- `new CompanionGameplay({ continuity, sim, routes, places, atlas, quests?, scenes?, crowd?, lines? })`. `continuity` is the game's NpcContinuity, `sim` the simulation (`getNPC`, `behaviorAt`), `routes` its WalkRoutes, `places` the same continuity places array (`{ kind, id, position }`) and `atlas` the city plan, for place names. `quests` is `{ holdsCast(npcId), escorts(npcId), places(timeMin), characterName(npcId) }` as QuestGameplay offers them. `scenes` is a function returning staged scenery places, [schema/scenes.schema.json](schema/scenes.schema.json). `crowd` is `{ memberForNpc(npcId) }`. `lines` is a [CompanionLines](CompanionLines.js) document, [lines.md](lines.md) by default.
- Offers request: [schema/offers-request.schema.json](schema/offers-request.schema.json). The person, the clock and the places the player stands in.
- Accept request: [schema/accept-request.schema.json](schema/accept-request.schema.json). The same, plus the chosen `offerId`.
- Tool request: [schema/tool-request.schema.json](schema/tool-request.schema.json). The same, plus a talk stream offer event: `kind` `follow`, or `lead` with its `placeId`.
- Update request: [schema/update-request.schema.json](schema/update-request.schema.json). The clock, the player's feet and places, and `busy` while the player has a panel, a chooser, a summary or a conversation open.
- Restore request: [schema/restore-request.schema.json](schema/restore-request.schema.json). The clock and a saved state.

## Outputs

- Offers: [schema/offers.schema.json](schema/offers.schema.json). `follow` ('Come with me'), up to four `lead` offers ('Show me' a place, with its destination) and, for the companion itself, `dismiss` ('You can go now'). An unavailable offer carries its reason. Ids are `follow`, `dismiss` and `lead:<kind>:<id>`.
- Talk offers: [schema/talk-offers.schema.json](schema/talk-offers.schema.json). `talkOffers(offers)` is the talk request's `offers` for the available follow and lead offers, or null.
- Accept result: [schema/accept-result.schema.json](schema/accept-result.schema.json). Accepted with the offer's kind, or refused with a reason; `line` is what the person says either way.
- Signals: [schema/signals.schema.json](schema/signals.schema.json). `started`, `refused` (an accepted offer the body could not start), `line` (said on the way, outside a conversation), `arrival` (with the talk request's `guide`, the relation, the player's implied question `ask` and a spoken `line` for when the model is unavailable) and `ended` (`dismissed`, `gave-up` with an optional `notice`, `done`, `left`, `lost`).
- State: [schema/companion-state.schema.json](schema/companion-state.schema.json), `$id` `urn:urbe:engine:companion:state` over [values](schema/values.schema.json), `version` 1. The companion's person, kind, start minute, phase, destination and line clock, or null. `serialize()` returns it for the save, beside the continuity save at the same minute.
- `active` is `{ npcId, kind, phase, destination? }` or null, read without validation. `accepted(npcId)` says an accepted offer waits for that person's conversation to close. `guide(npcId)` is the talk request's `guide` while that person is a leader at its destination, else null.

## Offer rules

- Nobody comes who is dead, fallen, aboard transit or not materialized (`unavailable`). While a companion or a quest escort has the player, nobody else comes (`conflict`); the escort's own person is `busy`. A person an open quest step still names stays where the story wants them (`busy`). A person at work stays there (`on_duty`). A person due to set off for their next shift, commute included, within 15 minutes does not follow, nor lead where the walk at 1.2 m/s plus 5 minutes at the place ends later (`no_time`).
- Lead places are the parcels of open quest go and talk steps (stations and stops as their stop), staged scenery places from `scenes`, the person's workplace or transit stop, home, and the parcels of their leisure and shopping. A place the player stands in, one the continuity cannot place or the city cannot name, and one whose walk from the person is shorter than 10 m or longer than 800 m are left out. The rest are ordered quest, scene, work, home, haunt, then by walk length, then by place id; the first four are offered. A place that is more than one of these takes its first relation and the `notes` of every scene staged there, which the arrival's `guide` carries.
- The companion itself is offered `dismiss` and the other kind or another place: a follower asked to lead, or a leader asked to follow, changes mode where it stands.
- A place is named by its own name, else by its venue word through `name-unnamed` (`the clinic`), `name-stop` or `name-station`. Offered places that would read the same are named with the compass point they lie toward from the person, through `name-north` to `name-north-west` (`the clinic to the north`, north being -z); of those that still read the same, only the first is offered. Labels, accept and refusal lines come from `lines.md` by key; the variant is fixed by the person and the minute.

## Flow

- `accept(request)` recomputes the offers and accepts only an available offer with that exact id; `acceptFromTool(request)` maps a talk stream offer to the follow offer or to the lead offer for that `placeId`. A typed request the person agreed to is the player's consent. Anything else is refused with `unknown` or the offer's reason.
- An accepted offer starts on the first `update` with no conversation open, once its person's has closed: follow or lead with a give-up pace of 60 m for 3 minutes, from the body where it stands. A host that holds the body on close while `accepted(npcId)` keeps its interruption; otherwise the walk home the close began is taken over. A dismissal lets the companion go at that point. An offer the continuity refuses to start becomes a `refused` signal, and a body held for it walks back into its day.
- `update(request)` runs right after the continuity's `updateFollow` and drains its control events. A follower mirrors the continuity phase until it is dismissed or gives up. A waiting leader calls out a `lead-waiting` line at most once a clock minute. Once a leader has arrived and the player talks to it, or stands within 4 m of it or at the destination while no conversation with anybody else and nothing `busy` is open, one `arrival` signal asks the host to open the conversation with its `guide` and `ask`; a conversation already open with the leader takes the guide for its next turn. The companion then goes back to its day (`stopFollow`, from where it stands) when that conversation closes (`done`), when nobody talks to it for 2 minutes after the signal (`done`) or when the player is outside the destination and more than 15 m from the leader (`left`).
- A continuity give-up ends the companion with `gave-up`: `player-lost` and `unreachable` carry a notice naming the person; the continuity has already sent the body home. When the continuity has no companion, or another person or mode, the companion ends with `lost`.
- `restore({ timeMin, state })` runs after the continuity and the quest escort are restored, with no conversation open. It takes the saved companion back only when the restored continuity companion is the same person in the same mode. A continuity companion that is neither that nor the quest escort's person (`quests.escorts`) is let go, so no follower is left that the player cannot dismiss. A leader saved while its place talk was ready or under way is restored as arrived, so the talk comes again when the player is near. An accepted offer is not saved.

## Errors

- `E_COMPANION_INPUT`: a request, a restore state or the scenes provider's output does not match its schema.
- `E_COMPANION_OUTPUT`: an offer list, result, signal list or state does not match its schema.
- `E_COMPANION_LINES`: a lines document lacks a key, names an unknown `{field}`, or a line is asked for without a value it names.
- A continuity refusal when an accepted offer starts becomes a `refused` signal: `conflict` for another control, `unknown` for no way there, else `unavailable`. A body held for that offer is released; a release that finds no way back is logged, and the schedule takes the body.

## Dependencies

- [NPC continuity](../agents/CONTRACT.md): `companion`, `conversation`, `actor`, `startFollow`, `startLead` (including the companion changing mode), `stopFollow`, `heldNpcIds`, `releaseHold` and `drainEvents`.
- [Simulation](../../../../simulation/CONTRACT.md) instances, routines and behavior; WalkRoutes over Connections path3.
- Quests `VENUES` venue words from the browser runtime entry; [QuestGameplay](../quests/CONTRACT.md) for `holdsCast`, `escorts`, `places` and `characterName`.
- The scenery director for staged places, through the injected `scenes` provider.

## Invariants

- Offers, acceptance and every line are decided by code and data; the model only picks among the offers it was given, and a pick is checked again against the rules when it arrives.
- Starting, waiting, arriving, giving up and ending depend only on the continuity state, the player's position and places, and the simulation clock.
- At most one companion. It is never a quest escort's person, and a quest escort cannot start while it walks.
