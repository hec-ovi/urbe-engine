# Development server contract

Contract version: 1.0

## Purpose

Expose checked development HTTP routes for world builds, the launcher, NPC dialogue and local speech.

## Inputs

- `POST /api/building`: [schema/building-build-request.schema.json](schema/building-build-request.schema.json).
- `POST /api/launcher`: [schema/launcher-request.schema.json](schema/launcher-request.schema.json).
- `POST /api/talk`: [schema/talk-request.schema.json](schema/talk-request.schema.json). `quests` is the optional exact `QuestSession.snapshot()` sent by `GameApp`.
- `/api/speech`: capability, health, synthesis and transcription requests in [the voice contract](../game/voice/CONTRACT.md).

## Outputs

- Building success: [schema/building-build-result.schema.json](schema/building-build-result.schema.json).
- Launcher success: the selected result in [the launcher contract](../launcher/CONTRACT.md).
- Talk success: HTTP 200 [schema/talk-response.schema.json](schema/talk-response.schema.json).
- Speech success: the capability, health, audio or transcription value in [the voice contract](../game/voice/CONTRACT.md).

## Errors

- Building failures use [schema/building-build-error.schema.json](schema/building-build-error.schema.json).
- Launcher failures use `E_INVALID_REQUEST`, the closed library and creation errors, or `E_LAUNCHER` for an internal failure.
- Talk invalid JSON or request values return HTTP 400 [schema/talk-error.schema.json](schema/talk-error.schema.json). World, dialogue, model and invalid output failures return the same shape with HTTP 502.
- Speech uses HTTP 400 for invalid JSON or envelopes, 413 for body size, and 503 for runtime, model or inference failures.

## Invariants

- A route invokes its service only after its request passes the public boundary.
- Talk uses the visible NPC, current behavior and current quest snapshot supplied by `GameApp`. An empty `LLM_MODEL` selects the first model advertised by `LLM_BASE_URL`.
- Routes return JSON with no undeclared fields. Speech responses are not cached.
- Filesystem services keep every resolved path inside the configured workspace or output root.

## Dependencies

- [Building assembly](../assembly/CONTRACT.md)
- [Launcher](../launcher/CONTRACT.md)
- [Library](../library/CONTRACT.md)
- [NPC voice](../game/voice/CONTRACT.md)
- [Quests](../../../quests/CONTRACT.md)
- [Simulation](../../../simulation/CONTRACT.md)

## How to modify this blackbox safely

Change schemas before route shapes. Exercise each route through HTTP, including one accepted request and every declared response class.
