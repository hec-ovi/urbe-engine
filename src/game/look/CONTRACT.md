# CONTRACT: look (game inner box)

Purpose: decides how a frame is exposed, coloured and composed, so a city lit in real photometric units reads like the reference photographs.

## In
- The renderer, after `init()`, and its actual backend.
- A quality name (`low` | `medium` | `high` | `ultra`) or nothing, and one exposure number, both from the run's URL query.
- The scene, the camera, the sky mesh.
- `{ color, lux }` for the air around the player, from `light/CityLights.airColor`.

## Out
- `LOOK` ([LookSettings.js](LookSettings.js)): what this world is drawn at, wherever it is drawn. Lighting hour 21, exposure 0.024, street fog 0.0003 per metre, 72 degree field of view, near 0.2 m, far 900 m. A run's URL query defaults to these.
- `NightLook.begin(renderer, {quality, backend, exposure, bloom, haze}) -> look` installs the tier, the lighting system and the tone response. `look.raise(scene, {hour, fog, probe, hitches})` adds the sky and its key light, the air, and the environment probe: built, not baked, because where a bake is taken from and which groups it leaves out belong to the caller. `look.compose(camera)` builds the frame chain. `look.render()` draws one frame. `NightLook.install(renderer, scene, camera, options)` runs all three for a path whose scene is whole before its first frame. The parts it made are `tier`, `lighting`, `exposure`, `sky`, `fog`, `probe` and `pipeline`.
- `QualityTier.describe(name, backend) -> descriptor`: `bloom{strength,radius}`, `haze`, `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `probeSize`, `probeInterval`, `materialMaps`, `textureAnisotropy`, `textureMaxSize` ([material profile schema](../../building/pbr-profile.schema.json)). `defaultFor(backend)` is the tier a backend runs unless the run names one. Every tier retains base colour, normal, roughness, metallic, AO and emission. Low and medium cap maps at 1024 pixels, high at 2048 and ultra at 4096. Low uses anisotropy 2.
- `Exposure(renderer, base)`: sets AgX tone response and the base exposure; `enter('exterior'|'interior')` and `update(delta)` cross-fade between authored exposures over 0.6 s.
- `NightFog(scene, { density, color })`: installs the fog node, height fog outdoors and a thin uniform medium indoors, 15 percent of the medium at 10 m so a room reads to its far wall; `update(air, indoor, delta)` retints it from the light actually filling the air and crosses between the two media. Indoors the medium carries the room's own radiance, 0.25 cd/m2 per lux of its fixtures' mean illuminance, arriving as the medium does; on the street it is the sky's.
- `EnvironmentProbe(renderer, scene, tier)`: the cubemap wet ground and glass reflect. The resident environment stands from construction, black until the first bake, so every program compiled from then on is built for the texture it keeps reading. `prepare(warmup, onProgress?)` builds the cube faces' own graphs through a sibling of the frame's warm-up, without the excluded groups; `bakeAsync(position, {slice?, onProgress?})` renders one face per ask of the budget and reports faces; `bake(position)` does the six in one go for a preview; `update(position, crossed)` rebakes on distance, on crossing a threshold, never twice within two seconds, a face per frame. Convolution reuses its generator and resident environment texture, preserving material pipeline identities.
- `LookPipeline(renderer, scene, camera, tier)`: `render()` draws one frame to the canvas through the chain, preserving concurrent preparation state; `mrt` is the scene pass's multiple render target, or `null` at a tier with no bloom; `renderTarget` is that pass's actual target, with matching sample count and output buffer type.
- `Warmup(renderer, scene, camera, mrt, renderTarget?)`: `warm(object)` waits for its maps to decode and uploads each new map once before compiling its pipelines; a map the world disposes is uploaded again the next time a warm-up meets it. Each upload yields a frame, or a short timer where the browser has stopped drawing frames, so preparation never waits on a frame that is not coming. `warmAll(object, {wanted?, onProgress?})` prepares one renderable per graph the renderer would build on a first draw ([ProgramKey.js](ProgramKey.js)): a material with the vertex layout it is drawn with (attribute names, sizes, types and interleaving), and for an instanced or batched draw each object of its own, because the graph binds that object's buffers. One at a time with a frame yield between them; the optional boolean callback cancels before the next one. Progress receives completed and total graphs. A graph this warm-up already built, in any pass, is never built again, so the city pass prepares only what the ground and the props left. Each program is pinned behind a keeper ([ProgramKeepers.js](ProgramKeepers.js)), a small renderable wearing a copy of the material and one triangle of its own in the same vertex layout, compiled to the same code, so a batch that grows, a floor that leaves or a geometry the world disposes never drops the last use of a program and the next draw that wants it never links it again; a keeper that cannot be made is a warning. `warmAll` also takes `skip(node)`, subtrees left out. `sibling({camera?, renderTarget?, mrt?})` prepares the same world for another render target, sharing uploads and keepers, because the renderer keeps a graph per target. Both return elapsed milliseconds. Compilation uses the visible world pass's render target, MRT and linear colour state, restoring them afterward. Hidden and frustum-culled objects, including instance and material batches standing empty, are staged only during compilation and restored exactly; inactive lights stay inactive.
- Concurrent callers share one serialized preparation queue. A failed cell restores renderer state and rejects its caller; queued cells may still prepare.
- Materials may expose [texture resources](../ground/materials/schema/ports.d.ts) through `Symbol.for('urbe.material-resources')`. Warmup awaits their decoding/budgeting promises together with ordinary maps, uploads shared textures once, and rejects required preparation on a failed resource before compilation.

## The chain
The world renders directly into an HDR target at the same call depth used for pipeline preparation. With bloom it writes two MRT attachments (`output`, `emissive`); otherwise it writes one. Texture composition applies emissive bloom, then the output colour transform (AgX at the run's exposure), then ordered dither. Everything before the transform is linear HDR, so the tone response is applied once, last.

## Invariants
- Exposure and the light rig are one decision: AgX at 0.024 reads as a night only over fixtures authored in lumens and lux, and a metal reads as metal only with a probe behind it. A path that wants this look installs `NightLook`; it never copies the numbers.
- Bloom is selected by the emissive channel, never by a luminance threshold: a tube glows, the wall it lights does not.
- There is no auto-exposure. Exposure is authored per volume so walking out of a lit room into the street is a drop the player feels.
- Fog colour is read back from the fixtures around the player, never authored: the air is the colour of the light in it.
- Every effect reads the quality descriptor, never the backend. The backend picks a default tier once, after `init()`, and nothing downstream asks again.
- `low` keeps physical units, computed room fill, fog and a small environment probe (32 px) so glossy ground and metals reflect the scene on every backend. It disables bloom and limits material variety and texture dimensions to bound memory.
- Startup prepares every exterior program serially with visible progress before play begins, the room module batches among them, once against the room light pool. Each streamed floor prepares its own renderables while detached, before visibility. Fixed light identities and the exact scene-pass target keep later camera translation on the prepared pipeline keys.

## Acceptance bands
| statistic | interior | exterior |
|---|---|---|
| median linear luminance | 0.005-0.021 | 0.011-0.022 |
| frame below 0.01 linear | 20-68% | 16-48% |
| frame above 0.5 linear | under 1.5% | under 1% |
| darkest 20% mean sRGB | 4-30, never 0 on all three channels | 8-27, never 0 on all three |
| saturation at Y>0.5 | 0.27-0.71 | 0.05-0.73 |

## Errors
`warmAll` rejects failed map or pipeline preparation after restoring render state; its caller controls floor admission. Optional `warm` preparation reports failures as warnings. An unknown quality name falls back to the backend's default.

## Depends on
- ../light/CONTRACT.md for the air colour the fog reads
