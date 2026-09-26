# CONTRACT: NPC voice

Purpose: speaks the lines NPCs say in the chat, in each person's own voice from the [Voice box](../../../../voice/CONTRACT.md), through the page's Web Audio. The text is on screen first; the audio follows.

## Inputs

- `new NpcVoice({ dialog, types, persona, hold, enabled, volume })`: `dialog` is the [ChatPanel](../../ui/CONTRACT.md) whose lines it marks, `types` the world's NPC type definitions (Naming's set, else Simulation's default set), `persona(npcId)` the quest role persona the person is cast in or null (`QuestSession.persona`), `hold(conversation, seconds)` keeps the person talking while their audio plays (`GameplayAnimationDirector.holdDialogueTurn`).
- As GameApp's line observer ([Game](../CONTRACT.md)): `said({ conversation, line, text })` queues the raw text, cues included, `silenced()` stops, `upcoming({ conversation, texts })` renders the replies the player's choices would bring ahead through `/api/voice/prefetch`.
- `setEnabled(boolean)` and `setVolume(0..1)` from the settings; `player.unlockOn(window)` lets the audio clock run from the first key or pointer press, which browsers require.

## Outputs

- Audio on the page's output. `ChatPanel.setSpeaking(line, state)` marks a line `pending` once queued, `playing` once its audio starts and `idle` when its last piece ends or stops.
- `report()`: `{ enabled, status, queued, requested, started, played, bytes, cached, failed, error }`, where `status` is the last capability read (`unknown` before the first line), `played` counts lines that played to their end unsilenced, and the counts cover the session.

## Behaviour

- Speaker: `{ id: npcId, gender, age, traits ([] when none), category?, label? }` from the conversation's Simulation instance and its type, plus `persona` (its first 4000 characters) when the person is cast. A conversation without an instance, gender or whole-year age (a passer-by) is not voiced, nor a line of cues alone, nor anyone while voice is off.
- One person speaks at a time and lines play in the order they were said. Downloads run one at a time in that order, as Voice renders them; a line longer than 1200 characters is spoken in pieces cut after a sentence, else between words.
- A streamed line starts once enough has arrived to play through: what is buffered covers the line's expected rest (10 characters a second) times the share by which audio arrives slower than real time, plus 0.25 s, at least 0.3 s. The arrival rate is this line's own weighed against the rate learned from earlier lines (starting at 0.8 s of audio per second). A line that runs dry buffers again the same way. A line that has all arrived starts at once.
- `silenced()` aborts the download, stops the audio at once and drops every queued line. Turning voice off does the same.
- A line heard whole stays in a session cache of decoded samples keyed by the person and the text (at most 48 MiB and 64 lines, least recently used out) and replays without a request. A line whose read fails plays what arrived and is never kept.
- `GET /api/voice` is asked before the first line. While it is not `ok`, or after a line fails with 503, no line is voiced for 30 s, then it is asked again. Any failure is logged and leaves the conversation as it was.

## Errors

None surface: every failure is logged, counted in `report()` and leaves the line silent.

## Dependencies

[Server voice routes](../../server/CONTRACT.md), [UI](../../ui/CONTRACT.md) ChatPanel, [Game](../CONTRACT.md) line observer, Web Audio.
