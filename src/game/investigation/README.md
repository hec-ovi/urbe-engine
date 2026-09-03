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

`fixtures/interior-incident.json` covers a body, a fitted floor decal and portable evidence. `fixtures/street-incident.json` covers a rotated street frame. The model URIs are contract examples; production requests must carry real creator-owned URI, checksum and size metadata. Dedicated blood and tyre-transfer materials are required at the fixture keys `cyberpunk/incident-blood/mid` and `cyberpunk/incident-tyre/poor`.
