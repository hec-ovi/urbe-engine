# Local NPC speech

The browser sends structured NPC lines to a project-local Chatterbox Nano service and microphone recordings to faster-whisper. The voice client checks profile identity, model and runtime pins, PCM hashes, ordering, cancellation, and cache identity before playback.

## Install and verify

The runtime uses its own Python 3.12 environment. It never installs packages globally or downloads models.

```sh
npm run speech-install
npm run speech-health
npm run speech-smoke
```

`speech-health` loads both models. `speech-smoke` synthesizes a WAV and transcribes that generated audio.

The default model root is `$HOME/models/hf`. Override either verified snapshot with `URBE_CHATTERBOX_MODEL_DIR` or `URBE_WHISPER_MODEL_DIR`. CPU and Whisper `int8` are the defaults.

## Browser and Compose

Vite serves the checked browser boundary at `/api/speech`. Without `URBE_SPEECH_URL`, it starts the locked Python process directly. With that setting, it forwards to the container service and preserves request-scoped cancellation.

The container build context is `src/game/voice/runtime`, exposes port `8091`, and needs the Hugging Face model tree mounted at `/models/hf`.

```sh
docker build -t urbe-speech src/game/voice/runtime
docker run --rm -p 8091:8091 -v "$HOME/models/hf:/models/hf:ro" urbe-speech
```

See [CONTRACT.md](CONTRACT.md) for the exact envelopes and errors.
