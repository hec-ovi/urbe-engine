# Investigation scenes

This layer turns incident facts supplied by story and gameplay adaptation into fitted scene placements and persistent evidence state.

```js
import { InvestigationRuntime, SceneAssembler } from './index.js';

const assembly = new SceneAssembler().assemble( authoredScene );
const runtime = new InvestigationRuntime( assembly );

const visibleTargets = runtime.targets( { state: assembly.initialState } );
const result = runtime.perform( {
	targetKey: visibleTargets[ 0 ].targetKey,
	action: 'inspect',
	state: assembly.initialState,
	focus: { visible: true, unobstructed: true, distanceMeters: 1.4 }
} );
```

Live play loads version 1.1 requests through `InvestigationGameplay.create`, which checks every quest binding, renders the scene, applies E/R interactions, and serializes scene state for catalog saves.

`fixtures/interior-incident.json` uses the installed Source female body, the audited Pro `Death02` final pose, a generated data-drive assembly, and a fitted blood decal. `fixtures/street-incident.json` uses a generated control-terminal assembly and fitted tyre-transfer decal in a rotated street frame. Both fixtures carry production media references and exact quest bindings.
