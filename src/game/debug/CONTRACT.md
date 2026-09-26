# Game diagnostics

Records frame gaps, subsystem costs and renderer allocations for a running city, and drives a read-only preview for automated checks.

## Input

- `HitchLog(threshold = 40)`: `note(label, milliseconds?)`, `time(label, work, threshold = 4)` for synchronous work, `span(label, work, threshold = 4)` for an awaited step that is all thread (its wall time is its cost), and `frame(gapMilliseconds)`.
- `RenderWork(renderer.info)`: listens to the renderer's own `createProgram`, `destroyProgram`, `createTexture` and `destroyTexture` accounting from construction on.
- `FrameReports(send, snapshot)`: a send callback and a callback returning the snapshot fields in the [report schema](report.schema.json). `frame(now, gapMs, notes)` records a frame and its preceding work.
- `hitchReportPlugin(outputDirectory)`: the Vite development server and the `urbe:performance` event carrying a report.
- `AutomationProbe(game)`: the playing `GameApp`. Game installs it as `window.urbe.automation` once the city plays, only when the query carries `automation` on an `out` preview ([settings](../data/schema/game-config.d.ts)); a catalog `game` saves, so it gets none. It acts through the player's own paths: `placePlayer`, `pressAction` and `sayLine` ([Game](../CONTRACT.md)).

## Output

- HitchLog exposes `notes`, `count` and `worst`, and prints gaps above its threshold.
- `RenderWork.since()` returns what the renderer built since the last call, or null: programs linked and programs released, each by material name and stage (the six most, then a count), and textures uploaded with their size past a megabyte. A program released and linked again in the same frame counts on both sides, which the net counters would hide.
- FrameReports sends one report per second, with frame median, p95, maximum and up to 20 hitch records. Snapshot collection occurs only when sending. Missing development transport creates no reporter.
- The plugin validates reports and stores the latest 60 in `performance.json` under its configured directory. Writes are serialized. Reports contain the game id, rendering settings, counters, position and timing only.
- The probe holds pointer capture (`input.locked`), which a headless browser never grants, so prompts, movement and the unpaused view are the player's own. Its methods answer plain JSON; colours are `#rrggbb`, positions `[x, y, z]`.
  - `state()`: backend, tier, draw calls, fps, feet, yaw, pitch, clock, crowd size, E target `{kind, person}`, conversation `{npcId, name, type, controlled, person}` and chat `{open, lines: [{from, name, text, speaking}], status, error, sending}`, where `speaking` is how the line is voiced (`pending`, `playing`) or null.
  - `people({radius = 90, limit = 8})`: crowd members nearest first, `{id, crowdId, npcId, name, type, gender, distance, position, look}`.
  - `approach(id)`: stands the player 1.3 m from member `id`, their front first, on ground within a step of theirs (`STEP_HEIGHT`) with nothing solid between that spot and their body (`PERSON_RADIUS`) at chest height (`CHEST`), aimed at the chest. After two frames: `{placed, person, target}`; `placed` is false when no spot qualifies.
  - `press(action = 'interact')`: E, or R for `secondary-interact`, on the next tick. After two frames: `{target, conversation}`.
  - `converse(id?, {attempts = 3})`: approach, then E, on `id` or the nearest people in turn. The conversation, or null.
  - `appearance({id, timeoutMs = 20000})`: one person's `crowd` look `{seed, body, hairStyle, skin, shirt, trousers, hair, eyebrows, sleeve, hem}` and the focused body's `hero` look in the same fields without `seed`. The crowd's eyebrows are its hair tint. The hero's fields are read from its model and dressed uniforms; its `hair` and `eyebrows` are the tint those meshes actually wear. A field the body is not dressed with is null. Without `id` it is the conversation's person, waiting up to `timeoutMs` for their focused body, and null when no conversation is open; with `id` it is that crowd member as they stand now, null when there is none. `hero` is null when no focused body shows the person.
  - `leave()`: ends the open conversation by the chat's own leave button. After two frames: `{conversation}`.
  - `say(text)`: `{ms, reply, added, status, error}` once the reply or its failure shows.
  - `voice({started = 0, played = 0, timeoutMs = 60000})`: the game's own NPC voice report (`NpcVoice.report()`, [Voice](../voice/CONTRACT.md)) once `started` lines have begun to play and `played` have played to their end, one more line has failed, the voice finds the server's voice unavailable or `timeoutMs` passes; null when a caller observes the lines instead.
  - `follow()`, `lead()`: `{supported: false, reason}`.

## Errors

Invalid reports are discarded. Transport or storage failures report a warning and do not interrupt gameplay. `approach` rejects an unknown member id. The probe never saves: a preview has no persistence.

## Dependencies

[Game](../CONTRACT.md), [Agents](../agents/CONTRACT.md) for the crowd models, [Physics](../physics/CONTRACT.md) and [Player](../player/CONTRACT.md) for the body measures, [Vite custom events](https://vite.dev/guide/api-plugin#client-server-communication).
