# NPC voice contract

Contract version: 1.0

## Purpose

Turn structured NPC speech into deterministic, checked audio chunk envelopes without binding gameplay to a TTS runtime.

## Inputs

- `NpcVoiceClient.registerProfile(profile)`: one immutable consented NPC identity described by [schema/voice-profile.schema.json](schema/voice-profile.schema.json). The language and pinned engine must match the active capability manifest. Reference media is content-addressed metadata. The client never stores an embedding or model cache in the profile.
- Adapter capability manifest: `adapter.capabilities()` returns [schema/capability-manifest.schema.json](schema/capability-manifest.schema.json) before the client accepts work. It pins model, runtime, audio format, concurrency, language support, and every structured control.
- `NpcVoiceClient.start(request)`: a prioritized request described by [schema/speech-request.schema.json](schema/speech-request.schema.json). Content is an ordered array of text and control spans. A request ID can be accepted once.
- `NpcVoiceClient.wait(request)`: a terminal result lookup described by [schema/wait-request.schema.json](schema/wait-request.schema.json).
- `NpcVoiceClient.cancel(request)`: a queued or active cancellation described by [schema/cancel-request.schema.json](schema/cancel-request.schema.json).
- Adapter synthesis call: the client sends each contiguous native segment as [schema/adapter-request.schema.json](schema/adapter-request.schema.json). The adapter receives an `AbortSignal` beside the JSON envelope as process-local cancellation state.
- Adapter chunk: each yielded adapter value must match [schema/adapter-chunk.schema.json](schema/adapter-chunk.schema.json).
- `AudioWorkletPacketTransport.push(event)`: one ordered lifecycle envelope described by [schema/lifecycle-event.schema.json](schema/lifecycle-event.schema.json).
- `AudioWorkletPacketTransport.read(request)`: a cursor read described by [schema/playback-read.schema.json](schema/playback-read.schema.json).

## Outputs

- Registered profile record: [schema/profile-record.schema.json](schema/profile-record.schema.json). `profileDigest` is the SHA-256 of canonical profile JSON.
- Capability query: [schema/capability-manifest.schema.json](schema/capability-manifest.schema.json).
- Accepted request: [schema/start-result.schema.json](schema/start-result.schema.json). The cache key is known before synthesis starts.
- Terminal request result: [schema/speech-result.schema.json](schema/speech-result.schema.json). It contains every emitted chunk and realized control, including partial chunks after cancellation or failure.
- Cancellation result: [schema/cancel-result.schema.json](schema/cancel-result.schema.json).
- Public audio chunk: [schema/audio-chunk.schema.json](schema/audio-chunk.schema.json). Each chunk has an absolute frame offset, sequence, format, byte count, SHA-256, source, and exactly one inline base64 payload or URI.
- Playback cursor batch: [schema/playback-batch.schema.json](schema/playback-batch.schema.json). A host can decode these packets and write them into an AudioWorklet ring buffer at `startFrame`.
- Lifecycle history: [schema/event-history.schema.json](schema/event-history.schema.json).

## Events

[schema/lifecycle-event.schema.json](schema/lifecycle-event.schema.json) defines `accepted`, `started`, `cache-hit`, `chunk`, `completed`, `cancelled`, and `failed`. `eventSequence` and chunk `sequence` both begin at zero per request and have no gaps.

## Errors

Immediate calls fail closed with:

- `E_VOICE_INPUT`: an input does not match its schema.
- `E_VOICE_OUTPUT`: this layer produced an off-contract value.
- `E_VOICE_PROFILE`: a profile is unknown, mismatched, invalid for the adapter, or changes an existing revision.
- `E_VOICE_CONTROL`: the adapter cannot natively execute a control and the profile has no approved reaction fallback.
- `E_VOICE_CONFLICT`: a request ID was reused.
- `E_VOICE_NOT_FOUND`: `wait` addressed an unknown request.
- `E_VOICE_CODEC`: a requested or supplied audio format differs from the manifest.
- `E_VOICE_CACHE`: the injected cache does not implement `get`, `has`, and `set`.
- `E_VOICE_ADAPTER`: the adapter API is absent.
- `E_VOICE_CHUNK`: inline audio bytes disagree with declared size, PCM arithmetic, or SHA-256.
- `E_VOICE_TRANSPORT`: an event or chunk arrived out of order.

Terminal failed results use the closed failure set in [schema/values.schema.json](schema/values.schema.json): `E_VOICE_ADAPTER`, `E_VOICE_CHUNK`, `E_VOICE_ORDER`, or `E_VOICE_SILENCE`.

## Dependencies

- A voice adapter implementing `capabilities()` and async-generator `synthesize(adapterRequest, abortSignal)` at the schemas above.
- Web Crypto SHA-256, `TextEncoder`, `atob`, and `btoa`.
- Optional JSON cache implementing `get`, `has`, and `set`.

No model is selected or downloaded by this layer. A local bakeoff must choose and pin a Chatterbox Nano, Pocket TTS, or CosyVoice adapter before production synthesis is connected.

## Invariants

- Profile identity includes stable NPC ID, profile revision, seed, language, delivery, immutable consented reference metadata, transcript, provenance, license, and engine revision.
- Derived embeddings, generated speaker states, and model caches never enter the profile or its digest.
- Cache identity includes contract version, profile digest, NPC ID, model and runtime pins, structured content, merged delivery, profile seed, inference seed and options, sample format, and codec version. It excludes request ID and priority.
- Priorities are `conversation`, `nearby`, then `background`, with FIFO order inside one priority. Active work is bounded by `maxConcurrent`.
- Unsupported controls never disappear. They fail before enqueue, or use the profile's explicitly approved reaction when the manifest declares `reaction`.
- `pause_ms` creates zero-valued PCM with exactly `durationMs * sampleRate / 1000` frames. A fractional frame or non-PCM output fails.
- Inline audio is checked against byte count and SHA-256 before publication. PCM byte count is exactly `frameCount * channels * 2`.
- Cancelling active work aborts the adapter. Already published chunks stay ordered in the terminal result.
- The transport contains JSON envelopes only. It does not expose raw shared memory across this contract.

## How to modify this blackbox safely

Change only this folder. Add or change a schema before changing a public value, keep the contract links exact, and exercise the public client plus transport in `tests/`. Breaking shapes require a parallel contract version and caller migration. A production adapter must preserve model pins, cancellation, ordering, checksums, and capability failures.
