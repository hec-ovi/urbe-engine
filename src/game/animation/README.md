# Quest animation coordinator

This layer turns accepted quest and dialogue actions into exact Quaternius Pro clip sequences. It owns action lifecycle only. Quest progress, NPC routing, rendering, input, and UI stay outside.

```js
import { AnimationCoordinator } from './index.js';

const coordinator = new AnimationCoordinator( config );

const result = coordinator.dispatch( {
  version: '1',
  commandId: 'command:turn-12',
  kind: 'dialogue-turn',
  actionId: 'quest-main:step-3:turn-12',
  speakerId: 'npc-mara',
  listenerIds: [ 'npc-ivo' ]
} );
```

Play each returned transition segment in order and crossfade by `blendMs`. Report `complete` when a one-shot clip ends or when an explicit action ends. Then send `resume-routine` after quest state has released the actors.

Supported variants are `idle`, `sit`, ground or table pickup, `read`, `observe`, ground or table steal, counter, repair or generic work, `deliver`, follow walk or sprint, and stationary or forward crouch. Dialogue chooses standing or seated talk and listen clips from each actor's synchronized routine posture.

`fixtures/pro-coordinator-config.json` records the 120 clip names and source hash audited from the installed Pro GLB. Run the focused tests with:

```sh
npx vitest run src/game/animation/tests
```
