# CONTRACT: look (game inner box)

Purpose: decides how a frame is exposed, coloured and composed, so a city lit in real photometric units reads like the reference photographs.

## In
- The renderer, after `init()`, and its actual backend.
- A quality name (`low` | `medium` | `high` | `ultra`) or nothing, and one exposure number, both from the run's URL query.
- The scene, the camera, the sky mesh.
- `{ color, lux }` for the air around the player, from `light/CityLights.airColor`.

## Out
- `QualityTier.describe(name, backend) -> descriptor`: `bloom{strength,radius}`, `haze`, `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `probeSize`, `probeInterval`, `materialMaps`, `materialVariants`, `textureAnisotropy`. `defaultFor(backend)` is the tier a backend runs unless the run names one. Low loads base colour, normal and emission, limits a family to two pattern variants and uses anisotropy 2; medium adds roughness; high and ultra add metallic and AO and spend more on variety.
- `Exposure(renderer, base)`: sets AgX tone response and the base exposure; `enter('exterior'|'interior')` and `update(delta)` cross-fade between authored exposures over 0.6 s.
- `NightFog(scene, { density, color })`: installs the fog node, height fog outdoors and a thin uniform medium indoors; `update(air, indoor, delta)` retints it from the light actually filling the air and crosses between the two media.
- `EnvironmentProbe(renderer, scene, tier)`: `bake(position)` and `update(position, crossed)`, the cubemap wet ground and glass reflect. Rebakes on distance, on crossing a threshold, and never twice within two seconds.
- `LookPipeline(renderer, scene, camera, tier)`: `render()` draws one frame through the chain; `mrt` is the scene pass's multiple render target, or `null` at a tier with no bloom.
- `Warmup(renderer, scene, camera, mrt)`: `warm(object)` builds the object's pipelines, waits for its maps to decode, and uploads each new map once with a frame yield between uploads. `warmAll(object)` runs that preparation one renderable at a time and yields after every eight. Hidden and frustum-culled objects, including empty instance batches, are staged and left exactly as they were; inactive light objects stay inactive so the fixed budget is never exceeded.

## The chain
Scene pass with a two-attachment MRT (`output`, `emissive`) -> bloom fed by the emissive attachment -> output colour transform (AgX at the run's exposure) -> ordered dither. Everything before the transform is linear HDR, so the tone response is applied once, last.

## Invariants
- Bloom is selected by the emissive channel, never by a luminance threshold: a tube glows, the wall it lights does not.
- There is no auto-exposure. Exposure is authored per volume so walking out of a lit room into the street is a drop the player feels.
- Fog colour is read back from the fixtures around the player, never authored: the air is the colour of the light in it.
- Every effect reads the quality descriptor, never the backend. The backend picks a default tier once, after `init()`, and nothing downstream asks again.
- `low` keeps physical units, computed room fill and fog. It disables bloom and the environment probe, limits material variety and uses scalar roughness and metalness to stay inside WebGL texture memory. Medium through ultra keep the probe.
- The game does not warm the complete city: its program set can occupy either backend for minutes. It does warm each bounded streamed floor while detached, once for the dim binding and once per fixed room-light slot, before that floor can become visible. Fixed light identities keep later camera translation on those pipeline keys.

## Acceptance bands (docs/RESEARCH-LIGHTING.md 9)
| statistic | interior | exterior |
|---|---|---|
| median linear luminance | 0.005-0.021 | 0.011-0.022 |
| frame below 0.01 linear | 20-68% | 16-48% |
| frame above 0.5 linear | under 1.5% | under 1% |
| darkest 20% mean sRGB | 4-30, never 0 on all three channels | 8-27, never 0 on all three |
| saturation at Y>0.5 | 0.27-0.71 | 0.05-0.73 |

## Errors
None thrown. An unknown quality name falls back to the backend's default.

## Depends on
- ../light/CONTRACT.md for the air colour the fog reads
