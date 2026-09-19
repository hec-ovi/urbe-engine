# Game contract

Plays assembled city artifacts in a continuous first-person scene with physics, simulation, quests and saved progress.

## Input

- `new GameApp(config).start()` starts the browser session; `GameApp.configFromUrl()` reads the [query and parsed settings](data/schema/game-config.d.ts). The application entry is `?mode=game`.
- `game` loads the [saved descriptor](persistence/schema/game-state.schema.json) from `/out/games/<id>` and owns that directory. Without it, `out` is a session-only preview. The default preview is `/out/city-tiny` with Atlas sample `city-urbe-tiny`.
- [World manifest](../assembly/schema/world-manifest.schema.json): exact shell IDs, selected interiors, floor tags, source versions and optional archive, Connections, shell catalog, rooftop, plan index and per-parcel source references. The carried blueprint is preferred. `kit` names the plan index `kit.json`, its sha256 and, with `shared`, where it stands in the store under `/out/shared`; the index names each plan's shell and blueprint relative to that store. `sources` maps a parcel id to `kit`, `shell` or `empty`, a parcel marked `kit` requires that index, and an empty lot is named here and in no other list, so nothing is ever fetched for it. `buildings` names each kit parcel's block template, lot slot and the plan it is a copy of, whose blueprint is what that building's own is composed from. `streets` names `streets/manifest.json` with kit and blueprint hashes, and `sharedKit` where the street kit stands under `/out/shared`. `interiorModules` names `modules.json` the same way, and a world with interiors must publish it; the optional `interiorProps` names the furniture catalog beside it. A manifest without them is a world of generated shells. A declared Connections artifact requires matching seeds and byte hashes; manifests without it retain in-process Connections generation and sample fallback.
- [World Archive](../world-archive/CONTRACT.md) validates bounded part hashes and counts. With prepared Connections, runtime reads omit optional Atlas construction planning proofs.
- [Building sources](data/schema/world-buildings.d.ts): Exterior blueprint for every listed parcel, with a GLB for a shell parcel and a placement table for a kit one; NPC data, the Interior building manifest and its three placement layouts only for manifest interiors. Source reads share eight concurrent requests. A world with a shell catalog loads all interiors plus sources within 250 m of the player (or the first interior); a world without a catalog loads every listed source.
- [Materials](../../../materials/CONTRACT.md) catalogs under `/materials`, character and vehicle assets under `/models`, and optional Naming NPC types beside the world. Missing NPC types use Simulation's built-in set.
- [Quest Bundle](../quest-bundle/CONTRACT.md) validates the Quests handoff. A catalog descriptor with `questBundle: null` loads no quest or investigation files. Direct previews also accept standalone questlines.

## Output

- A browser play session. `tick(delta)` advances elapsed seconds through clock, physical actors, interaction and rendering. Startup errors remain on the loading view; `start()` catches them.
- `WorldSource.load()` returns the [building-source ports](data/schema/world-buildings.d.ts), Atlas and Connections data, optional quest catalogs, NPC types, the requested game descriptor and `kit` (the validated `kit.json`, the base URL its piece files are relative to, and `plansUrl`, where this city's building plans stand, or null). `interiorModules` and `interiorProps` are the shared interior catalogs with the base URL their files are relative to, or null. `nativeStreets` is the [verified saved street source](ground/native/CONTRACT.md), or null when the manifest has no `streets`. A declared street source requires its exact carried blueprint and bundle hashes; missing data fails loading. `loadBuildings(ids)` reads unique manifest IDs without owning residency. `unbuilt` lists Atlas parcels absent from the manifest.

Game composes native ordinary streets with retained ground, highways and stations through `GroundScene`. Native streets draw one batch per native surface and collide as cuboids per cell. Native features reserve prop clearance independently of residency. Exact replacement owners suppress hardware the native bundle already covers; ordinary native paint is emitted once while highway paint remains in its existing builder. Retained Atlas ground, highways and stations keep triangle collision.
- [GamePersistence](persistence/CONTRACT.md) serializes [live state](persistence/schema/live-state.schema.json) to a [save payload](persistence/schema/save-current-payload.schema.json) and verifies the [acknowledged result](persistence/schema/save-result.schema.json). Leaving a catalog game waits for that save. Position is the player's feet; heading is camera yaw in radians.
- [UI](../ui/CONTRACT.md) receives world values and action callbacks. Escape releases capture; one panel owns focus. Typed chat uses `/api/talk`; model failure leaves chat usable. Animation, dialogue transcript and live portrait are session presentation state.

## Runtime boundaries

| Responsibility | Interface |
| --- | --- |
| Pointer capture, walking, running, jump, crouch, aiming and E/R actions | [Player](player/CONTRACT.md), [input ports](player/schema/input.d.ts) |
| Exact collision, moving door leaves and measured vehicle impacts | [Physics](physics/CONTRACT.md), [band admission](physics/schema/band-admission.d.ts) |
| Ground and prop residency | [Ground](ground/CONTRACT.md), [stream settings](ground/schema/stream.d.ts), [Props](props/CONTRACT.md), [prop ports](props/stream.d.ts) |
| Original shells, doors and furnished interior floors | [City](city/CONTRACT.md), [floor stream](city/schema/interior-stream.d.ts), [shell residency](city/streaming/CONTRACT.md) |
| Buildings assembled from shared facade pieces | [Kit runtime](city/kit/CONTRACT.md) |
| Authored bridges, ducts, tunnels and wires | [Links](links/CONTRACT.md) |
| Scheduled transit and destination terminals | [Transit](transit/CONTRACT.md) |
| Persistent identities and physical NPC representation | [Simulation adapter](sim/CONTRACT.md), [Agents](agents/CONTRACT.md) |
| Validated story actions and evidence state | [Quests](quests/CONTRACT.md), [Investigations](investigation/CONTRACT.md) |
| Semantic animation, objective paths and water surfaces | [Animation](animation/CONTRACT.md), [Routes](routes/CONTRACT.md), [Hydrology](hydro/CONTRACT.md) |
| Fixture lighting, pipeline preparation and diagnostics | [Light](light/CONTRACT.md), [Look](look/CONTRACT.md), [Debug](debug/CONTRACT.md) |

## Preparation and residency

Ground and props render out to the camera far plane (900 m) and collide within 256 m. Source dimensions, transforms, material keys and placement plans remain unchanged. Original shells stream for large catalogs; selected interiors remain available to Simulation. A furnished floor is its layout's module and furniture placements at that floor's elevation, drawn from catalogs loaded once for the city, and waits for complete collision before it enters those draws.

Loading reads the world documents, the street pieces, the room catalogs and the characters at the same time. The building plans are not among them: a plan is read the first time a cell that stands on it is admitted, so the load costs what stands around the spawn and not what the city publishes. Ground, props and streamed shells then prepare through the same serial warm-up queue, which builds one program per material and vertex layout and prepares a model and finish once whatever cells stand it; a cell that brings a plan the city has not read also brings whatever program that plan's batches still need. The loading view counts those units over the whole load. The environment probe bake and the crowd's vertex animation bake run on the frame loop, after the first frame. Static shell, link and transit collision cooks in pieces of at most 2,048 triangles across tasks; lamp posts also yield during installation. The simulation clock advances at 1:1 while lighting uses a fixed 21:00 state. WebGPU is the default backend; WebGL2 defaults to low quality.

Crowd and car capacities default to zero, each capped at 600 by the query parser. Actual counts depend on Simulation and available routes. Names never replace stable IDs. Movement follows published `path3` heights. Quest actions retain exact item, NPC, step and place identity; rejected actions do not advance progress. Saved NPC continuity and Simulation replay use the same world minute.

## Errors

- `E_WORLD_SHELL_CATALOG`: invalid catalog schema, hash, source identity, bounds or heights.
- `E_KIT_PIECES` and `E_KIT_PLACEMENT`: an unreadable plan shell, whose parcels stay empty lots while the city keeps playing, or a placement record naming a plan the world lacks, published by the [Kit runtime](city/kit/CONTRACT.md).
- `E_INTERIOR_MODULE`, `E_INTERIOR_PROP` and `E_INTERIOR_LAYOUT`: an unreadable shared module or furniture model, or a building naming a layout it does not carry, published by [City](city/CONTRACT.md).
- `E_WORLD_BUILDINGS`: invalid requested IDs or missing finite player position for selective loading.
- `E_WORLD_CONNECTIONS`: invalid declared Connections data or source/hash mismatch.
- `E_MOVEMENT_PATH3`: missing or invalid authoritative movement path.
- `E_HIGHWAY_STRUCTURE`: invalid source highway geometry.
- `E_DOOR_MOTION`: incomplete or invalid authored door travel.
- Ground, props, shell streaming, hydrology, physics, quests and persistence publish their own error sets in the linked interfaces. Other fetch, decode and renderer failures propagate as messages to the host.

General unresolved material keys render magenta and are counted; bound mission and water material failures can reject admission. Complete-game packaging, uniform resource admission, per-floor roles, observed-actor reconciliation, map presentation and large-world acceptance are proposals in [Issues](../../docs/ISSUES.md).

## Dependencies

[Atlas](../../../atlas/CONTRACT.md), [Connections](../../../connections/CONTRACT.md), [Exterior](../../../exterior/CONTRACT.md), [Interior](../../../interior/CONTRACT.md), [Materials](../../../materials/CONTRACT.md), [Simulation](../../../simulation/CONTRACT.md), [Naming](../../../naming/CONTRACT.md), [Quests](../../../quests/CONTRACT.md), [Assembly](../assembly/CONTRACT.md), [Library](../library/CONTRACT.md) and the runtime interfaces above.

Native tree-grate receivers share Atlas median tree anchors with Props. Their bodies remain in native collision; dressing admission permits their matching tree to occupy the receiver.
