# CONTRACT: look (game inner box)

Purpose: decides how a frame is exposed, coloured and composed, so a city lit in real photometric units reads like the reference photographs.

## In
- The renderer, after `init()`, and its actual backend.
- A quality name (`low` | `medium` | `high` | `ultra`) or nothing, and one exposure number, both from the run's URL query.
- The scene, the camera, the sky mesh.
- `{ color, lux }` for the air around the player, from `light/CityLights.airColor`.

## Out
- `QualityTier.describe(name, backend) -> descriptor`: `bloom{strength,radius}`, `haze`, `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `probeSize`, `probeInterval`, `materialMaps`, `materialVariants`, `textureAnisotropy`, `textureMaxSize` ([material profile schema](../../building/pbr-profile.schema.json)). `defaultFor(backend)` is the tier a backend runs unless the run names one. Every tier retains base colour, normal, roughness, metallic, AO and emission. Low and medium cap maps at 1024 pixels, high at 2048 and ultra at 4096. Low limits a family to two pattern variants and uses anisotropy 2.
- `Exposure(renderer, base)`: sets AgX tone response and the base exposure; `enter('exterior'|'interior')` and `update(delta)` cross-fade between authored exposures over 0.6 s.
- `NightFog(scene, { density, color })`: installs the fog node, height fog outdoors and a thin uniform medium indoors; `update(air, indoor, delta)` retints it from the light actually filling the air and crosses between the two media.
- `EnvironmentProbe(renderer, scene, tier)`: `bake(position)` and `update(position, crossed)`, the cubemap wet ground and glass reflect. Rebakes on distance, on crossing a threshold, and never twice within two seconds. Convolution reuses its generator and resident environment texture, preserving material pipeline identities.
- `LookPipeline(renderer, scene, camera, tier)`: `render()` draws one frame to the canvas through the chain, preserving concurrent preparation state; `mrt` is the scene pass's multiple render target, or `null` at a tier with no bloom; `renderTarget` is that pass's actual target, with matching sample count and output buffer type.
- `Warmup(renderer, scene, camera, mrt, renderTarget?)`: `warm(object)` waits for its maps to decode and uploads each new map once before compiling its pipelines. Each upload yields a frame. `warmAll(object, {wanted?, onProgress?})` prepares one renderable at a time with a frame yield between them; the optional boolean callback cancels before the next renderable. Progress receives completed and total renderables. Both return elapsed milliseconds. Compilation uses the visible world pass's render target, MRT and linear colour state, restoring them afterward. Hidden and frustum-culled objects, including empty instance batches, are staged only during compilation and restored exactly; inactive lights stay inactive.
- Concurrent callers share one serialized preparation queue. A failed cell restores renderer state and rejects its caller; queued cells may still prepare.

## The chain
The world renders directly into an HDR target at the same call depth used for pipeline preparation. With bloom it writes two MRT attachments (`output`, `emissive`); otherwise it writes one. Texture composition applies emissive bloom, then the output colour transform (AgX at the run's exposure), then ordered dither. Everything before the transform is linear HDR, so the tone response is applied once, last.

## Invariants
- Bloom is selected by the emissive channel, never by a luminance threshold: a tube glows, the wall it lights does not.
- There is no auto-exposure. Exposure is authored per volume so walking out of a lit room into the street is a drop the player feels.
- Fog colour is read back from the fixtures around the player, never authored: the air is the colour of the light in it.
- Every effect reads the quality descriptor, never the backend. The backend picks a default tier once, after `init()`, and nothing downstream asks again.
- `low` keeps physical units, computed room fill and fog. It disables bloom and the environment probe, limits material variety and texture dimensions to bound memory. Medium through ultra keep the probe.
- Startup prepares every exterior renderable serially with visible progress before play begins. Each streamed floor prepares while detached, once for the dim binding and once per fixed room-light slot, before visibility. Fixed light identities and the exact scene-pass target keep later camera translation on the prepared pipeline keys.

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
