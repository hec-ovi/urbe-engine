# CONTRACT: NPC voice

Purpose: speaks the lines NPCs say in the chat, in each person's own voice from the [Voice box](../../../../voice/CONTRACT.md), through the page's Web Audio. The text is on screen first; the audio follows.

## Inputs

- `NpcVoice.forGame({ dialog, npcTypes, quests, animations, enabled, target })`, GameApp's voice: `dialog` is the [ChatPanel](../../ui/CONTRACT.md) whose lines it marks, `npcTypes` the world's NPC type set (Naming's, else Simulation's default set) for the speaker's category and label, `quests.persona(npcId)` the quest role persona the person is cast in or null, `animations.holdDialogueTurn(conversation, seconds)` keeps the person talking while their audio plays, `animations.speaking(conversation, speech)` hears whose audio plays, and `target` (the window) the element whose key and pointer presses let the audio clock run, which browsers require. It listens only while voice is on and stops once the clock runs.
- `new NpcVoice({ dialog, types, persona, hold, speaking, enabled, volume, client, player, cache })` takes the type definitions (`types`), `persona(npcId)`, `hold(conversation, seconds)` and `speaking(conversation, speech)` directly, plus the Voice client, Web Audio player and session cache.
- As GameApp's line observer ([Game](../CONTRACT.md)): `said({ conversation, line, text })` queues the raw text, cues included, `silenced()` stops and drops what is rendered ahead, `upcoming({ conversation, texts })` renders the replies the player's choices would bring ahead through `/api/voice/prefetch`.
- `setEnabled(boolean)` and `setVolume(0..1)` from the settings. Off also lets the audio clock rest; on asks it to run again.
- `setPaused(boolean)` from the game's pause (`VoicePlayer.setPaused`): paused, the audio clock stops where it is and no line starts; unpaused, both go on. Voice turned off during the pause stays at rest, and presses during it do not start the clock.

## Outputs

- Audio on the page's output. `ChatPanel.setSpeaking(line, state)` marks a line `pending` once queued, `playing` once its audio starts and `idle` when its last piece ends or stops.
- `speaking(conversation, speech)` as each piece's audio starts, and `speaking(conversation, null)` when that piece ends or stops. `speech` is `{ seed, loudness }`, one object per piece: `seed` a 32-bit number of the person and the words (FNV-1a), so a line heard again has the same, and `loudness()` the loudness of what plays now.
- `VoicePlayer.loudness()`: the root mean square of the last 1024 samples the lines played, read from an AnalyserNode the lines pass before the volume, so the volume setting leaves it alone. 0 in silence and before the audio clock exists, about 0.1 to 0.3 in Maya1 speech. It reads into one buffer kept for the session and allocates nothing, so it is read every frame.
- `report()`: `{ enabled, status, queued, requested, started, played, bytes, cached, failed, error }`, where `status` is Voice's state as last known: the last capability read, or `loading`, `unreachable` or `degraded` after lines failed (`unknown` before the first line), `played` counts lines that arrived whole and played to their end unsilenced, `failed` counts lines whose request or read failed, a line that broke off included, and the counts cover the session.

## Behaviour

- Speaker: `{ id: npcId, gender, age, traits ([] when none), category?, label? }` from the conversation's Simulation instance and its type, plus `persona` (its first 4000 characters) when the person is cast. A conversation without an instance, gender or whole-year age (a passer-by) is not voiced, nor a line of cues alone, nor anyone while voice is off.
- One person speaks at a time and lines play in the order they were said. Downloads run one at a time in that order, as Voice renders them; a line longer than 1200 characters is spoken in pieces cut after a sentence, else between words.
- A streamed line starts once enough has arrived to play through: what is buffered covers the line's expected rest (10 characters a second) times the share by which audio arrives slower than real time, plus 0.25 s, at least 0.3 s. The arrival rate is this line's own weighed against the rate learned from earlier lines (starting at 0.8 s of audio per second). A line that runs dry buffers again the same way. A line that has all arrived starts at once.
- Upcoming lines go to Voice as one batch of at most 8 in the session's prefetch group, once the lines said before them have loaded, so Voice renders those first; lines already in the session cache are left out. A batch still waiting when the conversation is silenced is dropped unsent.
- `silenced()` aborts the download, stops the audio at once and drops every queued line and waiting batch. When a batch went out since the last silence, it also cancels the session's prefetch group through `DELETE /api/voice/prefetch/<group>`. The cancel goes once that batch's request is answered, so Voice sees them in order, and once Voice has answered the lines said right after the silence in the same task (or they were not asked for), so a chosen reply rendered ahead goes on rendering for its listener. Turning voice off does the same.
- A line heard whole stays in a session cache of decoded samples keyed by the person and the text (at most 48 MiB and 64 lines, least recently used out) and replays without a request. A line whose read fails plays what arrived and is never kept.
- `GET /api/voice` is asked before the first line. While it is not `ok`, after a line fails with 503, or once two lines in a row fail with 502 or break off after their audio starts (Voice answers but its model server does not; `status` reads `degraded`; only a line heard whole ends the run), no line is voiced for 30 s, then it is asked again. Any failure is logged and leaves the conversation as it was.

## Errors

None surface: every failure is logged and leaves the line silent; failed lines are counted in `report()`.

## Dependencies

[Server voice routes](../../server/CONTRACT.md), [UI](../../ui/CONTRACT.md) ChatPanel, [Game](../CONTRACT.md) line observer, [Simulation](../../../../simulation/CONTRACT.md) `DEFAULT_TYPE_SET`, Web Audio.
