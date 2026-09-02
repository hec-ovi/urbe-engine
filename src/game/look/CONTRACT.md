# CONTRACT: look (game inner box)

Purpose: decides how a frame is exposed, coloured and composed, so a city lit in real photometric units reads like the reference photographs.

## In
- The renderer, after `init()`, and its actual backend.
- A quality name (`low` | `medium` | `high` | `ultra`) or nothing, and one exposure number, both from the run's URL query.
- The scene, the camera, the sky mesh.
- `{ color, lux }` for the air around the player, from `light/CityLights.airColor`.

## Out
- `QualityTier.describe(name, backend) -> descriptor`: `bloom{strength,radius}`, `haze`, `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `probeSize`, `probeInterval`. `defaultFor(backend)` is the tier a backend runs unless the run names one.
- `Exposure(renderer, base)`: sets AgX tone response and the base exposure; `enter('exterior'|'interior')` and `update(delta)` cross-fade between authored exposures over 0.6 s.
- `NightFog(scene, { density, color })`: installs the fog node, height fog outdoors and a thin uniform medium indoors; `update(air, indoor, delta)` retints it from the light actually filling the air and crosses between the two media.
- `EnvironmentProbe(renderer, scene, tier)`: `bake(position)` and `update(position, crossed)`, the cubemap wet ground and glass reflect. Rebakes on distance, on crossing a threshold, and never twice within two seconds.
- `LookPipeline(renderer, scene, camera, tier)`: `render()` draws one frame through the chain; `mrt` is the scene pass's multiple render target, or `null` at a tier with no bloom.
- `Warmup(renderer, scene, camera, mrt)`: `warm(object)` builds every pipeline and uploads every map the object needs, off the frame that would first draw it, and returns the milliseconds it took. Hidden and frustum-culled objects are compiled and left exactly as they were.

## The chain
Scene pass with a two-attachment MRT (`output`, `emissive`) -> bloom fed by the emissive attachment -> output colour transform (AgX at the run's exposure) -> ordered dither. Everything before the transform is linear HDR, so the tone response is applied once, last.

## Invariants
- Bloom is selected by the emissive channel, never by a luminance threshold: a tube glows, the wall it lights does not.
- There is no auto-exposure. Exposure is authored per volume so walking out of a lit room into the street is a drop the player feels.
- Fog colour is read back from the fixtures around the player, never authored: the air is the colour of the light in it.
- Every effect reads the quality descriptor, never the backend. The backend picks a default tier once, after `init()`, and nothing downstream asks again.
- `low` is not a broken `high`: physical units, computed room fill, fog floor and selective bloom are on at every tier.
- Nothing links a shader or uploads a map on a frame the player sees. The WebGL2 backend links in the background only inside `compileAsync`, so the loading screen warms the built city and every streamed floor is warmed while it is still detached.

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
