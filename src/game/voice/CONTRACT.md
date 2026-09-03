# NPC voice contract

Contract version: 1.1

## Purpose

Turn structured NPC speech into verified local audio, play its absolute PCM timeline, and transcribe microphone media without exposing model internals to gameplay.

## Inputs

- `NpcVoiceClient.registerProfile(profile)`: immutable identity in [schema/voice-profile.schema.json](schema/voice-profile.schema.json). The local runtime accepts only preset `chatterbox-nano-built-in` at its exact `conds.pt` SHA-256.
- `NpcVoiceClient.start(request)`: prioritized structured speech in [schema/speech-request.schema.json](schema/speech-request.schema.json).
- `wait(request)` and `cancel(request)`: [schema/wait-request.schema.json](schema/wait-request.schema.json) and [schema/cancel-request.schema.json](schema/cancel-request.schema.json).
- Adapter synthesis: [schema/adapter-request.schema.json](schema/adapter-request.schema.json) and an `AbortSignal`.
- Adapter chunks: [schema/adapter-chunk.schema.json](schema/adapter-chunk.schema.json).
- `LocalSpeechRuntime.transcribe(media, options)`: `audio/wav`, normalized `audio/webm`, `audio/ogg`, or `audio/mp4`. Its checked service request is [schema/transcription-request.schema.json](schema/transcription-request.schema.json). `auto` omits the faster-whisper language parameter.
- `DialogueSpeech.speak(conversation, text, lifecycle)`: one stable NPC, one line, and playback start/end callbacks used by `GameApp` animation composition.
- `DialogueSpeech.startTranscription()` and `stopTranscription()`: microphone gestures used by the live chat composer. A cancelled permission request returns `false` and stops its late stream.
- `PcmAudioPlayer.play(chunks)`: ordered [schema/audio-chunk.schema.json](schema/audio-chunk.schema.json) values with absolute `startFrame` positions.
- `AudioWorkletPacketTransport.push(event)` and `read(request)`: [schema/lifecycle-event.schema.json](schema/lifecycle-event.schema.json) and [schema/playback-read.schema.json](schema/playback-read.schema.json).

## Service API

Vite exposes capabilities, health, synthesis and transcription under `/api/speech`. The standalone service exposes the same four routes at its root on port `8091` and adds cancellation for the HTTP transport.

- `GET /capabilities`: [schema/runtime-capabilities.schema.json](schema/runtime-capabilities.schema.json).
- `GET /health`: `{status:"ready", tts, stt}` after both models load. `tts` and `stt` are the capability records above.
- `POST /synthesize`: [schema/adapter-request.schema.json](schema/adapter-request.schema.json), returns `{chunk}` where `chunk` is [schema/adapter-chunk.schema.json](schema/adapter-chunk.schema.json).
- `POST /transcribe`: [schema/transcription-request.schema.json](schema/transcription-request.schema.json), returns [schema/transcription-result.schema.json](schema/transcription-result.schema.json).
- Standalone `POST /cancel`: `{requestId}`, returns `{requestId,cancelled,previousStatus}`. Cancellation removes only that queued request or terminates its active model process. A browser abort reaches this route through `SpeechRuntimeHttp`; it is not a separate Vite route.

POST bodies above 48 MiB fail with HTTP 413. Invalid envelopes, missing or changed artifacts, model load failures, and inference failures return HTTP 503 `{error}`. The browser maps transport failures to `E_VOICE_ADAPTER`.

## Outputs

- Profile record: [schema/profile-record.schema.json](schema/profile-record.schema.json).
- Accepted and terminal speech: [schema/start-result.schema.json](schema/start-result.schema.json) and [schema/speech-result.schema.json](schema/speech-result.schema.json).
- Cancellation: [schema/cancel-result.schema.json](schema/cancel-result.schema.json).
- Public audio: [schema/audio-chunk.schema.json](schema/audio-chunk.schema.json).
- Playback batch and lifecycle history: [schema/playback-batch.schema.json](schema/playback-batch.schema.json) and [schema/event-history.schema.json](schema/event-history.schema.json).
- Transcription: [schema/transcription-result.schema.json](schema/transcription-result.schema.json).

## Errors

Immediate calls fail closed with:

- `E_VOICE_INPUT`: input or microphone metadata does not match its schema or advertised capability.
- `E_VOICE_OUTPUT`: this box produced an invalid value.
- `E_VOICE_PROFILE`: profile identity, revision, language, preset, or engine pin is invalid.
- `E_VOICE_CONTROL`: a structured control has no native or approved reaction implementation.
- `E_VOICE_CONFLICT`: a request ID was reused.
- `E_VOICE_NOT_FOUND`: `wait` addressed an unknown request.
- `E_VOICE_CODEC`: requested, emitted, or playable audio differs from the capability.
- `E_VOICE_CACHE`: the injected cache is invalid.
- `E_VOICE_ADAPTER`: service, model, browser audio, or adapter failure.
- `E_VOICE_CHUNK`: audio bytes disagree with frame count, byte count, or SHA-256.
- `E_VOICE_ORDER`: chunks overlap, skip sequence, or belong to another request.
- `E_VOICE_TRANSPORT`: lifecycle packets are out of order.

Terminal results use `E_VOICE_ADAPTER`, `E_VOICE_CHUNK`, `E_VOICE_ORDER`, or `E_VOICE_SILENCE` from [schema/values.schema.json](schema/values.schema.json).

## Dependencies

- Chatterbox repository commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`. Its `ChatterboxTurboTTS.from_local(..., nano=True)` API loads the verified Nano snapshot; the published 0.1.7 package does not expose this Nano parameter.
- `faster-whisper` 1.2.1.
- Python 3.12, CPU PyTorch 2.6.0, and the exact dependency graph in [runtime/uv.lock](runtime/uv.lock).
- Chatterbox Nano revision `71ccd1d` and faster-whisper small snapshot `536b066`, supplied outside the repository under the configured model directories.
- Browser Web Crypto, MediaRecorder, and Web Audio.

## Invariants

- Every model file read by either loader has a fixed SHA-256. Capability identity combines all required model artifacts. Runtime identity covers service code, Dockerfile, project metadata, and lockfile.
- The built-in Nano preset is the only accepted profile. Reference cloning and changed preset digests fail.
- Cache identity includes contract, profile, NPC, model, runtime, content, delivery, inference, and output pins. Request ID and priority do not affect it.
- Priorities are `conversation`, `nearby`, then `background`, with FIFO order and one active inference.
- Unsupported controls do not disappear. Exact pauses produce whole zero-valued PCM frames.
- Audio bytes are verified before publication, transcription, and playback.
- Playback places each chunk at its absolute `startFrame`, rejects overlaps and format changes, and resolves cancellation even while Web Audio unlock is pending.
- GameApp unlocks Web Audio from the send or microphone gesture. NPC speaking starts only when PCM playback starts and settles when playback ends or is cancelled. A transcript enters the same dialogue send path as typed text.
- Active cancellation terminates inference. Queued cancellation never terminates another request.
- `speech-health` loads both models. `speech-smoke` performs real Chatterbox synthesis and faster-whisper transcription.

## How to modify this blackbox safely

Change only this folder. Define public values in schemas before changing code. Exercise the client, browser adapter, playback, HTTP boundary, cancellation, and real model smoke through their public entrypoints. Breaking shapes require a parallel contract version and caller migration.
