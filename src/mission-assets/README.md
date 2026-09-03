# Mission assets

This blackbox builds measured mission props and furniture as renderer-neutral geometry assemblies. It supports documents, data drives, evidence containers, tools, control terminals, packages, tables, chairs, shelves and cabinets.

Callers provide exact dimensions, existing Materials keys and variants, required interactions, clearance policy and a seed. The output carries shaped local geometry, collision, anchors, operating space, portability and a SHA-256 reference to its canonical JSON payload. It contains no placement or gameplay state.

```js
import { MissionAssetRegistry } from "./src/index.js";
import materialCatalog from "./fixtures/material-catalog.valid.json";
import request from "./fixtures/control-terminal.request.json";

const registry = new MissionAssetRegistry(materialCatalog);
const terminal = registry.create(request);
```

Run the boundary suite with:

```sh
npx vitest run src/mission-assets/tests/MissionAssetBoundary.test.js
```

See [CONTRACT.md](CONTRACT.md) for the complete input, output and error shapes. See [SKILL.md](SKILL.md) before adding a family or material rule.
