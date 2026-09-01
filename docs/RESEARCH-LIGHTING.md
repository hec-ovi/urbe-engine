# Lighting and realism research (2026, three r185)

The question, in the user's words: "how to make all look real?"

Companion to `docs/RESEARCH.md`, which settled the stack (three 0.185.1, `WebGPURenderer` from `three/webgpu`, TSL, WebGL2 backend as automatic fallback, city scale, 60fps). This chapter settles the render pipeline that sits on top of it. Every API below was read out of the r185 source tree or an r185 example on 2026-09-01; file paths and example names are given so each claim can be re-checked.

One correction to carry forward from `RESEARCH.md`: `PostProcessing` was renamed `RenderPipeline` in r183 and the old name now logs a deprecation warning (`src/renderers/common/PostProcessing.js` is a two-line subclass). `renderPipeline.renderAsync()` is deprecated since r181; use `render()` after `await renderer.init()`. And r185 does have height fog built in (`exponentialHeightFogFactor`), so that no longer has to be written by hand.

---

## 0. What the references actually do

The reference images were measured, not eyeballed: sRGB decoded to linear, the Cyberpunk HUD cropped off.

| | median linear luminance | frame below 0.01 linear | frame above 0.5 linear | darkest 20%, mean sRGB | brightest 2%, mean sRGB |
|---|---|---|---|---|---|
| room (Cyberpunk 2077 garage) | 0.0045 | 68.5% | 0.1% | 4, 4, 0 | 188, 135, 65 |
| bar (`expectedinteriors.webp`) | 0.0204 | 20.2% | 1.2% | 30, 17, 22 | 223, 191, 159 |
| street (`expectedoutside.webp`) | 0.0217 | 15.7% | 0.2% | 15, 24, 27 | 97, 167, 182 |
| Blade Runner wallpaper | 0.0107 | 48.4% | 0.6% | 8, 10, 12 | 172, 182, 185 |

Three numbers fall out of that table and they are the whole brief:

**The median pixel sits at 0.5% to 2% of white.** Not 20%. A frame that looks "correctly exposed" by any automatic measure is already three stops too bright for this look. The images read as rich rather than murky because of what is *inside* the darks, not because the darks are lifted.

**Under 1.2% of the frame is above half white.** Highlights are rare and small. A pipeline that puts a broad bright wash anywhere has already lost.

**Nothing is pure black, and the black is never grey.** No reference has a meaningful count of exact (0,0,0). The floor of each image is a *coloured* floor, and its colour says where it came from: the airless garage bottoms out at (4, 4, 0), warm with the blue channel literally at zero, because the only thing filling its shadows is bounce off warm-lit surfaces. The hazy bar bottoms out at (30, 17, 22) and the fogged street at (15, 24, 27), both far higher, because in those shots the shadow floor is *air*, lit by the room's own lights. That is the single cheapest realism lever in the whole document: the lift that stops a night scene from crushing should come from fog and from an environment probe, which are distance- and view-dependent, never from an `AmbientLight`, which is flat and reads instantly as a wash.

Highlight behaviour, measured on the same images:

| | saturation at Y>0.5 | saturation at Y>0.8 | mean sRGB at Y>0.8 |
|---|---|---|---|
| room | 0.71 | 0.71 | 252, 247, 84 |
| bar | 0.27 | 0.23 | 250, 239, 207 |
| street | 0.73 | 0.05 | 245, 249, 237 |
| Blade Runner | 0.05 | 0.03 | 236, 241, 244 |

The street is the instructive one: cyan neon stays strongly saturated all the way up the shoulder (0.73) and only goes white in the last sliver of its core (0.05). That is the shape a good tone curve produces and a naive clamp does not. The room stays yellow even at the peak for a different reason: tungsten has no blue to give, so the blue channel never rises regardless of the curve.

Glow footprint, measured radially from the brightest pixel of a fixture:

- Bar wall panel, in a hazy room: 100% at the source, 20% at 60px, 7% at 100px, 2% at 150px, in an 800px-wide frame. **Wide and weak.**
- Street lamp, in thin air: above 90% for 18px, then a cliff to 8%, a tail at 5-9% out to 50px, 2% at 60px, in a 1200px-wide frame. **Tight and small.**

Two different mechanisms wearing one name. The wide interior wash is the participating medium (light scattering in haze between the fixture and the camera). The tight exterior halo is lens bloom. Turning bloom up until an interior looks like the bar reference produces a smeared, milky frame, because bloom is the wrong tool for that job. Bloom stays small; the haze does the wide work.

### The room (`Screenshot From 2026-08-27 16-18-56.png`), the purest example

Nearly empty: a metal floor, two walls, an accordion gate, two bin bags. It reads hyper-real anyway, and every phenomenon doing the work is affordable.

- **One warm source, no fill.** A single fixture off-frame throws an elliptical pool onto the diamond-plate floor. Falloff is smooth and inverse-square-shaped with no hard cone edge, so the source is physically an area, not a point: an area light or a spot with a wide penumbra.
- **Bounce, not ambient.** The lower wall carries a soft vertical gradient, bright at the skirting and darkening upward. That gradient is light returning off the lit floor. Its colour is the floor's albedo times the fixture's colour, which is why the wall's shadow reads warm brown-green and not grey. This one effect is the difference between "3D scene at night" and "photograph at night", and it is what a per-room irradiance probe buys.
- **Contact.** Every object meets the floor in a dark seam a few centimetres wide, and just outside that seam the floor is *brighter* than average from the bag bouncing light back. Contact darkening plus bounce brightening, immediately adjacent. GTAO gives the first; a probe or SSGI gives the second.
- **Albedo carries the darks, normals carry the lights.** The graffiti is legible on a wall that is almost black, because albedo detail survives at any exposure. The diamond-plate relief is only legible inside the light pool, because normal-map detail needs light to exist. Detail budget should follow that split: albedo and grime everywhere, relief where the fixtures are.
- **The bin bags are the thesis of the whole chapter.** Their albedo is near black. They are visible entirely through specular: every fold is a curved surface, so the specular lobe sweeps into long streak highlights. The highlights are *warm*, the colour of the fixture, and they are not clipped. A cheap prop with almost no albedo information reads real because of specular micro-response alone. This is exactly the alley trash-bag item already on the feedback list, and it is a one-material job: black base colour, roughness around 0.2, no metalness, a wrinkle normal map.
- **Grazing light on the gate.** The accordion gate is lit almost edge-on. Only the rolled edges of the slats catch anything; the flats stay dark. The geometry reads through thin specular lines, not through diffuse shading. That only happens when roughness is low enough for a tight lobe and normals are accurate at the edges.
- **Roughness varies across a single surface.** Grime patches on the floor are matte and locally kill the specular; worn metal between them is glossy. That variation is the materials box's `finish` band doing its job, and it is why a uniform roughness constant always reads like plastic.
- **The tiny green LED strip** has a halo a few pixels wide. Even a pure emissive at full intensity gets a small bloom here.

### The bar (`expectedinteriors.webp`), the user's stated target

- **Haze is the subject.** Every tube sits in a visible cone of scattered light. Contrast falls with depth inside a single room, so the far wall is washed toward the fog colour and the near counter is not. Interior aerial perspective.
- **Two-colour lighting.** Magenta from the left tubes, amber from the back panels. Flat surfaces between them shade through a hue gradient. No single ambient colour can produce that; only real lights of different colours can, which is the argument for making every published fixture a real light.
- **Line sources.** Every fixture is a strip, and the highlight it leaves on a nearby surface is a *stretched* line, not a round hotspot. This is what `RectAreaLight` is for, and it matches interior's `strip` and `cove` kinds exactly.
- **Silhouette and rim.** The two figures are near-black shapes with a rim on the lit side. No fill light on their fronts at all.
- **Glass reads through edges.** The bottles and glasses on the counter are dark bodies whose silhouette edges catch amber. Same principle as the bin bags.

### The street (`expectedoutside.webp`)

- **Wet ground is the whole shot.** Neon strips reflect down the road as long vertical smears. Not mirror-sharp, not diffuse: a rough-specular streak, which is a GGX lobe at roughness roughly 0.15 to 0.35 stretched by the grazing view angle. Near the manhole the reflection tightens where the surface is smoother. A puddle *mask* driving roughness and normal flatness, not a uniform wet road.
- **The far end is brighter than the near.** Measured along the road: 0.026 at the vanishing point, 0.016 near the camera. Fog lifts distance. Exactly inverted from the intuition that far things get darker.
- **Fog is cyan** because the light filling it is cyan. Fog colour is a consequence of the lighting, not a separate art choice.
- **The figure is a pure silhouette.** Zero fill.
- **Street-lamp halos are small.** 60px in a 1200px frame, as measured above.

### The Blade Runner wallpaper

- **Aerial perspective carries all the depth.** Same screen height, near tower at 0.019 mean luminance against the far city at 0.079: a 4x lift purely from distance. Buildings separate into planes because the air between them is visible.
- **One strong backlight** through the haze produces genuine shafts and silhouettes the near tower's edges. The shafts are a volumetric effect, not a bloom.
- **Thousands of sub-pixel emissives.** Window lights are smaller than a pixel and read as sparkle. Their aliasing is the hardest case in the frame and the reason temporal AA is not optional.
- **Colour-temperature contrast does the composition.** A warm-lit tower against cold blue haze. The frame is legible with almost no light in it because warm and cold separate.

### What the references say about "readable but moody, not that obscure"

They are objectively dark by every measure above, and still readable. Legibility comes from local contrast and hue separation inside the darks: the coloured fog floor, the bounce gradient on a wall, a specular edge on a silhouette, warm against cold. Not from raising the floor. Raising exposure to fix legibility destroys the thing that makes the reference legible in the first place.

---

## 1. Exposure and tone response

### The three operators, as actually implemented in r185

`src/constants.js` L422-482 exports `NoToneMapping`, `LinearToneMapping`, `ReinhardToneMapping`, `CineonToneMapping`, `ACESFilmicToneMapping`, `CustomToneMapping`, `AgXToneMapping`, `NeutralToneMapping`. The TSL implementations are in `src/nodes/display/ToneMappingFunctions.js`.

**AgX** (`agxToneMapping`, L166-196). Converts to Rec.2020, applies an inset matrix that mixes channels toward neutral, takes `log2`, normalises against a fixed window from **-12.474 EV to +4.026 EV** (16.5 stops), clamps to [0,1] *in log space*, runs a 6th-order polynomial sigmoid, then an outset matrix whose negative off-diagonals (1.127, -0.141, -0.141) restore part of the saturation the inset removed.

- The inset-sigmoid-outset sandwich is what produces the measured street behaviour: a saturated colour desaturates gradually as it climbs the shoulder and only reaches white at the very top. Magenta stays magenta, cyan stays cyan, well past the point where a per-channel curve would have clipped one channel and skewed the hue.
- The fixed EV window makes exposure a pure translation along a known axis. One stop of exposure is one stop along a curve whose shape never changes. That is worth a lot when tuning against a reference.
- Its known cost: the bottom of the log window is 2^-12.474 ≈ 0.00017 linear, and the sigmoid is flat there, so near-blacks come back slightly lifted and milky. Given that 68% of the room reference sits below 0.01 linear, this matters. It is fixed downstream with a grading LUT or a small contrast push, not by lowering exposure.

**ACES Filmic** (`acesFilmicToneMapping`, L107-141). The Stephen Hill `RRTAndODTFit` approximation: divide by 0.6, into AP1, a per-channel rational fit, back out through a matrix with strong negative off-diagonals (1.605, -0.531, -0.074), clamp.

- Per-channel fitting on saturated colours is the documented source of the ACES hue skew: saturated blue drifts purple, saturated red drifts orange. In a frame whose entire palette is saturated magenta, cyan and sodium orange, that is the wrong failure mode.
- The `/0.6` pre-scale means `toneMappingExposure = 1` is already about 0.74 stops hotter than nominal. The engine currently runs `ACESFilmicToneMapping` with `toneMappingExposure = 1.5` (`src/game/GameApp.js` L86-87), so it is sitting near 2.5x nominal. That alone accounts for a good deal of the gap to the references.

**Neutral / Khronos PBR Neutral** (`neutralToneMapping`, L208-236, referencing `modelviewer.dev/examples/tone-mapping`). A per-channel toe below 0.08, then, above a peak of `StartCompression = 0.76`, compression of the peak channel plus a `Desaturation = 0.15` blend toward white. Below 0.76 peak it **returns the colour unchanged**.

- That is the point of it: Khronos designed it so a product viewer shows the authored albedo exactly. It adds no contrast and no shape to midtones or shadows.
- For this project that is disqualifying on its own. A look whose median pixel is at 1% of white needs the curve to *shape* that region; Neutral leaves it linear and dead. Neutral is the right answer for the materials box's own contact sheets and swatch previews, where the job is to show the map as authored.

**Decision: AgX, with a grading stage after it.** It is the only one of the three that both shapes the darks and keeps saturated neon in hue up the shoulder, which are the two things the measurements demand. Reconsider only if AgX's lifted black cannot be recovered by grading.

### Where tone mapping happens in the pipeline

`RenderPipeline.outputColorTransform` defaults to `true` (`src/renderers/common/RenderPipeline.js` L66), and when true the pipeline wraps the whole chain in `renderOutput(outputNode, toneMapping, outputColorSpace)` at the very end (L208-212), having set `renderer.toneMapping = NoToneMapping` for the scene passes themselves (L129-146). So by default **every effect in the chain runs on linear HDR values and tone mapping is applied once, last**. That is correct for bloom, GTAO, SSR, godrays and volumetrics, and it is why bloom composited as `scenePass.add(bloomPass)` gives a physical result rather than a smear.

Set `outputColorTransform = false` and place `renderOutput(...)` manually only for effects that need sRGB input; FXAA is the canonical case, and `webgpu_postprocessing_bloom_selective` shows the explicit form as `outputPass.add(bloomPass).renderOutput()`.

`renderer.toneMapping` and `renderer.toneMappingExposure` remain the controls; the pipeline reads them and rebuilds when they change (L181-191).

### Physical light units, and the fit to interior's fixture data

There is no legacy mode left to get wrong: `useLegacyLights` was removed in r165 (PR #28482), and `src/Three.Legacy.js` is a zero-byte file in r185, so setting it today creates a dead property and changes nothing. Physical units are the only units.

Verified in source, all three `power` accessors:

- `PointLight.power = intensity * 4π` (`src/lights/PointLight.js` L80-93, comment: "for an isotropic light source, luminous power (lm) = 4 π luminous intensity (cd)"). Intensity is candela.
- `SpotLight.power = intensity * π` (`src/lights/SpotLight.js` L133-146). Intensity is candela. **This constant does not track `angle`.** The true cone integral is 2π(1 − cos θ) steradians, which equals π only at θ = 60°, the default `angle = Math.PI/3`. For a narrow street-lamp cone, `power` is not a meaningful readback and the light should be authored in candela directly.
- `RectAreaLight.power = intensity * width * height * π` (`src/lights/RectAreaLight.js` L76-88). Intensity is **nits (cd/m²)**, not candela, and the setter does the area conversion for us. So a lumen figure still assigns cleanly, as long as the light is sized first.

`decay = 2` is the default on `PointLight` and `SpotLight`, i.e. true inverse-square. The WebGL and TSL decay paths were confirmed identical, and `AnalyticLightNode.update()` folds `color * intensity` with no hidden π factor, so what the contract publishes is what the shader sees.

**The interior box already publishes exactly what this API wants.** Per `../interior/schemas/floor.schema.json`, every floor's `lights` array carries, per entry: `id`, `kind` (`strip` | `spot` | `cove`), `room`, `position`, `length`, `angleDeg`, `intensity` described in the schema as "luminous flux, lumens", `colorTemperatureK`, `range` ("useful radius, meters"), `beamDeg` ("full spread"), `diffuse` and `facing`. The mapping is direct and needs no invented scale factor:

| interior field | three r185 |
|---|---|
| `intensity` (lumens) | assign `light.power = intensity` **after** sizing the light; three does the unit conversion |
| `colorTemperatureK` | `light.color`, from a blackbody-to-sRGB conversion (write it; r185 has no Kelvin helper anywhere in `Color`, `Light` or the addons) |
| `kind: 'spot'`, `beamDeg`, `facing: 'down'` | `SpotLight`, `angle = beamDeg/2` in radians, `penumbra` from `diffuse`. If `beamDeg` is far from 120, set `intensity` in candela rather than using `power` |
| `kind: 'strip'` / `'cove'`, `length`, `angleDeg` | `new RectAreaLight( color, 1, length, housingWidth )`, then `light.power = intensity`; rotate by `angleDeg` about +Y; `facing: 'up'` aims a cove at the ceiling |
| `range` | `light.distance` |
| `room` | the grouping key for the per-room probe bake and the exposure volume |
| (all) | `decay = 2` everywhere; never 1 |

Working values for the exterior and for sanity-checking interior output, in the units three.js wants:

| source | lumens | three.js |
|---|---|---|
| bare 60W-equivalent bulb | 800 lm | `PointLight.power = 800` (≈ 64 cd) |
| 1.2 m fluorescent tube | 2600 lm | `RectAreaLight` sized 1.2 x 0.05 m, then `power = 2600` |
| small neon sign | 100-400 lm | `RectAreaLight`, plus emissive material on the tube itself |
| sodium street lamp (150W) | 15000 lm | `SpotLight.power = 15000`, `angle ≈ 1.0`, `penumbra 0.5` |
| full moon | 0.25 lux at ground | `DirectionalLight.intensity ≈ 0.25` |
| overcast night sky glow | n/a | environment probe, not a light |

The value of doing this properly is not accuracy for its own sake: it is that **relative** brightness becomes correct for free everywhere in the city, so one global exposure works in every room and on every street, and the artist-tuning surface collapses from hundreds of per-light numbers to one exposure and one fog density.

### Picking the exposure number

Once lights are in real units, the exposure that fits is derivable to an order of magnitude, and it is nowhere near where the engine sits today.

An 800 lm bulb is 800/4π = 63.7 cd. At 3 m that is 63.7/9 = 7.1 lux on a surface, and a Lambertian wall of albedo 0.5 returns 0.5 · 7.1 / π = **1.1 cd/m²**. A 15000 lm street lamp 8 m up over asphalt of albedo 0.1 returns about **2.4 cd/m²**. Both agree with the real-world figure for night surfaces, roughly 1-5 cd/m² against 20-100 cd/m² for a lit interior and thousands for daylight.

Since three.js's physical lights feed the BRDF in candela, the shader's output radiance is on that same 1-5 scale, and `toneMappingExposure` is what maps it to display. To land a 2 cd/m² road at the measured display target of 1-2% of white, exposure starts in the region of **0.05 to 0.2**. The engine currently runs 1.5 on ACES, whose `/0.6` pre-scale makes it about 2.5 effective. That is an order of magnitude of overexposure, and it is the largest single number in this document.

The standard camera model (EV100 = log2(N²/t) at ISO 100, relative exposure = 1/(1.2 · 2^EV100)) is still the right tool for the *ratio* between exposure presets: a night street at f/1.4, 1/50s is around EV100 = -3.6 and a dim interior around -5, so the interior preset sits roughly 1.5 stops above the exterior. Fix the ratios from the model, find the absolute number once with the protocol in section 9.

**No auto-exposure.** Nothing in r185 ships adaptive luminance, and it is not wanted: the references get their power from the player walking out of a bright doorway into a dark street and *feeling* the drop. Auto-exposure erases exactly that. Use a small set of authored exposure values (exterior night, interior lit, interior dark, tunnel) attached to the volume the player is in, cross-faded over about 0.6 s. That is the eye-adaptation feeling without the auto-exposure failure mode of a neon sign filling the frame and dimming the world.

### Grading and banding

`examples/jsm/tsl/display/Lut3DNode.js` is present in r185 (example `webgpu_postprocessing_3dlut`); a 3D LUT applied after tone mapping is where the AgX black-lift gets pulled back and where the final noir grade lives, at effectively zero cost. Banding in near-black gradients over large soft falloffs is a real risk at 8-bit output; `bayer16(screenCoordinate)` from `three/addons/tsl/math/Bayer.js` is already used as a dither offset in the volumetric examples, and the same node is the fix for output banding.

---

## 2. Light transport on a budget

### The cost that is not obvious: every light is inlined, and adding one rebuilds the scene

Core has no clustering (`grep -ri cluster src/` returns nothing). `src/nodes/lighting/LightsNode.js` creates one lighting node per scene light and inlines each into the fragment shader, so **N lights means N BRDF evaluations for every fragment of every lit material, reached by the light or not.** No cap, no culling, linear cost and a linearly longer shader.

Worse, the light set is part of the shader cache key. `LightsNode.customCacheKey()` hashes every `light.id` plus its `castShadow` flag; `NodeManager.getCacheKey` folds that into each render object's dynamic key; `RenderObject.needsUpdate` compares it every draw and disposes the object when it differs. And `Lighting.getNode( scene )` returns **one `LightsNode` per Scene**, held in a `WeakMap`. So **adding a single `PointLight` anywhere invalidates every lit material in the scene**, including materials on the other side of the city. A previously seen combination is a cache hit, but a novel one is a full TSL walk plus WGSL emit plus pipeline creation.

That single fact explains why a naive "spawn a light per fixture as tiles stream in" design stutters, and it is why the three tools below matter more than their headline features.

### `renderer.lighting` is swappable, and r185 ships two replacements

**`ClusteredLighting` (Forward+).** `examples/jsm/lighting/ClusteredLighting.js`, two lines to install:

```js
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
renderer.lighting = new ClusteredLighting();   // maxLights 1024, tileSize 32, zSlices 24, maxLightsPerCluster 64
```

The frustum is partitioned into a 3D grid (32px screen tiles by 24 exponential depth slices), a compute pass fills each cluster's light list, and each fragment loops only over its own cluster. `examples/webgpu_lights_clustered.html` runs a 30x30 grid of animated point lights and sets their brightness with `light.power` in lumens. This is what retires the current 14-light rotating pool (`src/game/city/LightBudget.js`).

Its constraints, read out of `examples/jsm/tsl/lighting/ClusteredLightsNode.js` (622 lines):

- **Unshadowed point lights only.** `setLights` L218: `if ( light.isPointLight === true && light.castShadow !== true )` goes clustered, everything else falls through to the ordinary unrolled path. Spot, directional, rect area, light probes and any shadow-casting point light are excluded. That is a design instruction, not an obstacle: the hundreds of fixtures are cheap unshadowed points, and shadow casting is a separate small budget (section 4).
- **`light.distance` must be greater than zero.** The GPU binning test is `distSq.lessThanEqual( distance.mul( distance ) )`, so a light with `distance === 0` has a zero-radius sphere, is never binned into any cluster, and **silently emits nothing**. The interior contract publishes `range` per fixture, so this is free to get right, but it is exactly the kind of silent no-op that costs a day.
- **WebGPU only.** It needs `attributeArray` storage buffers and `renderer.compute()`, and it is the only lights example in the repo that gates on `WebGPU.isAvailable()` and throws otherwise. The WebGL2 backend implements compute as transform feedback, which cannot express the scatter writes this needs (section 7).
- **CPU cost per frame** is not free: an O(N log N) sort of clustered lights by view Z, an O(24N) depth-slice scan, and a `DataTexture` upload. At a thousand lights that is roughly 25k JS iterations a frame.
- **It is break-even below about 30 lights** and only pays off past roughly 100. Community measurements on a different engine put 1024 point lights at 5.42 ms unclustered against 318 µs shading plus 463 µs binning clustered, while 16 lights showed a 14% *regression* (https://discourse.threejs.org/t/clustered-rendering-on-webgpu/81042, Apr-Jun 2025). Order of magnitude for the technique, not a three.js benchmark.

**`DynamicLighting`.** `examples/jsm/lighting/DynamicLighting.js`, `renderer.lighting = new DynamicLighting( { maxPointLights: 64 } )` (defaults 8 directional, 16 point, 16 spot, 4 hemisphere). It batches analytic lights into `uniformArray` uniforms and shades with `Loop( countNode )`, and its `customCacheKey` hashes only the *set of types present*, so adding or removing a light **does not recompile anything**. Still O(N) per fragment with no culling: it fixes the stutter, not the cost. No compute and no storage buffers, so it runs on the WebGL2 backend. Example `webgpu_lights_dynamic.html`.

### The per-room primitive: `material.lightsNode`

`NodeMaterial.lightsNode` exists precisely for this, and its own docstring says so: "Sometimes selective lighting is wanted which means only some lights in the scene affect a material." Resolution at `NodeMaterial.js` L1091 is `this.lightsNode || builder.lightsNode`.

```js
import { lights } from 'three/tsl';

roomMaterial.lightsNode = lights( [ roomProbe, ...roomFixtures ] );
```

(`examples/webgpu_lights_selective.html`.) A room's walls then compile against three to six lights instead of the whole city's thousand, **and adding a fixture in room 7 does not invalidate rooms 1 through 200**, because the per-material lights node replaces the scene-wide one in the cache key. This is the answer to both the linear shading cost and the global-recompile problem, and it composes with `ClusteredLighting`: interiors go through their own lights nodes, the street's unshadowed point lights go through the cluster grid.

Practical policy: `ClusteredLighting` for the exterior's unshadowed point fixtures (street lamps, sign spill, vehicle markers, window glow), always with `distance > 0`; `material.lightsNode` per room for interiors; `RectAreaLight` and shadow casters on a hand-managed near-player budget.

### Per-room irradiance from the fixture data

**The unit that makes this exact.** `PhysicalLightingModel` multiplies `context.irradiance` by `BRDF_Lambert = diffuseColor / π`. So for a `LightProbe`, `AmbientLight` or `HemisphereLight`, `color × intensity` **is the irradiance E in lux**, and outgoing diffuse radiance is `E · albedo / π`. The fill light can therefore be computed rather than dialled.

**The analytic fill, and it should be built first.** For a room of total interior surface area `A` (walls, floor, ceiling, m²), area-weighted albedo `ρ` per RGB channel, and total flux `Φ` in lumens summed over the room's published fixtures, the radiosity closed form for full interreflection is:

```
E_total = (Φ / A) · ρ / (1 − ρ)          per channel
```

The colour falls out for free because `ρ` is a per-channel vector: a red-walled room genuinely goes redder with each bounce, which is exactly the warm brown-green shadow the room reference shows. Assign it to a `HemisphereLight`, whose whole shader cost is three operations and no BRDF:

```js
const fill = new THREE.HemisphereLight();
fill.color.setRGB( ...normalized( E_total ) );        // ceiling side: fixture colour, interreflected
fill.groundColor.setRGB( ...normalized( E_floor ) );  // floor side reads different, and should
fill.intensity = luminance( E_total );
fill.position.copy( roomCentre ).add( up );
roomMaterial.lightsNode = lights( [ fill, ...roomFixtures ] );
```

Worked: a 4 x 4 x 2.7 m room, one 800 lm ceiling bulb, ρ ≈ 0.5. A = 2(16) + 4(10.8) = 75.2 m², so `E_total = (800/75.2) · (0.5/0.5) = 10.6 lux`. Direct illuminance under the bulb is `Φ/(4π d²) = 800/(4π · 2.7²) ≈ 8.7 lux`. **The fill is the same order as the key light**, which is what a real small room looks like, and what a hand-picked `AmbientLight( 0x404040 )` gets wrong by an order of magnitude in one direction or the other.

**The SH9 probe, for rooms with directional bounce.** When one wall carries a neon strip, a hemisphere's single vertical gradient is not enough. `examples/jsm/lights/LightProbeGenerator.js` gives `fromCubeTexture( cubeTexture )` (synchronous) and `await fromCubeRenderTarget( renderer, cubeRenderTarget )` (annotated for both renderers). `LightProbeNode` is registered on the WebGPU path (`StandardNodeLibrary.js` L84) and evaluates one `getShIrradianceAt( normalWorld, probe )` per fragment: nine vec3 uniforms, no BRDF, no branch, cheaper than a point light.

```js
const cubeRenderTarget = new THREE.CubeRenderTarget( 16 );   // from three/webgpu
const cubeCamera = new THREE.CubeCamera( 1, 1000, cubeRenderTarget );
cubeCamera.position.copy( roomCentre );
cubeCamera.update( renderer, scene );
const probe = await LightProbeGenerator.fromCubeRenderTarget( renderer, cubeRenderTarget );
```

**Use a cube size of 8 to 16, not 256.** `fromCubeRenderTarget` does six `readRenderTargetPixelsAsync` GPU-to-CPU round trips, each a fence stall of roughly a frame, then projects on the main thread in plain JS. At 256 that is 393k pixels times nine basis functions, tens of milliseconds of blocking; at 16 it is 1,536 pixels and negligible. SH9 cannot represent more than L2 detail anyway, so the resolution is wasted work. Budget roughly seven frames per probe, bake one room per frame during load or on first entry, never a batch synchronously. Helper on this path is `three/addons/helpers/LightProbeHelperGPU.js`. Examples: `webgpu_lightprobe`, `webgpu_lightprobe_cubecamera`.

Activate a room's probe when the player is inside it and cross-fade between adjacent rooms in a doorway.

**The one that is coming.** `examples/jsm/lighting/LightProbeGrid.js` is a complete irradiance volume: an L2 SH probe grid with a GPU-resident bake (cubemap render, SH projection, atlas repack, no CPU readback), real multi-bounce via `bake( renderer, scene, { cubemapSize, near, far, bounces } )`, per-object volume selection by bounding box, and hardware trilinear filtering with a padding slice per sub-volume. Its own docstring says **"this class can only be used with `WebGLRenderer`. A version for `WebGPURenderer` will be added at a later point"**, and the r185-to-r186 migration guide renames it `LightProbeGridWebGL` precisely to free the name for the WebGPU version. Two details worth stealing if we port it before then: the lookup is offset half a probe spacing along the normal to kill self-shadowing, and volumes are selected per object by bounding box, which our per-room `lightsNode` partitioning already gives us.

### IBL and reflections

There are two `PMREMGenerator` classes; `three/webgpu` exports the one at `src/renderers/common/extras/PMREMGenerator.js` (`Three.WebGPU.js` L13). Its signature carries the useful part: `fromScene( scene, sigma = 0, near = 0.1, far = 100, { size = 256, position, renderTarget } )`, where **`options.position` bakes from an arbitrary point without moving anything**, a per-room bake position for free. It throws with a named message if called before `await renderer.init()`, and `fromSceneAsync` is deprecated since r181.

`PMREMGenerator.fromScene(...)` into `scene.environment` stays the exterior answer, rebaked on a coarse threshold (`RESEARCH.md` section 5). `Scene.environmentIntensity` and `Scene.environmentRotation` exist in r185, and the per-material override resolves cleanly: `MaterialProperties.js` L23 is literally `material.envMap ? material.envMapIntensity : scene.environmentIntensity`, so **a room carrying its own `envMap` also carries its own intensity, fully decoupled from the scene's**.

For interiors, the sharper tool is **box-projected cubemap environment mapping**, and r185 ships the pieces:

```js
import { pmremTexture, getParallaxCorrectNormal, reflectVector } from 'three/tsl';
material.envNode = pmremTexture(
    roomCubeRT.texture,
    getParallaxCorrectNormal( reflectVector, roomSizeVec3, roomCentreVec3 )
);
```

(`examples/webgpu_materials_envmaps_bpcem.html` L93-100.) A room is a box, so the parallax correction is exact, and a wet floor or a glass counter reflects the room's own geometry in the right place instead of a smeared infinite cubemap. It also answers the standing glass-reflection feedback item: one low-res probe per room, one for the skyline.

### Emissive surfaces as lights

Neon and screens are the dominant sources in this world, and **r185 has no emissive-to-light mechanism at all** (grep for "emissive" across `src/nodes/lighting/` and `src/lights/` returns nothing; `material.emissiveNode` is added after the lighting model runs and contributes to no one else's shading). The manual pairing is: the emissive material makes a sign *visible* and feeds selective bloom; a co-located light makes it *illuminate*.

`RectAreaLight` is the physically right partner for a strip or a screen, and it needs one init line that is easy to miss:

```js
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
THREE.RectAreaLightNode.setLTC( RectAreaLightTexturesLib.init() );   // nothing in src/ calls this
```

(`webgpu_materials_envmaps_bpcem.html` L59, `webgpu_volume_lighting_rectarea.html` L108, `webgpu_lights_rectarealight.html`.) Forget it and `setupDirectRectArea` dereferences null.

**Its cost rules out using it everywhere.** Per fragment it is an LTC evaluation: two LUT texture fetches plus a four-edge polygon integral, once for diffuse and once for specular. Call it three to six times a `PointLight`, and unlike a point light **there is no distance cutoff**, so it is evaluated at full cost for every fragment of every material it touches. It casts no shadows (there is no `RectAreaLightShadow` class), works only on standard and physical materials, and clustered lighting never takes it, so adding or removing one recompiles.

So: `RectAreaLight` for hero fixtures only, the three to six on the street the player is standing on plus the strips in the room they are in, swapped by proximity. Everything else is emissive geometry plus a cheap clustered `PointLight` at the strip's centroid, with the equivalent intensity `PointLight.intensity = RectAreaLight.intensity · width · height / 4`. Windows are the one case that always earns the cost, because a window is a rectangle and there is exactly one per room.

**IES profiles are nearly free and belong on every fixture kind.** `src/lights/webgpu/IESSpotLight.js` (WebGPU-only, exported as `THREE.IESSpotLight`) plus `examples/jsm/loaders/IESLoader.js`, which parses a real photometric file into a 180 x 1 `RedFormat` `DataTexture`. `IESSpotLightNode` overrides only `getSpotAttenuation`, replacing the analytic cone with one `acos` and one texture fetch:

```js
const iesTexture = await new IESLoader().setPath( './ies/' ).loadAsync( 'fixture.ies' );
const spot = new THREE.IESSpotLight( color, 500 );
spot.iesMap = iesTexture;
```

One profile per published fixture kind, loaded once and shared across every instance, is the cheapest way to stop every downlight in the city casting the same perfect ellipse. Example `webgpu_lights_ies_spotlight`. The sibling `src/lights/webgpu/ProjectorLight.js` is a textured spot with an `aspect`, and `SpotLight.map` (`webgpu_volume_lighting.html` L186) is the plain cookie. For a neon sign throwing its own glyph shape onto wet pavement, a projector light is far cheaper than a rect area light.

### What fakes bounce, ranked by cost

| technique | what it buys | per-fragment cost | backend | when |
|---|---|---|---|---|
| Fog as the shadow floor | the coloured black floor the references have | a mix | both | always |
| Analytic per-room fill from fixture data | the warm wall gradient, `E = (Φ/A)·ρ/(1−ρ)` | ~5 ALU (`HemisphereLight`) | both | **first**; uses the contract's data directly, no assets |
| Environment probe (sky, skyline) | outdoor fill, glass reflections | one cubeUV fetch | both | always |
| Box-projected per-room PMREM | in-room reflections with correct parallax | one cubeUV fetch | both | stage 2; highest quality per ms |
| SH9 `LightProbe` per room | directional bounce (neon on one wall) | 9 vec3 MADs | both | stage 2, where a hemisphere is not enough |
| Baked lightmap + AO on uv1 | true static bounce | 2 texture fetches | both | supported (`NodeMaterial` L975-1015 and L1039, example `webgpu_materials_lightmap`) but not planned: interiors are generated per seed, so there is no offline bake step to hang it on. If it ever is, bake per **room archetype**, not per instance |
| Irradiance volume (`LightProbeGrid`) | multi-bounce grid, per-object volumes | trilinear + SH9 | **WebGL only today** | the best long-term answer; wait for the WebGPU version or port it |
| SSGI + denoise | screen-space bounce including emissive neon | 32 spp + TAA | WebGPU (WebGL2 untested) | stage 3 luxury |

`ssgi( beautyNode, depthNode, normalNode, camera )` from `examples/jsm/tsl/display/SSGINode.js` (based on SSRT3 / SSILVB), with `webgpu_postprocessing_ssgi` and `webgpu_postprocessing_ssgi_ballpool`. Parameters: `sliceCount` (1), `stepCount` (12), `radius` (12 world units), `aoIntensity` (1), `giIntensity` (10), `expFactor` (2), `thickness` (1), `useScreenSpaceSampling` (true), `useTemporalFiltering` (true).

It **outputs both GI and AO** through `getGINode()` and `getAONode()`, composited separately:

```js
scenePass.setMRT( mrt( { output, diffuseColor, normal: packNormalToRGB( normalView ), velocity } ) );
const gi = ssgi( scenePassColor, scenePassDepth, sceneNormal, camera );
gi.sliceCount.value = 2;  gi.stepCount.value = 8;
const composite = vec4( scenePassColor.rgb.mul( gi.getAONode().r ).add( scenePassDiffuse.rgb.mul( gi.getGINode().rgb ) ), scenePassColor.a );
renderPipeline.outputNode = traa( composite, scenePassDepth, scenePassVelocity, camera );
```

So it **replaces GTAO rather than joining it**. Its own docstring gives the cost as `sliceCount × stepCount × 2` samples per pixel; the shipped example runs 2 x 8 = **32 samples per pixel per frame**, and the example's own comment declines to raise the pixel ratio as "probably too costly for most hardware". `useTemporalFiltering = true` requires TRAA; false requires a manual `DenoiseNode`.

**Its virtue here is specific and large:** it reads the beauty buffer, so **emissive neon automatically becomes a GI source** with no extra lights. Its vice is equally specific: light from a sign behind the camera contributes nothing and it pops as you turn. For a night street where the dominant light is on-screen and emissive, that trade is unusually favourable. Stage 3, quality tier `ultra`, prototyped with a plan to cut it.

Related and often confused with a GI feature: `examples/jsm/tsl/display/ImportanceSampledEnvironment.js` builds luminance CDF tables and MIS estimators from an equirect HDR, and its **only consumer in the whole repo is `SSRNode`**, where it supplies the env-miss term for reflection rays that leave the screen. It is not a lighting-quality feature and not a GI path.

---

## 3. Postprocessing that earns realism

### The canonical r185 pipeline

`examples/webgpu_postprocessing_ao.html` L109-157 is the shape to build on, and it answers several questions at once:

```js
const renderPipeline = new THREE.RenderPipeline( renderer );

// prepass: normals + velocity, no transparents
const prePass = pass( scene, camera );
prePass.transparent = false;
prePass.setMRT( mrt( { output: packNormalToRGB( normalView ), velocity } ) );
prePass.getTexture( 'output' ).type = THREE.UnsignedByteType;      // bandwidth
const prePassNormal = sample( ( uv ) => unpackRGBToNormal( prePass.getTextureNode().sample( uv ) ) );
const prePassDepth = prePass.getTextureNode( 'depth' );
const prePassVelocity = prePass.getTextureNode( 'velocity' );

// scene
const scenePass = pass( scene, camera );

// GTAO, half res, fed back INTO shading rather than multiplied over the frame
const aoPass = ao( prePassDepth, prePassNormal, camera );
aoPass.resolutionScale = 0.5;
aoPass.useTemporalFiltering = true;
scenePass.contextNode = builtinAOContext( aoPass.getTextureNode().sample( screenUV ).r );

renderPipeline.outputNode = traa( scenePass, prePassDepth, prePassVelocity, camera );
```

The load-bearing detail is `builtinAOContext` (`src/nodes/core/ContextNode.js` L244). It overrides `getAO` inside the lighting model, so the AO term attenuates **indirect** light only and skips transparent materials. Multiplying an AO buffer over the finished frame darkens direct light too and produces the dirty smudged look that gives screen-space AO a bad name. The correct wiring is in core, and it is one line.

There is no SSAO node in r185: `GTAONode.js` is the only screen-space AO on the node path (`webgl_postprocessing_ssao` and `_sao` are legacy `EffectComposer` examples). Its uniforms are `radius` (0.25), `thickness` (1), `distanceExponent` (1), `distanceFallOff` (1), `scale` (1) and `samples` (16), plus the plain properties `resolutionScale` (1) and `useTemporalFiltering` (false). `samples` is a total tap budget split into 3 direction slices below 30 and 5 above, so crossing 30 changes the sampling pattern, not just the count.

GTAO is noisy and needs one of two things downstream, and the docs say so: `useTemporalFiltering = true` **requires TRAA** and inherits its ghosting; with it false, a manual `DenoiseNode` (à-trous, `lumaPhi`/`depthPhi`/`normalPhi`/`radius`) is needed instead. The r185 example takes the temporal route, which is the cheaper one for us since TRAA is already in the chain for the sub-pixel emissives.

The prepass costs a second geometry submission. At city scale that is the real price of GTAO, not the AO shader itself, and it is why GTAO sits in stage 2 behind the free wins.

**The prepass may be avoidable.** `GTAONode`'s `normalNode` is optional: when it is `null` the node reconstructs normals from depth via `getNormalFromDepth` (`GTAONode.js` L340). Depth-reconstructed normals are worse at silhouettes and give a slightly softer occlusion, but they cost nothing. Since the scene pass already carries a depth attachment, that turns GTAO from "a whole extra geometry pass plus an AO pass" into just the AO pass. Measure both: if the reconstruction holds up in interiors, the prepass exists only for TRAA's velocity, and velocity can be an MRT channel on the main scene pass instead of a separate prepass.

### Selective bloom, driven by the emissive channel

The single most important effect for this look, and r185 has the exact example: `webgpu_postprocessing_bloom_emissive.html` L98-124.

```js
import { pass, mrt, output, emissive, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const scenePass = pass( scene, camera );
const mrtNode = mrt( { output, emissive: vec4( emissive, output.a ) } );
mrtNode.setBlendMode( 'emissive', new THREE.BlendMode( THREE.NormalBlending ) );
scenePass.setMRT( mrtNode );
scenePass.getTexture( 'emissive' ).type = THREE.UnsignedByteType;

const bloomPass = bloom( scenePass.getTextureNode( 'emissive' ), 2.5, 0.5 );
renderPipeline.outputNode = scenePass.getTextureNode().add( bloomPass );
```

Bloom is fed by the emissive attachment, so **neon tubes, screens, lamp housings and lit windows bloom; a brightly lit wall does not.** That is precisely the reference behaviour: the bar's tubes glow, the wall they light does not. A luminance-threshold bloom cannot make that distinction and always ends up blooming the floor.

`emissive` here is a TSL property node (`src/nodes/core/PropertyNode.js` L188), the post-lighting emissive term, so it already accounts for `emissiveMap` times `emissiveIntensity` on every material with no per-object setup. The materials box authors emissive strength through `KHR_materials_emissive_strength`; that number becomes the bloom amount for free.

`BloomNode` constructor is `bloom( inputNode, strength = 1, radius = 0, threshold = 0 )` with `.strength`, `.radius`, `.threshold`, `.smoothWidth` as uniforms. With an emissive input the threshold stays at 0 (the selection already happened) and the tuning target is the measured street-lamp profile: **small radius, moderate strength**.

`webgpu_postprocessing_bloom_selective.html` shows the second form: a `bloomIntensity` mask channel written per material via `material.mrtNode = mrt( { bloomIntensity: uniform( 0 or 1 ) } )`, with `float( 0 )` as the pass-level default. `MRTNode` has `merge( mrtNode )` (`src/nodes/core/MRTNode.js` L149), so both selectors compose: emissive as the base, and a hand-set mask channel for the few things that should glow without being emissive (a headlight core, a wet-road specular hit). Toggle at runtime with `material.mrtNode.get( 'bloomIntensity' ).value`.

### Anti-aliasing

Not optional here. The Blade Runner reference has thousands of sub-pixel emissives; the street reference has thin neon lines on a wet road. Both are worst-case aliasing, and both crawl violently in motion without temporal accumulation.

`traa( colorNode, depthNode, velocityNode, camera )` from `TRAANode.js` takes velocity from the prepass MRT (the `velocity` node), which the AO prepass is already producing. So TRAA is close to free once GTAO is in: one buffer, already paid for. It jitters the camera itself with a Halton sequence, so jitter is not ours to manage. `useSubpixelCorrection` is a flag on the pass.

`taau( colorNode, depthNode, velocityNode, camera )` is TRAA plus upscaling, and it is the performance lever worth knowing about: render the scene pass at `setResolutionScale( 0.5 )` and resolve to full resolution, which cuts fragment cost roughly fourfold on everything downstream (lighting, GTAO, SSR) while keeping temporal stability. Examples pair it with `sharpen( ..., 0.5 )`. That is the standard modern game answer to a fragment-bound frame, and it is the first thing to try if the stage 2 budget does not fit. `FSR1Node` (`fsr1( node, sharpness, denoise )`) is the spatial-only fallback for machines where TAAU ghosts.

SMAA and FXAA (`SMAANode`, `FXAANode`) are the fallback-tier answer and do nothing for temporal stability. Note the two are wired differently: SMAA runs in working space (`smaa( scenePass )`, transform left on), FXAA needs sRGB input and therefore `outputColorTransform = false` plus an explicit `renderOutput( scenePass )` before it. Do not stack either on top of TRAA. MSAA (`new WebGPURenderer({ antialias: true })`) is orthogonal, does nothing for specular aliasing, and conflicts with an MRT G-buffer setup.

### Screen-space reflections for the wet road

`ssr( colorNode, depthNode, normalNode, { metalnessNode, ... } )` from `SSRNode.js`, uniforms `maxDistance`, `thickness`, `quality`, plus `resolutionScale`. `examples/webgpu_postprocessing_ssr.html` L148-190 packs what it needs into one MRT on the scene pass, with no separate prepass:

```js
scenePass.setMRT( mrt( {
    output,
    normal: packNormalToRGB( normalView ),
    metalrough: vec2( metalness, roughness )      // both in one attachment
} ) );
const ssrPass = ssr( scenePassColor, scenePassDepth, sceneNormal, { metalnessNode: scenePassMetalRough.r } );
const outputNode = smaa( scenePassColor.add( ssrPass.rgb ) );
```

Two options in `SSRNodeOptions` decide whether this works at all for our case:

- **`reflectNonMetals` defaults to `false`**, and when false the pass discards dielectrics entirely for a large performance gain. **Wet asphalt is a dielectric.** Without `reflectNonMetals: true` the street reference's whole subject silently does not render. This is the kind of quiet no-op section 7 warns about.
- `stochastic` (default `false`) picks the algorithm: false traces one mirror ray and softens with a blur (first-generation SSR), true varies the ray per pixel with GGX importance sampling (second-generation, correct on rough surfaces, noisy, and it expects a denoiser downstream). A wet road is a rough reflector, so `stochastic: true` is the physically right answer and `false` is the affordable one. Start at `false` with `reflectNonMetals: true`, `resolutionScale: 0.5`, low `quality` and a short `maxDistance`, and only reach for stochastic plus `temporalReproject` plus `recurrentDenoise` (the `webgpu_postprocessing_ssr_denoise` chain) if the blur reads wrong.
- `environmentNode` / `envImportanceSampling` take an equirectangular HDR with CPU-side `image.data` and are **not compatible with a PMREM cubemap**, so SSR cannot fall back to our existing `scene.environment` for off-screen rays. Off-screen misses stay misses.

SSR's screen-space limitation (nothing off-screen or behind geometry reflects) is acceptable on a ground plane looking down a street, where most of what reflects is on screen. It is also the effect most likely to blow the frame budget. `Reflector.js` planar reflection remains the alternative for a single flat puddle, at the cost of a second scene render.

### What to skip

- **Chromatic aberration, film grain, vignette.** Grain at a very low amplitude has one legitimate job here, breaking up banding in the huge soft falloffs, and `bayer16` dithering does that job better and cheaper. Beyond that these are camera artefacts, and every one of them makes a frame look more like a video game trying to look filmic. `ChromaticAberrationNode` and `FilmNode` exist; they stay off.
- **Depth of field.** `DepthOfFieldNode` exists. In a first-person game it fights the player's own eye. Reserve it for the dialogue camera, where the subject is fixed and the effect is doing composition work.
- **Motion blur.** `motionBlur( input, velocity, numSamples = 16 )` exists, and the velocity buffer is already there for TRAA, which makes it tempting. Sixteen full-resolution taps per pixel makes it the most expensive item on this "cheap effects" list, and in a game where the player controls the camera, per-object motion blur reads as input lag. At 60fps there is almost no perceptual budget for it to work in.
- **Lens flare.** `LensflareNode` exists (`webgpu_postprocessing_lensflare`). One flare on the strongest source in frame is defensible; a flare per neon sign in a city of neon signs is a mess.

None of these appear in the reference images. Every effect in the "keep" list does.

---

## 4. Shadows

### What r185 implements on the node path

`src/nodes/lighting/ShadowFilterNode.js` exports `BasicShadowFilter`, `PCFShadowFilter`, `PCFSoftShadowFilter` and `VSMShadowFilter`, and `src/nodes/lighting/ShadowNode.js` L177 indexes them straight off `renderer.shadowMap.type`:

```js
const _shadowFilterLib = [ BasicShadowFilter, PCFShadowFilter, PCFSoftShadowFilter, VSMShadowFilter ];
```

So all four map types are real on the node path. Their differences matter for tuning:

- `PCFShadowFilter` takes 5 Vogel-disk samples rotated per pixel by interleaved gradient noise on top of hardware 4-tap PCF (effectively 20 filtered taps) and **uses `shadow.radius`**.
- `PCFSoftShadowFilter` takes 4 `textureGather` compares (16 taps, bilinear-weighted) and **ignores `shadow.radius`**. So the softness of `PCFSoftShadowMap` is not adjustable; if a wider penumbra is wanted, `PCFShadowMap` with a larger `radius` is the adjustable one.
- `blurSamples` applies to VSM only.
- `light.shadow.intensity`, `bias`, `normalBias` and `biasNode` all apply; `webgpu_volume_lighting.html` L188-193 uses `shadow.intensity = 0.98`, `mapSize 1024`, `shadow.focus = 1`.

**`light.shadow.filterNode` is a supported per-light override.** `ShadowNode.js` L535 reads `shadow.filterNode || this.getShadowFilterFn( renderer.shadowMap.type )`, and a filter is just `Fn( ( { depthTexture, shadowCoord, shadow, depthLayer } ) => ... )`. That is the sanctioned extension point.

**No PCSS in core.** `webgl_shadowmap_pcss` is a legacy WebGL example that patches GLSL chunks. Contact-hardening penumbra would be a hand-written `filterNode` at roughly twice PCF's cost (a blocker search plus a variable-radius filter). Not worth it here: at night almost every shadow comes from a small fixture a short distance away, where a fixed-radius PCF penumbra is already close to correct.

**Android WebGPU renders harder shadows than desktop.** `WebGPUBackend.js` L177 disables `TEXTURE_COMPARE` on any Android user agent, so `ShadowNode.setupShadow` falls back to `NearestFilter` on the depth texture (L426-436) and hardware PCF is off. The WebGL2 backend reports compatibility unconditionally. Worth knowing before this gets chased as a bug.

**Cascades**: `examples/jsm/csm/CSMShadowNode.js` (WebGPU-only; the WebGL sibling is `CSM.js`), example `webgpu_shadowmap_csm`.

```js
csm = new CSMShadowNode( light, { cascades: 4, maxFar, mode: 'practical', lightMargin: 200 } );
light.shadow.shadowNode = csm;      // the plug point
csm.camera = camera;  csm.updateFrustums();
```

`fade` is a settable property but the official example leaves the line commented out, so treat smooth cascade transitions as unproven. `examples/jsm/tsl/shadows/TileShadowNode.js` is the sibling that splits one light's map into a `tilesX × tilesY` grid for higher effective resolution over a large area; it landed around r176 (April 2025) and is still maintained, but **it ships no example in r185** and does not support `VSMShadowMap`. CSM is the trodden path.

### The cost model at city scale

A shadow map is a full scene re-render from the light's view; a shadow-casting point light is six of them. That is the entire cost story, and it means shadow casters are a draw-call budget, not a lighting budget. Clustered lighting makes 900 lights affordable to *shade*; it does nothing to make them affordable to *shadow*.

**Clustered lighting enforces this split itself.** `ClusteredLightsNode.setLights` L218:

```js
if ( light.isPointLight === true && light.castShadow !== true ) {
    clusteredLights[ clusteredIndex ++ ] = light;
} else {
    materialLights[ materialIndex ++ ] = light;   // normal per-light path
}
```

A point light that casts a shadow leaves the cluster path entirely. So the design is decided for us: **the hundreds of small fixtures are unshadowed point lights, and shadow casting is a separate, small, hand-managed set.**

- **One cascaded directional shadow** for the moon via `CSMShadowNode`, 3-4 cascades. Always on.
- **Four to eight dynamic shadow casters**, ranked each frame to the nearest fixtures that actually have something moving under them. This is the existing `LightBudget` reshuffle idea retargeted: it manages *shadow slots* now, not light slots, because the lights themselves are free under clustering.
- **Cached static shadow maps.** `light.shadow.autoUpdate = false` plus `light.shadow.needsUpdate = true` on demand renders a light's map once and reuses it. `ShadowNode.updateBefore` (L851-877) honours both and clears `needsUpdate` after the render, so this is a fully supported pattern. A city of fixtures over static geometry is the ideal case: most maps render once at tile load and never again. Note that `renderer.shadowMap.autoUpdate` **does not exist** on `WebGPURenderer` (its `shadowMap` is `{ enabled, transmitted, type }`, `Renderer.js` L703); the per-light properties are the only throttle.
- **No shadow atlas in r185.** There is a shadow map *array* used internally by CSM and TileShadowNode (`depthLayer` threading through `ShadowFilterNode.js`), but no general packing atlas to drive. Each shadow-casting light owns its own render target.
- **Contact shadows for props.** `webgpu_shadow_contact.html` renders an orthographic depth pass into a 512² target, blurs it with `gaussianBlur` and feeds `shadowPlaneMaterial.opacityNode`. Not a screen-space technique and not city-scale, but it grounds a bin bag or a crate that no shadow-casting light reaches. GTAO covers the same ground more generally; this is the fallback tier's version.
- **`RectAreaLight` casts no shadow at all.** Interior strips and coves are shadowless by construction, which is convenient: they are broad soft sources whose shadows would be nearly invisible anyway. Their occlusion comes from GTAO and from the probe.
- **No screen-space contact shadows in r185.** Nothing in `src/nodes/` or `examples/jsm/` implements a shadow ray march. The prepass already produces linear depth and view normals, which is everything such a pass needs, so it is writable, but it is ours to write.

---

## 5. Atmosphere

The wide interior glow and the light shafts are one feature, and r185 ships it.

### Volumetric lighting

`webgpu_volume_lighting.html`, `webgpu_volume_lighting_rectarea.html` and `webgpu_volume_lighting_traa.html`. The mechanism, from the first (L133-234):

```js
const volumetricMaterial = new THREE.VolumeNodeMaterial();
volumetricMaterial.steps = 12;                                   // raymarch steps, GUI range 2-16
volumetricMaterial.offsetNode = bayer16( screenCoordinate );     // dither, kills the banding
volumetricMaterial.scatteringNode = Fn( ( { positionRay } ) => { /* density field */ } );
volumetricMaterial.depthNode = sceneDepth.sample( screenUV );    // occlude against scene depth

const volumetricMesh = new THREE.Mesh( new THREE.BoxGeometry( 20, 10, 20 ), volumetricMaterial );
volumetricMesh.layers.disableAll();
volumetricMesh.layers.enable( LAYER_VOLUMETRIC_LIGHTING );

const volumetricPass = pass( scene, camera, { depthBuffer: false } );
volumetricPass.setLayers( volumetricLayer );
volumetricPass.setResolutionScale( 0.25 );                       // quarter res
const blurred = gaussianBlur( volumetricPass, denoiseStrength );
renderPipeline.outputNode = scenePass.add( blurred.mul( volumetricLightingIntensity ) );
```

The volume is an ordinary box mesh on its own layer, raymarched in a separate quarter-resolution pass, blurred, and added. `VolumeNodeMaterial` forces `side = BackSide`, `transparent`, `depthTest = false`, `depthWrite = false`, and `steps` defaults to **25** (the example turns it down to 12).

Details that decide whether this works for us, from `src/nodes/functions/VolumetricLightingModel.js`:

- **Lights opt in per layer.** `light.layers.enable( LAYER_VOLUMETRIC_LIGHTING )` is what makes a fixture scatter. Nothing scatters by default, which is the right shape for a budget: enable it on the handful of fixtures near the player.
- `direct()` opens with `if ( lightNode.isAnalyticLightNode !== true || lightNode.light.distance === undefined ) return;`, so **point and spot lights scatter, and `DirectionalLight` is silently skipped.** Moonlight shafts need a different trick.
- **`directRectArea()` is implemented** through `LTC_Evaluate_Volume`. A `RectAreaLight` neon strip gets true volumetric scattering, which is the single most useful fact here: interior's `strip` and `cove` fixtures scatter correctly, and so does a neon sign. `webgpu_volume_lighting_rectarea` demonstrates it.
- **Cost is `steps × lights reaching the volume × pixels`, plus a shadow lookup per light per step**, since `direct()` multiplies by `lightNode.shadowNode`. The resolution scale and the step count are the two real controls, and the example's 0.25 and 12 are the settings to start from.

This is the effect that produces the bar reference's wide soft wash. A volume box scoped to one room or one lamp's neighbourhood costs a fraction of a full-screen march.

**Godrays are not the cheap alternative they look like.** `examples/jsm/tsl/display/GodraysNode.js` (a port of `three-good-godrays`) is `godrays( depthNode, camera, light )`, and it **raymarches the light's shadow map**: it reconstructs world position from scene depth, clips the ray to the shadow camera's frustum planes and tests the shadow map per sample. So it does not need the light on screen and it occludes correctly. Parameters: `raymarchSteps` (60), `density` (0.7), `maxDensity` (0.5), `distanceAttenuation` (2), `resolutionScale` (0.5).

Its limits are the problem: **only `PointLight` and `DirectionalLight`** (a `SpotLight` throws `THREE.GodraysNode: Unsupported light type.`), it requires a full shadow setup on that light, and its output is a **monochrome mask** in rgb with depth in alpha, composited as `depthAwareBlend( sceneColor, bilateralBlur( godraysPass.getTextureNode() ), sceneDepth, camera, { blendColor } )` where `blendColor` supplies the tint. Street lamps are spot lights, so godrays are the wrong tool for the street. Their use here is the Blade Runner shaft: one directional backlight through haze.

`radialBlur( textureNode, { center, weight, decay, count, exposure } )` is the genuinely cheap screen-space fake, and its own docs state the limitation plainly: the centre is 2D, so it does not honour depth at all.

### Fog

r185 has height fog in core:

```js
import { fog, color, exponentialHeightFogFactor, uniform } from 'three/tsl';
const density = uniform( 0.04 ), height = uniform( 2 );
scene.fogNode = fog( color( 0xffdfc1 ), exponentialHeightFogFactor( density, height ) );
scene.backgroundNode = color( 0xffdfc1 );
```

(`examples/webgpu_fog_height.html` L41-66.) `rangeFogFactor` and `densityFogFactor` are the linear and exponential siblings. Height fog is what makes ground haze pool in the street and thin out over the towers, which is the Blade Runner reference's depth structure.

`webgpu_custom_fog_scattering.html` L184-204 adds the second half of aerial perspective:

```js
const fogFactor = densityFogFactor( density ).context( { getViewZ: () => scenePass.getViewZNode() } );
renderPipeline.outputNode = mix( scenePassColor, sceneColorBlurred, fogFactor );
```

Fog that **blurs** with distance as well as tinting. That is the measured behaviour of the bar reference (local contrast falling with depth inside one room) and of the Blade Runner reference (far city lifted 4x and soft). It is a gaussian blur and a mix, and it does more for perceived depth than most of the expensive effects in this document.

**Fog colour is not an art choice.** It is the average colour of the light filling the air: cyan on the neon street, warm amber in the bar, cold blue-grey under moonlight. Drive it from the same source that drives the environment probe, and it will be right automatically. Its density is the exposure control for the shadow floor: raising density raises the measured "darkest 20%" figure directly, which is the correct setting for the user's "not that obscure" note.

Two hooks make that tint cheap. `NodeManager.updateFog` derives a fog node from a plain `scene.fog` using `reference(...)` uniforms, so `scene.fog.density` and `scene.fog.color` stay live-editable without a shader rebuild. And `NodeMaterial.setupFog` assigns the shaded colour to the `output` property node before evaluating `fogNode`, so a custom fog node can **read the fragment's own shaded colour** and bias the fog toward it: fog picks up the neon that is actually in frame rather than a constant. `material.fog = false` opts a material out.

`examples/webgpu_custom_fog.html` L112-131 is the worked ground-fog version, with `triNoise3D` driving a moving fog top so the haze is not a flat plane.

### Light cones for the fallback tier

**r185 ships no soft-particle helper.** Nothing in `src/` or `examples/jsm/` implements a depth fade for billboards. The primitives are all there and exported from `three/tsl`: `linearDepth()`, `viewportLinearDepth`, `viewportDepthTexture()`, `remapClamp`, `normalView`. `examples/webgpu_backdrop_water.html` L145-157 uses exactly the pattern (`viewportLinearDepth.sub( linearDepth() ).remapClamp( ... )`) for water depth.

A cone mesh with an additive gradient, faded three ways, is the `low`-tier stand-in for volumetrics: `viewportLinearDepth.sub( linearDepth() ).remapClamp( 0, softness )` so it does not cut hard into the ground, `normalView.z.abs()` so its silhouette does not show, and a radial plus length falloff for the cone shape itself.

**One cost trap to design around:** `ViewportTextureNode.updateBefore()` calls `renderer.copyFramebufferToTexture(...)` **every frame, per node instance**. Build one shared `viewportDepthTexture()` node and reuse it across every cone and particle material, or the fallback tier pays a full framebuffer copy per material.

Cheaper still, and free: `SpotLight.map` is a projected cookie (`SpotLightNode` samples `texture( light.map, lightCoord.xy )`), and `light.colorNode = ( lightCoord ) => ...` gives a procedural gobo. A shaped pool of light on wet pavement costs nothing beyond the fixture that was already there.

---

## 6. Micro-realism

Why the bin bags work, generalised.

### Specular micro-response is what makes a cheap object read real

An object with near-black albedo carries no diffuse information at all. Everything visible about it is the specular lobe sweeping across its curvature. Three things have to be true for that to happen:

1. **Roughness low enough for a lobe with shape.** Above about 0.6 the lobe is so wide it becomes a second diffuse term and the object goes flat. The bags read at roughly 0.2.
2. **Normals that vary at the right scale.** Folds and wrinkles at centimetre scale, which is a normal map, not geometry.
3. **A light with an extent.** A point light gives a point highlight; the streak highlights in the reference need a source with area, which is what `RectAreaLight` and a wide-penumbra spot provide.

The same three conditions explain the accordion gate (grazing light, only the rolled edges catch), the bottles on the bar counter (dark bodies, lit edges) and the wet road (a stretched lobe on a rough plane). It is one phenomenon.

This is a materials decision as much as a lighting one, and the materials box's `finish` bands are already built for it: `roughness: [min, max]` read off a **blurred** relief so gloss varies over centimetres rather than per pixel, with `grain` controlling how much pixel-scale speckle survives. The contract's own explanation of why ("bright specks come back shiny and dark blotches come back damp, which at night is glitter on the walls") is exactly the failure this section is about. Their bands are the numbers to trust: walls 0.88-0.96 at poor tier down to 0.54-0.64 at high_rich, concrete 0.90-0.97 down to 0.46-0.56, tile 0.54-0.62 down to 0.24-0.32.

Note what those bands imply: **almost nothing in this world is glossy.** The gloss lives in the props (plastic, glass, wet ground, metal fittings), and its rarity is what makes it read. A city where everything is at roughness 0.4 looks like plastic; a city of 0.9 walls with a few 0.2 objects in it looks real.

### Roughness under grazing light, and the aliasing it causes

Grazing light on a normal-mapped surface at distance is the classic specular aliasing case: the normal map's high-frequency detail mips away while roughness stays constant, so the lobe stays tight while the normals it rides on get averaged, and the result sparkles and fireflies in motion.

**r185 solves half of this already, and the half it solves is not the half that bites us.** `src/nodes/functions/material/getRoughness.js` runs on every standard and physical node material (`MeshStandardNodeMaterial.js` L159-162):

```js
let roughnessFactor = roughness.max( 0.0525 );   // base mip of a 256 cubemap
roughnessFactor = roughnessFactor.add( getGeometryRoughness() ).min( 1.0 );
```

and `getGeometryRoughness.js` derives that term from `normalViewGeometry.dFdx()` and `dFdy()`, the **interpolated geometric normal**. So curvature aliasing on a tight bend is filtered automatically, and the roughness floor of 0.0525 is already enforced. What is *not* filtered is normal-**map** variance, because the geometric normal knows nothing about the map riding on it.

That remaining half is an asset-pipeline job: **bake normal-map variance into the roughness mips**, so a noisier normal distribution at a coarse mip becomes a higher roughness value at that mip. The practical formulation is the vMF one, which converts roughness to a von Mises-Fisher sharpness, averages in that space over the mip footprint, and converts back, with the composition rule `α' = sqrt( α² + 2/λ )` (http://graphicrants.blogspot.com/2018/05/normal-map-filtering-using-vmf-part-3.html; background at https://blog.selfshadow.com/2011/07/22/specular-showdown/). Toksvig is the cheaper single-scalar version and breaks on two-channel normals; LEAN/LEADR is higher quality and costs two extra textures, which is more than a browser game needs.

Four concrete actions, and they belong to the materials box because it owns the mip chain and the finish bands:

1. Generate the normal map's mip chain in the pipeline, compute the per-mip normal variance and write the corresponding roughness into the matching roughness mip. Ship them with `texture.generateMipmaps = false` and an explicit `texture.mipmaps`, so the runtime cannot regenerate a naive chain and undo the work.
2. Floor authored roughness at about 0.06 for anything seen at distance. `getRoughness()` already floors at 0.0525; a mirror-smooth authored value is a firefly generator.
3. Set `texture.anisotropy = renderer.getMaxAnisotropy()` on normal maps. **Caveat:** on the WebGL2 backend anisotropy is silently skipped for `FloatType` textures without `OES_texture_float_linear` (`WebGLTextureUtils.js` L373), so keep normals at 8-bit or half-float.
4. Run TRAA as the last line of defence. It hides residual shimmer, not its cause.

### Grime, and why layered detail sells a surface

A single tiling texture reads as a repeating texture no matter how good it is. What breaks the read is variation at a scale the tile does not carry:

- **Large-scale breakup**: a low-frequency mask multiplied into roughness and darkening base colour, at a scale of several metres, so the same wall is dirtier in one place than another. The interior contract already puts moisture staining and heavy grime in the poor tier's base colour; this is the runtime layer on top.
- **Small-scale detail normal**: a fine tiling normal at centimetre scale, blended onto the base normal, so surfaces still have micro-relief when the camera is close enough to out-resolve the base map.
- **Cavity and edge darkening**: grime collects in cavities, wear exposes clean material on edges. GTAO gives the cavity half at runtime for free.

The eye reads realness mostly from **specular breakup**, where a highlight is continuous against where it is broken, and that lives in the roughness map rather than the albedo. A perfectly uniform roughness reads as plastic no matter how good the diffuse texture is.

`triplanarTexture` / `triplanarTextures( textureXNode, textureYNode, textureZNode, scaleNode, positionNode, normalNode )` are exported from `three/tsl` (`src/nodes/utils/TriplanarTextures.js`) and are the seam-free way to tile a detail layer over concrete and asphalt. They take `texture( map )` nodes, not raw textures.

**Blending the detail normal onto the base must be reoriented, not added**; a naive `+` flattens both. r185 has no helper (`NormalMapNode.js` exports only `normalMap( node, scaleNode )`; there is no `blendNormal` anywhere in `src/` or `examples/jsm/`), so write reoriented normal mapping once as a TSL `Fn` and reuse it. Barré-Brisebois and Hill's formula (https://blog.selfshadow.com/publications/blending-in-detail/), on packed 0..1 samples so the result feeds `normalMap()` directly:

```js
const blendRNM = Fn( ( [ basePacked, detailPacked ] ) => {
    const t = basePacked.mul( vec3( 2, 2, 2 ) ).add( vec3( -1, -1,  0 ) );
    const u = detailPacked.mul( vec3( -2, -2, 2 ) ).add( vec3(  1,  1, -1 ) );
    return t.mul( dot( t, u ) ).sub( u.mul( t.z ) ).normalize().mul( 0.5 ).add( 0.5 );
} );
material.normalNode = normalMap( blendRNM( texture( baseNormal ).xyz, texture( detailNormal, uv().mul( 14 ) ).xyz ) );
```

Whiteout blending (`normalize( vec3( n1.xy.add( n2.xy ), n1.z.mul( n2.z ) ) )` on unpacked normals) is the cheaper option when the `dot` and `normalize` are too much. `bumpMap( texture( bumpTex ), float( 5 ) )` (`webgpu_materials_envmaps_bpcem.html` L118) is the cheapest way to add grime relief from a single-channel height map with no second tangent-space normal at all.

### Wet surfaces

Lagarde's model is the one to follow (https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/): albedo darkens and saturates because water fills the pores and subsurface scattering rises, roughness drops sharply as water fills the micro-relief, normal detail flattens toward the vertex normal, and the specular layer's IOR moves to 1.33. His own recommendation is to lerp BRDF parameters rather than add a second lighting layer, with the darkening driven by a porosity map:

```js
const darken = mix( float( 1 ), float( 0.2 ), porosity );
material.colorNode     = baseAlbedo.mul( mix( float( 1 ), darken, wet ) );
material.roughnessNode = mix( baseRoughness, float( 0.04 ), wet );   // getRoughness() re-floors at 0.0525
material.normalNode    = normalMap( mix( detailPacked, vec3( 0.5, 0.5, 1.0 ), wet ) );
material.iorNode       = mix( float( 1.5 ), float( 1.33 ), wet );
```

Skip the darkening entirely for metals and non-porous surfaces; Lagarde is explicit about that.

**Do not reach for clearcoat.** `MeshPhysicalNodeMaterial`'s feature flags are shader permutations, not runtime branches: `get useClearcoat() { return this.clearcoat > 0 || this.clearcoatNode !== null; }` feeds `new PhysicalLightingModel( useClearcoat, useSheen, useIridescence, useAnisotropy, useTransmission, useDispersion )`, so turning clearcoat on compiles a different and more expensive shader for every material carrying it. For a wet street the roughness drop above gives the look; clearcoat is for the two-lobe car-paint case.

**The puddle mask is also the SSR budget.** Water pools where the surface is up-facing and low, so `normalWorld.y.smoothstep( 0.8, 1.0 )` times a low-frequency noise times a baked cavity term is the mask. Lowering roughness for wetness makes SSR matter more (the ray converges and the result is visible) while making it cheaper (less blur-mip work), so driving SSR intensity from the same mask gets the look and the budget from one parameter. Feed `environmentNode` with a neon-tinted equirect so rays that leave the screen read as haze rather than as a hole.

---

## 7. WebGPU TSL versus the WebGL fallback

`RenderPipeline` documents itself as WebGPU-only ("Note: This module can only be used with `WebGPURenderer`", `src/renderers/common/RenderPipeline.js`). In practice `WebGPURenderer` with the WebGL2 backend is still `WebGPURenderer`, and `RESEARCH.md` section 6 established that `WebGLBackend` implements `compute()` on transform feedback, so TSL materials and ordinary compute passes both run. What it lacks is indirect draws and dispatch (warns and falls back), atomics, and TSL `struct`.

The honest position for this chapter: **the fallback tier is a different look, not a degraded version of the same look.** Trying to reach parity is how a second pipeline gets written by accident.

The gap is much smaller than expected, and it is one item.

**Every file in `examples/jsm/tsl/display/` is fragment-only.** A grep of all 46 for `.compute(`, `textureStore`, `storageTexture`, `atomic`, `workgroup`, `storage(` and `subgroup` returns zero hits. Bloom, GTAO, SSR, SSGI, TRAA, TAAU, FSR1, godrays, DOF, the blurs and the denoisers are all capable on the WebGL2 backend; what excludes them there is cost, not capability. The only compute user under `examples/jsm/tsl/` is `lighting/ClusteredLightsNode.js`.

**MRT works on the WebGL2 backend.** `WebGLBackend.js` binds `COLOR_ATTACHMENT0 + i` per texture (L2233-2260), calls `state.drawBuffers` (L2473) and `state.setMRTBlending` (L1089), and resolves MSAA attachment by attachment. So selective bloom's emissive channel and GTAO's normal buffer are not WebGPU-only tricks.

**A file that will mislead you.** `examples/jsm/tsl/WebGLNodesHandler.js` carries a comment block listing "MRT not supported", "Transmission not supported", "Storage textures not supported", "WebGPU postprocessing stack not supported". Its own header says it is a compatibility loader for **`WebGLRenderer`**, the legacy renderer, and it is used only by the four `webgl_tsl_*` examples. Those limitations do not describe `WebGPURenderer`'s WebGL2 backend. Do not plan against that list.

**The real gap is `ClusteredLighting`.** `WebGLBackend.compute()` (L905-950) implements compute as transform feedback: `gl.drawArrays( gl.POINTS, 0, count )` inside `beginTransformFeedback`, capturing varyings, which gives one sequential output per invocation and **no scatter writes**. `ClusteredLightsNode`'s binning kernel does exactly a conditional scatter (`getClusterSlot( index ).assign( lightIdx.add( 1 ) ); index.addAssign( 1 );`), which transform feedback cannot express. Its example hard-gates on `WebGPU.isAvailable()` and throws, so whether it errors or produces garbage on WebGL2 is untested.

**The rest of the WebGL2 audit, with the failure modes**, because a silent wrong answer costs more than a crash:

| capability | WebGL2 backend | failure mode |
|---|---|---|
| MRT, MSAA render targets, TSL `struct` | supported | n/a |
| compute | emulated on transform feedback | one output per invocation, no scatter |
| storage buffers (read) | emulated as a `DataTexture` PBO | read-only |
| storage textures, atomics | absent | GLSL compile error, surfaced as a shader error |
| workgroup barriers | **silent no-op** (`BarrierNode.js` L40 emits a comment) | **no warning, wrong results** |
| subgroups | hard error with a named message | loud, fine |
| indirect draw | absent | **silent**, the draw just happens non-indirect |
| indirect dispatch | absent | warns, then uses the wrong count |
| timestamp queries | needs `EXT_disjoint_timer_query_webgl2` | warns, profiling disabled |
| float texture filtering / anisotropy | needs `OES_texture_float_linear` | **silently skipped** for `FloatType` |
| reversed depth | needs `EXT_clip_control` | warns, falls back |

Nothing in the lighting pipeline touches barriers, atomics or storage textures, so the dangerous rows are not ones we are standing on. They matter for the GPU culling work in `RESEARCH.md` section 6, and the barrier row deserves a note there.

**The switch is one line**, because both lighting systems subclass the same `Lighting` base with the same `createNode( lights )`:

```js
await renderer.init();
const gpu = renderer.backend.isWebGPUBackend === true;   // read AFTER init; the fallback swaps inside it
renderer.lighting = gpu
    ? new ClusteredLighting( 1024, 32, 24, 64 )
    : new DynamicLighting( { maxPointLights: 48, maxSpotLights: 24, maxDirectionalLights: 4 } );
```

`DynamicLighting` is the right fallback for a night city precisely because its cache key ignores light count, so streaming tiles in and out does not recompile the scene. It skips batching for shadow casters and for spot lights with a `map` or a `colorNode`, which is the same hero-versus-fill split section 4 already asks for.

| feature | fallback policy |
|---|---|
| AgX tone mapping + exposure | identical |
| Physical light units, Kelvin colour | identical |
| Fog, height fog, tinted fog | identical |
| Environment probe / PMREM / BPCEM | identical |
| Selective bloom via MRT | identical |
| `ClusteredLighting` | swapped for `DynamicLighting`; the one real capability gap |
| GTAO, TRAA/TAAU, SSR, volumetrics, godrays | capable, but dropped at `low` for cost |
| SSGI | never on the fallback |

The structural rule that keeps this from becoming two pipelines: **one builder function that takes a quality descriptor and returns an `outputNode`**, with each effect a conditional link in a node chain. Backend detection sets the default descriptor once after `renderer.init()` and never again; everything downstream reads the descriptor, not the backend. That is the same adapter-behind-a-contract rule `RESEARCH.md` section 7 applied to the shell. Set `renderPipeline.needsUpdate = true` whenever `outputNode` changes at runtime.

And **tune the scalars before dropping an effect.** `volumetricPass.setResolutionScale`, `volumeMaterial.steps`, `godraysPass.raymarchSteps`, `ssrPass.quality` and every `resolutionScale` are continuous. A quarter-resolution volumetric pass at 12 steps still reads as a light cone; no volumetric pass reads as nothing.

One stability signal worth carrying: `test/e2e/puppeteer.js` lists `webgpu_postprocessing_ao`, `_dof`, `_ssgi`, `_ssgi_ballpool`, `_sss`, `_traa` and `webgpu_volume_lighting_traa` under a "Black screen" exception list, and the runner launches Chrome with `--enable-unsafe-webgpu`. That is a WebGPU-path CI issue in r185, not a fallback one, and it is a reason to verify each of those effects on our own hardware rather than assume.

---

## 8. Staged plan

GPU costs are budget targets at 1080p, to be measured with `{ trackTimestamp: true }` and `await renderer.resolveTimestampsAsync('render')`, in the same spirit as the draw-call budget in `RESEARCH.md` section 1. They are targets to validate on the user's hardware, not literature values.

### Stage 1: the free and near-free wins

Everything here is a configuration change or a data mapping. Together they close most of the gap to the references and cost close to nothing.

| item | cost target | why it is first |
|---|---|---|
| `AgXToneMapping`, exposure dropped to the 0.05-0.2 region and tuned by section 9 | 0 | the single largest visual change in the document |
| `light.power = fixture.intensity` (lumens) for every fixture, `decay = 2`, `distance = range` | 0 | makes relative brightness correct city-wide, collapsing the tuning surface to one exposure |
| Kelvin to RGB for `colorTemperatureK` | 0 | warm against cold is what makes the references legible in the dark |
| Analytic per-room fill, `E = (Φ/A)·ρ/(1−ρ)`, on a `HemisphereLight` | ~5 ALU per fragment | the bounce gradient up the room reference's wall, computed rather than dialled |
| Remove every flat ambient fill; the shadow floor becomes fog plus the probe | 0 | a flat wash is the most recognisable artificial-lighting tell |
| `exponentialHeightFogFactor`, fog colour biased toward the frame's own light via `output` | ~0.1 ms | the coloured shadow floor and the aerial perspective |
| `material.lightsNode = lights([...])` per room | negative; it removes work | 3-6 lights per interior material instead of the city's thousand, and it stops one new fixture recompiling the whole scene |
| `renderer.lighting = ClusteredLighting()` on WebGPU / `DynamicLighting()` on WebGL2; retire the 14-light pool | one compute dispatch over the cluster grid, ~0.3-0.6 ms | every exterior fixture becomes a real light |
| Selective bloom off the emissive MRT channel, small radius | ~0.5-1.0 ms | the bar reference's glowing tubes, without smearing the walls |
| IES profile per published fixture kind | one `acos` + one 180x1 fetch | stops every downlight casting the same perfect ellipse |
| `Lut3DNode` grade + `bayer16` dither | ~0.1 ms | recovers AgX's lifted black; kills banding in the soft falloffs |

**Stage 1 budget: about 1.5 ms.** Quality tier: on at every tier including `low`.

### Stage 2: the shaping pass

| item | cost target | notes |
|---|---|---|
| Velocity as an MRT channel on the scene pass; a normal prepass only if depth-reconstructed normals fail | prepass is geometry-bound, roughly a depth-only pass | `GTAONode` reconstructs normals from depth when `normalNode` is null, so try without the prepass first |
| GTAO at `resolutionScale = 0.5`, `useTemporalFiltering = true`, wired through `builtinAOContext` | ~1.0-1.5 ms | contact darkening; the user's "grounded contact shadows" |
| TRAA off the velocity attachment | ~0.4 ms | the only thing that stops sub-pixel neon and wet speculars crawling, and GTAO's denoiser |
| `CSMShadowNode` moon cascade + 4-8 ranked dynamic shadow casters, static maps cached per light with `shadow.autoUpdate = false` | 1-3 ms depending on caster count | the caster count is a draw-call budget, not a lighting one |
| SH9 `LightProbe` per room, `LightProbeGenerator.fromCubeRenderTarget` at cube size 16 | ~7 frames per room at load; 9 vec3 MADs at runtime | rooms whose bounce is directional, where the analytic hemisphere is not enough |
| Box-projected room cubemap (`getParallaxCorrectNormal` + `pmremTexture`, `fromScene` with `options.position`) | one low-res cube render per room | interior reflections, and the standing glass-reflection item |
| `RectAreaLight` for hero `strip` and `cove` fixtures, with `RectAreaLightNode.setLTC(...)` | 3-6x a point light, no distance cutoff, never clustered | line highlights, which is what the bar reference's fixtures make. Hero set only; the rest are emissive geometry plus a clustered point light |
| Wet-road SSR at half resolution, puddle-masked, `reflectNonMetals: true` | ~1.5-2.5 ms | the street reference's whole subject. Without `reflectNonMetals` it silently does nothing on asphalt |

**Stage 2 budget: about 5-8 ms on top of stage 1.** Quality tiers: GTAO, TRAA and shadows at `medium` and up; probes, BPCEM and SSR at `high` and up.

**The headroom lever, if stage 2 does not fit.** Swap `traa` for `taau` and set `scenePass.setResolutionScale( 0.5 )`. The scene, its lighting, GTAO and SSR then all run at quarter the fragment count and resolve to full resolution with temporal accumulation, paired with `sharpen( ..., 0.5 )`. That is roughly a 3x saving on everything fragment-bound for one visible cost (some ghosting on fast motion), and it is a better trade than cutting an effect. Try it before dropping GTAO or SSR to a lower tier.

### Stage 3: the luxuries

| item | cost target | notes |
|---|---|---|
| Volumetric lighting, `setResolutionScale( 0.25 )`, `steps = 12`, `bayer16` dither + `gaussianBlur`, volume boxes scoped per room and per lamp cluster, lights opted in by layer | 2-4 ms depending on screen coverage | the bar reference's wide wash. Point, spot and **rect area** lights scatter; directional does not |
| Distance blur in the fog composite (`webgpu_custom_fog_scattering` idiom) | ~0.5 ms | aerial perspective's second half; cheap for what it gives |
| Godrays on one directional backlight, `depthAwareBlend` composite | ~1-2 ms at `resolutionScale 0.5` | the Blade Runner shaft. Point and directional only, so never for street lamps |
| SSGI + TRAA, replacing GTAO | 32 spp plus TAA, unproven | bounce from emissive neon, which no probe can give |
| Dialogue-camera DOF | ~1 ms, only in dialogue | composition, not simulation |

**Stage 3 budget: 3-12 ms.** Quality tiers: volumetrics and fog blur at `high`; SSGI at `ultra` only.

### Quality tiers

| tier | stage 1 | GTAO / TRAA / shadows | probes / BPCEM / SSR | volumetrics | SSGI |
|---|---|---|---|---|---|
| low (and WebGL fallback) | yes, with `DynamicLighting` in place of clustered | SMAA only | analytic room fill only | denser fog + depth-faded cone billboards | no |
| medium | yes | yes, GTAO at 0.5 | probes only | no | no |
| high | yes | yes | yes | yes | no |
| ultra | yes | yes | yes | yes | yes (replacing GTAO) |

The `low` tier is not a broken version of `high`. It has correct exposure, correct light units, computed room fill, correct fog colour and selective bloom, which is most of what the reference images are made of. That is the point of the ordering.

**Before dropping a tier, turn the scalars down.** `volumetricPass.setResolutionScale`, `volumeMaterial.steps`, `ssrPass.quality`, `ssrPass.resolutionScale`, `aoPass.resolutionScale`, `godraysPass.raymarchSteps` and `ssgi.stepCount` are all continuous. A quarter-resolution volumetric pass at 8 steps still reads as a light cone; no volumetric pass reads as nothing.

---

## 9. Tuning protocol against the references

Side-by-side eyeballing drifts. The measurements in section 0 give acceptance numbers, and they should be checked mechanically.

**Set up matched shots.** Four saved camera poses in the game that correspond to the four references: an empty service corridor with one warm fixture (the room), a lit venue interior with strip and cove fixtures (the bar), a wet neon street at ground level (the street), a high vantage looking down a canyon (Blade Runner). Save them as named debug camera bookmarks so any change can be re-shot in seconds.

**Capture and measure.** A small script reads back the rendered frame and prints the same statistics: median linear luminance, fraction of the frame below 0.01 linear, fraction above 0.5, mean sRGB of the darkest 20% and the brightest 2%, and saturation at Y>0.5 and Y>0.8. Run it on every tuning change.

**Acceptance bands**, from the references:

| statistic | interior shots | exterior shots |
|---|---|---|
| median linear luminance | 0.005-0.021 | 0.011-0.022 |
| frame below 0.01 linear | 20-68% | 16-48% |
| frame above 0.5 linear | under 1.5% | under 1% |
| darkest 20% mean sRGB, per channel | 4-30, never 0 across all three | 8-27, never 0 across all three |
| saturation at Y>0.5 | 0.27-0.71 | 0.05-0.73 |

Landing inside these bands means the exposure and the fog floor are right. Landing outside means one of two things: too bright (median above 0.03) is an exposure problem, and a flat dark frame with no separation (darkest-20% channels all equal) is a fog-colour or probe problem.

**Order of tuning, one variable at a time:**

1. Exposure alone, with fog at zero and no bloom, until the median linear luminance lands in band. Nothing else until this is right, because everything else is judged against it.
2. Fog density and colour, until the darkest-20% mean lands in band and reads as a colour rather than as grey.
3. Bloom strength and radius, judged against the measured glow profile: a street lamp's halo should fall below 10% of peak within about three times the source's own radius, and it must not reach a fifth of the frame width.
4. GTAO radius and scale, judged on one thing only: the seam where an object meets the floor, at the width the reference shows (a few centimetres, not a soft halo up the object's side).
5. Probe intensity, judged on the vertical gradient up a wall next to a lit floor. Too strong and it becomes an ambient wash; too weak and the wall goes flat black.
6. Volumetrics last, and sparingly. The bar reference's wash is wide and weak. If a fixture's cone is a visible hard shape, it is too strong.

**Per-reference checklists**, phenomena to confirm present rather than numbers:

- *Room*: warm elliptical pool with a soft edge; a vertical bounce gradient up the wall behind it; a dark contact seam at every object base with a brighter bounce band just outside it; albedo detail legible in the near-black; streak specular highlights on a black plastic prop; grazing light picking out only the edges of a metal grille; roughness varying visibly across one floor.
- *Bar*: visible haze cone around every fixture; contrast falling with depth across the room; two light colours meeting on one flat surface with a hue gradient between them; line-shaped highlights, not round ones; figures as silhouettes with a rim on the lit side.
- *Street*: neon reflected as long vertical smears down the road, sharper in puddles; the far end of the street brighter than the near; fog tinted the colour of the neon; small tight lamp halos; the walking figure a pure silhouette.
- *Blade Runner*: distant buildings clearly lifted and softened relative to near ones; visible shafts from a strong backlight through haze; sub-pixel window lights that sparkle without crawling in motion; warm sources reading against cold haze.

---

## What we write ourselves, because nothing ships it

Kelvin-to-sRGB conversion for `colorTemperatureK`; the per-room fill-light derivation from the published fixture list and material albedos; the room-to-`lightsNode` partitioning and its doorway cross-fade; the shadow-slot ranker (a retarget of `LightBudget`); the puddle mask and its coupling to SSR intensity; reoriented normal blending as a TSL `Fn`; the depth-faded light-cone material for the fallback tier; normal-map variance baked into roughness mips (materials box); and, if the WebGPU `LightProbeGrid` does not land in time, the port of the WebGL irradiance volume to the node path.

---

## Sources

r185 source tree, read 2026-09-01 via `raw.githubusercontent.com/mrdoob/three.js/r185/`:
`src/constants.js`, `src/scenes/Scene.js`, `src/math/Color.js`, `src/Three.Legacy.js` (zero bytes), `src/nodes/display/ToneMappingFunctions.js`, `src/nodes/core/{MRTNode,PropertyNode,ContextNode}.js`, `src/nodes/lighting/{ShadowFilterNode,ShadowNode}.js`, `src/nodes/functions/material/{getRoughness,getGeometryRoughness}.js`, `src/materials/nodes/{MeshStandardNodeMaterial,NodeMaterials}.js`, `src/renderers/common/{RenderPipeline,PostProcessing,Renderer}.js`, `src/renderers/webgl-fallback/WebGLBackend.js`, `src/renderers/webgpu/WebGPUBackend.js`, `src/lights/{PointLight,SpotLight,RectAreaLight,LightShadow}.js`, `examples/jsm/lighting/ClusteredLighting.js`, `examples/jsm/tsl/lighting/{ClusteredLightsNode,DynamicLightsNode}.js`, `examples/jsm/lights/{LightProbeGenerator,RectAreaLightTexturesLib}.js`, `examples/jsm/tsl/display/{BloomNode,GTAONode,SSRNode,SSGINode,GodraysNode,TRAANode,TAAUNode,FSR1Node,DenoiseNode,RecurrentDenoiseNode,Lut3DNode,GaussianBlurNode,MotionBlur}.js`, `examples/jsm/tsl/math/Bayer.js`, `examples/jsm/csm/CSMShadowNode.js`, `examples/jsm/tsl/shadows/TileShadowNode.js`, `examples/files.json`.

Also read: `src/nodes/functions/VolumetricLightingModel.js`, `src/materials/nodes/{VolumeNodeMaterial,MeshPhysicalNodeMaterial}.js`, `src/nodes/fog/Fog.js`, `src/nodes/display/{NormalMapNode,ViewportDepthNode}.js`, `src/nodes/utils/TriplanarTextures.js`, `src/nodes/gpgpu/BarrierNode.js`, `src/nodes/accessors/MaterialProperties.js`, `src/renderers/common/extras/PMREMGenerator.js`, `src/renderers/webgl-fallback/{WebGLBackend,nodes/GLSLNodeBuilder,WebGLTextureUtils}.js`, `src/lights/webgpu/{IESSpotLight,ProjectorLight}.js`, `src/nodes/lighting/{LightProbeNode,IESSpotLightNode,SpotLightNode,IrradianceNode}.js`, `src/renderers/webgpu/nodes/StandardNodeLibrary.js`, `examples/jsm/lighting/{DynamicLighting,LightProbeGrid}.js`, `examples/jsm/loaders/IESLoader.js`, `examples/jsm/tsl/display/{depthAwareBlend,radialBlur,ImportanceSampledEnvironment}.js`, `test/e2e/puppeteer.js`.

r185 examples: `webgpu_postprocessing_ao`, `webgpu_postprocessing_bloom_emissive`, `webgpu_postprocessing_bloom_selective`, `webgpu_postprocessing_ssr`, `webgpu_postprocessing_ssgi`, `webgpu_postprocessing_godrays`, `webgpu_lights_clustered`, `webgpu_lights_rectarealight`, `webgpu_lights_ies_spotlight`, `webgpu_lightprobe_cubecamera`, `webgpu_materials_envmaps_bpcem`, `webgpu_materials_lightmap`, `webgpu_volume_lighting`, `webgpu_volume_lighting_rectarea`, `webgpu_volume_lighting_traa`, `webgpu_fog_height`, `webgpu_custom_fog_scattering`, `webgpu_shadow_contact`, `webgpu_shadowmap_csm`, `webgpu_tonemapping`.

`useLegacyLights` removal: PR https://github.com/mrdoob/three.js/pull/28482, r165 release notes. `ClusteredLighting` is PR #33406. The r185-to-r186 migration guide records the `LightProbeGrid` to `LightProbeGridWebGL` rename. Note the r185 docs live at `threejs.org/docs/pages/<Class>.html`; the old `docs/api/en/**` paths 404 from r181.

Technique references outside three.js:
- Reoriented normal mapping: https://blog.selfshadow.com/publications/blending-in-detail/ (Barré-Brisebois and Hill, 2012)
- Normal-map roughness filtering: http://graphicrants.blogspot.com/2018/05/normal-map-filtering-using-vmf-part-3.html, https://blog.selfshadow.com/2011/07/22/specular-showdown/
- Physically based wet surfaces: https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/
- Clustered shading measurements on a non-three.js engine: https://discourse.threejs.org/t/clustered-rendering-on-webgpu/81042
- Khronos PBR Neutral: https://modelviewer.dev/examples/tone-mapping (cited in the r185 source)

Sibling contracts: `../interior/CONTRACT.md` (per-floor `lights` array: kind, position, length, angleDeg, lumens, colorTemperatureK, range, beamDeg, diffuse, facing), `../materials/CONTRACT.md` (finish bands, roughness ranges per kind and tier, grain and relief ramps, metallic-roughness workflow, OpenGL +Y normals, transmission for glass).

Reference images, measured directly: `../../docs/expected/Screenshot From 2026-08-27 16-18-56.png`, `expectedinteriors.webp`, `expectedoutside.webp`, `blade-runner-noir-asian-japanese-cyberpunk-hd-wallpaper-7876fd6830002c28601cf14ef8a2249a.jpg`.
