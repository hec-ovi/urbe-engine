# CONTRACT: building

Purpose: previews assembled buildings and resolves their authored material keys into shared Three.js PBR surfaces.

## Inputs and outputs

- `MaterialResolver(baseUrl = '/materials').loadTheme(theme)` loads a [theme index](../../../materials/schema/theme-index.schema.json). `resolve(key)` returns its [MaterialEntry](../../../materials/schema/material-entry.schema.json), including aliases, or `null`. `mapUrl(theme, path)` returns the served map URL. `counts` and `report()` expose resolved and unresolved keys.
- `MaterialResolver.loadBindings(name)` loads one Materials-owned binding document. `missionCatalog(theme)` returns the material catalog consumed by [mission assets](../mission-assets/CONTRACT.md).
- `PbrMaterialFactory(resolver, profile = {})` consumes that resolver and [PBR profile settings](pbr-profile.schema.json) from [game look](../game/look/CONTRACT.md). Optional `textureMaxSize` caps the longest image edge in pixels; omission keeps source resolution. `build(key, variantId?)` returns a cached `MeshStandardMaterial`, or `MeshPhysicalMaterial` for transmission. An omitted or unknown variant selects the canonical variant.
- `variant(key, {variantId?, emissiveScale?, emissiveLevel?, emissive?: THREE.Color, side?})` returns a cached tuned clone. `emissiveLevel` overrides catalog strength; otherwise `emissiveScale` multiplies it. Callers keep cached materials unchanged.
- `tint(key)` returns a promise for the basecolor's mean linear `THREE.Color`, or neutral white when unavailable. Every loaded map exposes `Symbol.for('urbe.texture-ready')`, a promise resolving after its load attempt and scalar fallback handling.
- `materialForViewerSurface(factory, source, {parcel, blueprint})` resolves a GLB material by name through the city's own [shell surface rules](../game/city/CONTRACT.md): the authored `userData.materialVariant`, else the building's published variant, else the parcel's seeded pattern, with double-sidedness and the lit-diffuser level preserved. [Exterior](../../../exterior/CONTRACT.md) and [Interior](../../../interior/CONTRACT.md) publish the source material metadata.
- `BuildingViewerApp.configFromUrl()` reads `parcel`, `out`, `source=shell|interior`, `backend=webgpu|webgl` and `quality=low|medium|high|ultra` (unset follows the backend, as a played run does). The host URL carries `mode=building`. `start()` loads the selected scene through `BuildingAssets`, shows its floor controls and first-person inspection camera, and reports state. Every stage names itself while it runs (requesting the build, reading the world, starting the renderer, resolving materials, reading the model, lighting the street, preparing surfaces, baking reflections), counts its progress where it has a count, and says how long it has been running past a second and a half. Surface preparation runs against a 15 second budget: past it the preview draws anyway and its ready line carries how many surfaces were prepared, the rest compiling as they first draw.
- `FloorSlicer(floors).attach(material)` and `.apply(value)` cut the model at one floor's ceiling through a material mask, so a blended decal, a masked cutout and a transmissive pane keep the alpha behaviour the catalog authored.
- `BuildingAssets(parcel, out='/out')` ensures a build through [the development boundary](../server/CONTRACT.md), loads the blueprint and selected GLB, and checks response MIME before decoding. `loadWorld()` returns the Atlas blueprint and walk graph of a built city, or `null` for a single building folder. Build requests and results use [building-build-request](../server/schema/building-build-request.schema.json) and [building-build-result](../server/schema/building-build-result.schema.json).

## Invariants

- Basecolor and emission are sRGB; normal, roughness, metallic and AO are linear. Maps share UV channel 0 and `flipY=false`. Three.js samples roughness from green and metallic from blue; Materials publishes grayscale RGB maps for these quantities.
- Enabled maps fit the texture budget before readiness and GPU upload. Downsampling preserves aspect ratio to whole pixels, alpha, authored image content and texture identity. Smaller images retain their source size. Budgeting leaves metre tiling, UV alignment, channels and tuned material sharing unchanged; textures retain normal Three.js disposal ownership.
- Roughness and metallic pixels carry absolute surface values. A bound map uses a scalar multiplier of 1. A disabled or failed map uses the catalog scalar instead, including tuned clones.
- Tiled geometry supplies world-metre UVs; repeats are the inverse catalog tile size. Exact surfaces clamp their 0..1 UVs. Geometry owns alignment and boundaries.
- Fitted decals use basecolor alpha once, retain depth testing and disable depth writes. Transmissive surfaces use the catalog transmission, IOR and tint.
- Viewer material replacement preserves authored interior variants and two-sided surfaces; it does not multiply their embedded scalar factors into catalog maps.
- The preview is the game's own frame, so modelling and materials can be judged from it: it installs the shared [night look](../game/look/CONTRACT.md) (AgX at the authored exposure, the sky key in lux, the air, an environment probe baked once from the opening camera, bloom and dither), builds its materials against the resolved quality tier, and lights the building with the fixtures it carries itself plus its world's street lamps, in lumens. Its opening frame stands off the face the entrance looks out of, at a quarter of the building's height, because that is the side the street lights. What the street owns is absent apart from its lamps: no neighbours to reflect, no road surface, and no room lights for a generated interior. The staging ground plane and the floor slice are the preview's own.

## Errors

- An unresolved key produces a named magenta material and appears in the resolver report. Texture-load or resizing failures detach the failed map and settle readiness; scalar-map failures use the catalog factors, including tuned copies. Theme, binding and JSON fetch failures propagate ordinary errors.
- `E_PBR_TEXTURE_BUDGET`: `textureMaxSize` is supplied without a positive integer pixel dimension.
- Asset errors are `E_BUILD_RESPONSE`, `E_BLUEPRINT_UNAVAILABLE`, `E_BLUEPRINT_INVALID`, `E_SOURCE_UNAVAILABLE`, `E_SOURCE_RESPONSE`, `E_SOURCE_LOAD`, or the development boundary's [build errors](../server/schema/building-build-error.schema.json). The viewer exposes retry and exterior recovery.

## Dependencies

Materials, Exterior, Interior and the linked Engine build, mission-asset and look contracts; Three.js materials, texture loader and GLTFLoader; the [game city](../game/city/CONTRACT.md) shell surface rules and building fixtures, the [game look](../game/look/CONTRACT.md) night installer, the [game light](../game/light/CONTRACT.md) fixture pool; the [building UI](../ui/CONTRACT.md).
