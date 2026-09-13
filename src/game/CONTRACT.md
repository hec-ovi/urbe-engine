# Game contract

Plays assembled city artifacts in a continuous first-person scene with physics, simulation, quests and saved progress.

## Input

- `new GameApp(config).start()` starts the browser session; `GameApp.configFromUrl()` reads the [query and parsed settings](data/schema/game-config.d.ts). The application entry is `?mode=game`.
- `game` loads the [saved descriptor](persistence/schema/game-state.schema.json) from `/out/games/<id>` and owns that directory. Without it, `out` is a session-only preview. The default preview is `/out/city-tiny` with Atlas sample `city-urbe-tiny`.
- [World manifest](../assembly/schema/world-manifest.schema.json): exact shell IDs, selected interiors, floor tags, source versions and optional archive, Connections, shell catalog and rooftop references. The carried blueprint is preferred. A declared Connections artifact requires matching seeds and byte hashes; manifests without it retain in-process Connections generation and sample fallback.
- [World Archive](../world-archive/CONTRACT.md) validates bounded part hashes and counts. With prepared Connections, runtime reads omit optional Atlas construction planning proofs.
- [Building sources](data/schema/world-buildings.d.ts): Exterior blueprint and GLB for every listed shell; NPC data and per-floor JSON/GLB only for manifest interiors. Source reads share eight concurrent requests. Catalogs above 250 shells select nearby sources plus all interiors; smaller or legacy worlds load every listed source.
- [Materials](../../../materials/CONTRACT.md) catalogs under `/materials`, character and vehicle assets under `/models`, and optional Naming NPC types beside the world. Missing NPC types use Simulation's built-in set.
- [Quest Bundle](../quest-bundle/CONTRACT.md) validates the Quests handoff. A catalog descriptor with `questBundle: null` loads no quest or investigation files. Direct previews also accept standalone questlines.

## Output

- A browser play session. `tick(delta)` advances elapsed seconds through clock, physical actors, interaction and rendering. Startup errors remain on the loading view; `start()` catches them.
- `WorldSource.load()` returns the [building-source ports](data/schema/world-buildings.d.ts), Atlas and Connections data, optional quest catalogs, NPC types and the requested game descriptor. `loadBuildings(ids)` reads unique manifest IDs without owning residency. `unbuilt` lists Atlas parcels absent from the manifest.
- [GamePersistence](persistence/CONTRACT.md) serializes [live state](persistence/schema/live-state.schema.json) to a [save payload](persistence/schema/save-current-payload.schema.json) and verifies the [acknowledged result](persistence/schema/save-result.schema.json). Leaving a catalog game waits for that save. Position is the player's feet; heading is camera yaw in radians.
- [UI](../ui/CONTRACT.md) receives world values and action callbacks. Escape releases capture; one panel owns focus. Typed chat uses `/api/talk`; model failure leaves chat usable. Animation, dialogue transcript and live portrait are session presentation state.

## Runtime boundaries

| Responsibility | Interface |
| --- | --- |
| Pointer capture, walking, running, jump, crouch, aiming and E/R actions | [Player](player/CONTRACT.md), [input ports](player/schema/input.d.ts) |
| Exact collision, moving door leaves and measured vehicle impacts | [Physics](physics/CONTRACT.md), [band admission](physics/schema/band-admission.d.ts) |
| Ground and prop residency | [Ground](ground/CONTRACT.md), [stream settings](ground/schema/stream.d.ts), [Props](props/CONTRACT.md), [prop ports](props/stream.d.ts) |
| Original shells, doors and per-floor interiors | [City](city/CONTRACT.md), [floor stream](city/schema/interior-stream.d.ts), [shell residency](city/streaming/CONTRACT.md) |
| Authored bridges, ducts, tunnels and wires | [Links](links/CONTRACT.md) |
| Scheduled transit and destination terminals | [Transit](transit/CONTRACT.md) |
| Persistent identities and physical NPC representation | [Simulation adapter](sim/CONTRACT.md), [Agents](agents/CONTRACT.md) |
| Validated story actions and evidence state | [Quests](quests/CONTRACT.md), [Investigations](investigation/CONTRACT.md) |
| Semantic animation, objective paths and water surfaces | [Animation](animation/CONTRACT.md), [Routes](routes/CONTRACT.md), [Hydrology](hydro/CONTRACT.md) |
| Fixture lighting, pipeline preparation and diagnostics | [Light](light/CONTRACT.md), [Look](look/CONTRACT.md), [Debug](debug/CONTRACT.md) |

## Preparation and residency

Ground and props use local rendering windows with collision within 256 m. Source dimensions, transforms, material keys and placement plans remain unchanged. Original shells stream for large catalogs; selected interiors remain available to Simulation. Each floor fetches and cuts its authored GLB in a worker, prepares fixed lighting bindings while hidden, and waits for complete collision before visibility.

Ground, props and streamed shell material pipelines prepare through the same serial warm-up queue. Static shell, link and transit collision cooks in pieces of at most 2,048 triangles across tasks; lamp posts also yield during installation. The simulation clock advances at 1:1 while lighting uses a fixed 21:00 state. WebGPU is the default backend; WebGL2 defaults to low quality.

Crowd and car capacities default to zero, each capped at 600 by the query parser. Actual counts depend on Simulation and available routes. Names never replace stable IDs. Movement follows published `path3` heights. Quest actions retain exact item, NPC, step and place identity; rejected actions do not advance progress. Saved NPC continuity and Simulation replay use the same world minute.

## Errors

- `E_WORLD_SHELL_CATALOG`: invalid catalog schema, hash, source identity, bounds or heights.
- `E_WORLD_BUILDINGS`: invalid requested IDs or missing finite player position for selective loading.
- `E_WORLD_CONNECTIONS`: invalid declared Connections data or source/hash mismatch.
- `E_MOVEMENT_PATH3`: missing or invalid authoritative movement path.
- `E_HIGHWAY_STRUCTURE`: invalid source highway geometry.
- `E_DOOR_MOTION`: incomplete or invalid authored door travel.
- Ground, props, shell streaming, hydrology, physics, quests and persistence publish their own error sets in the linked interfaces. Other fetch, decode and renderer failures propagate as messages to the host.

General unresolved material keys render magenta and are counted; bound mission and water material failures can reject admission. Complete-game packaging, uniform resource admission, per-floor roles, observed-actor reconciliation, map presentation and large-world acceptance are proposals in [Issues](../../docs/ISSUES.md).

## Dependencies

[Atlas](../../../atlas/CONTRACT.md), [Connections](../../../connections/CONTRACT.md), [Exterior](../../../exterior/CONTRACT.md), [Interior](../../../interior/CONTRACT.md), [Materials](../../../materials/CONTRACT.md), [Simulation](../../../simulation/CONTRACT.md), [Naming](../../../naming/CONTRACT.md), [Quests](../../../quests/CONTRACT.md), [Assembly](../assembly/CONTRACT.md), [Library](../library/CONTRACT.md) and the runtime interfaces above.
