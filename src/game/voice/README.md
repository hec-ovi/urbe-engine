# NPC voice client

This folder owns the engine-side contract between structured NPC dialogue and a future local TTS service. It provides deterministic profile and cache identity, a priority queue, cancellation, exact PCM pauses, checked ordered chunks, reaction fallbacks, and JSON packets that a host AudioWorklet can place in a ring buffer.

`FakeVoiceAdapter` exercises the complete lifecycle without a model:

```js
import { FakeVoiceAdapter, NpcVoiceClient } from './index.js';

const adapter = new FakeVoiceAdapter( { manifest } );
const voices = new NpcVoiceClient( { adapter } );
const profileRecord = await voices.registerProfile( profile );

await voices.start( { ...request, profileDigest: profileRecord.profileDigest } );
const result = await voices.wait( { version: '1', requestId: request.requestId } );
```

Run the layer tests with:

```sh
npx vitest run src/game/voice/tests/NpcVoiceClient.test.js
```

No TTS checkpoint is bundled or downloaded. Production use needs a persistent local adapter selected by the recorded bakeoff, plus an audio host that decodes each chunk envelope and forwards frames to an AudioWorklet.
