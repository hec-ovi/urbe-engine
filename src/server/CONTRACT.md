# Development server contract

Contract version: 1.4

## Purpose

Expose checked development HTTP routes for world builds, the launcher, NPC dialogue, what people remember of it and NPC speech.

## Inputs

- `POST /api/building`: [schema/building-build-request.schema.json](schema/building-build-request.schema.json).
  An optional Exterior `request` creates a standalone paired building; see the
  [paired preview contract](../building/CONTRACT.md#paired-previews). It uses the existing
  generator APIs and never invents or rescales a facade to fit the requested lot.
- `GET /api/exteriors`: no input; checks local batch runtime prerequisites.
- `POST /api/exteriors`: [exact displayed blueprint envelope](schema/exterior-build-request.schema.json).
- `GET /api/exteriors/<id>`: job id returned by POST.
- `POST /api/launcher`: [schema/launcher-request.schema.json](schema/launcher-request.schema.json).
- `POST /api/talk` and `POST /api/talk/stream`: [schema/talk-request.schema.json](schema/talk-request.schema.json). `npc` is the Simulation NPCInstance the browser shows, including its optional `age`, `traits` and `transitJob`. `quests` is the optional exact `QuestSession.snapshot()`. Optional `offers` (`follow`, `places`) is what this NPC may propose, answered only on the stream; optional `guide` is the place it has led the player to.
- `GET /api/talk/memory?out=<out>` and `PUT /api/talk/memory`: [schema/talk-memory.schema.json](schema/talk-memory.schema.json), `{ out, memory }` for one served world, `memory` a game save's [dialogue memory](../library/schema/dialogue-memory.schema.json) of at most 200 people; GET takes the `out` alone.
- `GET /api/voice`: no input.
- `POST /api/voice`: [schema/voice-request.schema.json](schema/voice-request.schema.json), one line's raw text (cues included, at most 1200 characters) and its speaker, the [Voice speaker](../../../voice/schema/speaker.schema.json) the browser projects: `id` (the npcId), `gender`, `age`, `traits` (`[]` when none), and optional `category` and `label` from the world's NPC type and `persona` from the quest role the NPC is cast in.
- `POST /api/voice/prefetch`: [schema/voice-prefetch-request.schema.json](schema/voice-prefetch-request.schema.json), 1 to 8 such lines under a `group` whose later batch replaces the lines still waiting.
- `DELETE /api/voice/prefetch/<group>`: a batch's `group`, URL-encoded in the path.

## Outputs

- Building success: [schema/building-build-result.schema.json](schema/building-build-result.schema.json).
- Exterior capability: HTTP 200 [schema/exterior-capability.schema.json](schema/exterior-capability.schema.json).
- Exterior POST: HTTP 202 [job](schema/exterior-build-job.schema.json); polling returns HTTP 200 with the same shape.
- Launcher success: the selected result in [the launcher contract](../launcher/CONTRACT.md).
- Talk success: HTTP 200 [schema/talk-response.schema.json](schema/talk-response.schema.json).
- Talk stream: HTTP 200 `application/x-ndjson`, one [event](schema/talk-stream-event.schema.json) per line, in order: `delta` pieces of the cleaned reply; `sentence` with `index` from 0 each time a sentence completes, for per-sentence voice; `offer` for each companion action the NPC proposed from `offers`; `done` with the whole reply.
- Talk memory: GET answers HTTP 200 with the world's `{ out, memory }`, sorted by npcId; PUT answers HTTP 204 once the world's memory is the one sent and nothing else.
- Voice capability: HTTP 200 [schema/voice-capability.schema.json](schema/voice-capability.schema.json) `{ enabled, status }`: the Voice health `ok`, `loading` or `degraded`, `unreachable` when it does not answer within 3 s, `off` when `VOICE_BASE_URL` is empty; `enabled` only at `ok`.
- Voice line: HTTP 200 `audio/wav` (PCM16 mono 24 kHz) with `X-Voice-Key`, `X-Voice-Cache: hit|miss` and, for a cached line, `Content-Length`, sent once Voice has the first audio. A rendering line streams through as Voice decodes it, with the 44-byte header's sizes unknown (`0xFFFFFFFF`).
- Voice prefetch: HTTP 202 [schema/voice-prefetch-response.schema.json](schema/voice-prefetch-response.schema.json) `{ keys }`.
- Voice prefetch cancel: HTTP 204 with no body once Voice has dropped the group's queued lines and stopped its render; a line the browser listens to renders on.

## Errors

- Building failures use [schema/building-build-error.schema.json](schema/building-build-error.schema.json).
- Exterior errors: [schema/exterior-build-error.schema.json](schema/exterior-build-error.schema.json). Invalid JSON/envelope/duplicate parcel ids return 400, uploads over 128 MiB return 413, unavailable runtime 503, four retained jobs return 429 `E_BUSY`, absent job 404, storage failure 500. Background failures remain visible in the failed job.
- Launcher failures use `E_INVALID_REQUEST`, the closed library and creation errors, or `E_LAUNCHER` for an internal failure.
- Talk invalid JSON or request values return HTTP 400 [schema/talk-error.schema.json](schema/talk-error.schema.json) on every talk route, the memory routes included. World, dialogue, model and invalid output failures return the same shape with HTTP 502. On the stream, a failure after the first event ends it with one `error` event instead.
- Voice failures before the audio starts return [schema/voice-error.schema.json](schema/voice-error.schema.json) `{ error, code }`: `E_INVALID_REQUEST` 400 (invalid JSON, request values or group, checked before Voice sees them), `E_EMPTY_SPEECH` 400 (the line holds only cues), `E_BUSY` 429 (the prefetch queue is full), `E_LOADING` 503 (the Voice model still loads), `E_UNAVAILABLE` 503 (`VOICE_BASE_URL` empty or Voice unreachable), `E_UPSTREAM` 502 (any other Voice failure or refusal). A line that breaks off after its audio starts drops the connection before the body ends, so the browser's read fails; only a body that ends normally holds the whole line. A break while the browser still listens is logged; a browser leaving is not.

## Invariants

- A route invokes its service only after its request passes the public boundary.
- Talk uses the visible NPC, current behavior and current quest snapshot supplied by `GameApp`. A test checks real Simulation NPCs and behaviors against the request schema.
- The talk model is an OpenAI-compatible server: `LLM_BASE_URL` (default `http://localhost:8080/v1`), `LLM_MODEL` (empty: the first model the server lists), `LLM_API_KEY` (optional bearer token) and `LLM_TIMEOUT_MS` (default 60000). Every model request streams; one fails once the server sends nothing for the timeout, and a steady stream is never cut. The port passes text through as written; the Quests reply cleaner drops think blocks and template tokens. The port tallies the tokens the server reports, and the dev server logs the running totals after each reply.
- A completed exchange is remembered for that NPC; a failed or abandoned one is not. A browser that disconnects aborts the model request.
- Voice is the [Voice box](../../../voice/CONTRACT.md) at `VOICE_BASE_URL` (default `http://localhost:5308`, the port Compose publishes it on; Compose gives Engine `http://voice:8080`; empty turns voice off). Voice is optional: without it the capability reads `enabled: false` and lines fail with 503, and nothing else changes. A line's audio is piped through unbuffered, and a browser that leaves stops its render, whether Voice still queues it or already streams it. A prefetch cancel reaches Voice even when the browser leaves.
- Each served world directory keeps one dialogue state (every NPC's memory) for the session. It is built again when `blueprint.json`, `npc-types.json` or `quests/questlines.json` change or the directory is made again. A game hands its saved memory back at load and reads it at each save; both ways it is bounded to the 200 people spoken with last (by their latest turn) and each one's 24 newest folded notes, with their recent turns, and nobody who remembers nothing. Each turn holds exactly the questlines the request carries; one that leaves takes its knowledge along and memory stays. Districts and places without names reach the dialog layers unnamed. The theme is the blueprint's naming theme, else the game's `game.json` theme, else `a night city`.
- Routes return JSON, NDJSON lines on the talk stream, WAV on the voice line or no body on a prefetch cancel or a memory replace, with no undeclared fields.
- Filesystem services keep every resolved path inside the configured output root. Talk world paths contain no `.` or `..` segment.
- Building `out` accepts `/out` and nested output folders, including `/out/games/<id>`. Each segment starts with a letter or digit and contains at most 64 letters, digits, dots, underscores or hyphens. Existing sources are returned without rebuilding; missing sources use the carried blueprint or a named Atlas sample.
- Exterior jobs create a unique direct child of Engine `out`, reject a symbolic-link output root, and never replace existing worlds. They carry the supplied blueprint unchanged, without seed lookup or regeneration, and run public `assemble-city --interiors 0`. Connections remains a mandatory gate.
- The exterior boundary checks only its consumed Atlas envelope and safe unique parcel ids, not all Atlas geometry. Assembly performs downstream validation. `blueprintHash` is SHA-256 over recursively key-sorted JSON; arrays keep their order.
- Jobs run in submission order, one city batch at a time. They report complete nonempty regular shell/blueprint file pairs. Success additionally requires a schema-valid manifest matching every requested parcel, seed and Atlas version, no interiors, and an unchanged carried blueprint. Partial results never enable opening a completed city. Job state lives until server restart; generated files remain on disk.
- A declared manifest `connections` reference follows [Assembly's artifact contract](../assembly/CONTRACT.md). Final admission requires its nonempty regular file, the published Connections output schema, both source seeds and SHA-256 over the exact artifact and carried blueprint bytes. Missing or invalid declared data fails with `E_BUILD_INCOMPLETE`; a manifest with no `connections` field is accepted.
- Capability checks current local prerequisites; POST checks again. Four jobs are retained per server session, including terminal jobs, with no replacement. Terminal jobs release their full input blueprint from memory. The upload limit bounds input storage, not generated shell size.

## Browser client

`TalkClient` ([../game/talk/TalkClient.js](../game/talk/TalkClient.js)) posts the request for `GameApp` to `/api/talk/stream`. `stream(conversation, line, timeMin, quests?, { signal?, guide?, offers? })` is an async iterator over the stream events up to `done`; leaving it early or aborting `signal` ends the reply on the server. `memory()` reads the world's dialogue memory and `restoreMemory(memory)` replaces it. Failures throw an `Error` whose `status` is the HTTP status, 502 for an `error` event or a stream that ends before `done`.

`VoiceClient` ([../game/voice/VoiceClient.js](../game/voice/VoiceClient.js)) calls the voice routes for the game's [voice](../game/voice/CONTRACT.md).

## Dependencies

- [Building assembly](../assembly/CONTRACT.md)
- [Connections](../../../connections/CONTRACT.md)
- [Launcher](../launcher/CONTRACT.md)
- [Library](../library/CONTRACT.md), the dialogue memory schema by reference
- [Quests](../../../quests/CONTRACT.md)
- [Simulation](../../../simulation/CONTRACT.md)
- [Voice](../../../voice/CONTRACT.md), over HTTP only
