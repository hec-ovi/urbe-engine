# Engine contract

Version 0.26.8. Loads assembled city artifacts into a first-person game and exposes catalog, creation, preview, dialogue and save adapters.

## Inputs and outputs

| Entry | Request | Result |
| --- | --- | --- |
| `npm run play` | Vite arguments; `--port 5306` selects the port | Launcher at `/`, resource mounts and HTTP routes. `npm run dev` also watches source files. |
| `POST /api/launcher` | [Method and input](src/server/schema/launcher-request.schema.json) | Method results below |
| `?mode=game` | [Query and parsed settings](src/game/data/schema/game-config.d.ts) | Playable session through [Game](src/game/CONTRACT.md) |
| Assembly CLIs | [Assembly requests and flags](src/assembly/CONTRACT.md) | [World manifest](src/assembly/schema/world-manifest.schema.json), [kit placement tables](src/assembly/kit/kit-placements.schema.json), GLBs and floor documents |
| `POST /api/building` | [Building request](src/server/schema/building-build-request.schema.json) | [Building result](src/server/schema/building-build-result.schema.json) |
| `POST /api/talk` | [NPC, behavior, line, time and optional quests](src/server/schema/talk-request.schema.json) | [Reply](src/server/schema/talk-response.schema.json) |
| `/api/exteriors` | [Capability and exact-blueprint jobs](src/server/CONTRACT.md) | [Capability](src/server/schema/exterior-capability.schema.json) or [job](src/server/schema/exterior-build-job.schema.json) |

Launcher `catalog` and `importGame` return the [browser catalog](src/launcher/schema/catalog.schema.json). `continueGame` returns [playUrl](src/launcher/schema/launcher-api.schema.json#/$defs/continueResult). `exportGame` and `saveCurrent` return a [game descriptor](src/library/schema/game-descriptor.schema.json); `exportCity` returns a [city descriptor](src/library/schema/city-descriptor.schema.json). Creation results use the corresponding `generateCityResult`, `generateInstancesResult`, `generateQuestsResult` and `createGameResult` definitions in the [launcher API schema](src/launcher/schema/launcher-api.schema.json).

A catalog game owns its directory and acknowledged save revision. A direct `out` preview is session-only. JSON exports contain descriptors and references, not packaged model or texture bytes. World and quest format versions remain separate from the Engine package version.

## Previews

- `?mode=city&out=/out/<world>`: generated city and parcel selection.
- `?mode=building&parcel=<id>&out=/out/<world>&source=shell|interior`: [building preview](src/building/CONTRACT.md).
- `?mode=experiment`: [render experiment](docs/INDEX.md#previews) with URL settings from `RunConfig`.
- `/src/game/props/preview/`: [street models](src/game/props/preview/CONTRACT.md).

## Errors

- Launcher returns `{code,message}`: `E_INVALID_REQUEST`, `E_CREATION_UNAVAILABLE`, `E_LAUNCHER`, plus [Library](src/library/schema/library-error.schema.json) and [Creation](src/creation/schema/creation-error.schema.json) codes.
- Building and exterior routes declare the closed sets in [building errors](src/server/schema/building-build-error.schema.json) and [exterior errors](src/server/schema/exterior-build-error.schema.json).
- Talk returns HTTP 400 for malformed input or 502 for service failure, with [an error string](src/server/schema/talk-error.schema.json).
- Game admission, asset loading, persistence and interaction failures follow [Game](src/game/CONTRACT.md) and its linked interfaces. Startup failure displays its message and does not grant play.

Launcher and building routes can also pass through a dependency's error code. Startup has no global error enum. Closing those existing output surfaces requires the proposals in [Issues](docs/ISSUES.md).

## Dependencies

[Atlas](../atlas/CONTRACT.md), [Connections](../connections/CONTRACT.md), [Exterior](../exterior/CONTRACT.md), [Interior](../interior/CONTRACT.md), [Materials](../materials/CONTRACT.md), [Simulation](../simulation/CONTRACT.md), [Naming](../naming/CONTRACT.md) and [Quests](../quests/CONTRACT.md). Internal boundaries and schema links: [box map](docs/INDEX.md).

Rendering uses Three.js with WebGPU and WebGL2 paths; physics uses Rapier; mesh optimization uses meshoptimizer. Source identities, dimensions, material keys and published artifact versions remain producer-owned.
