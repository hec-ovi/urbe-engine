# CONTRACT: building

Purpose: previews assembled buildings and resolves their authored material keys into shared Three.js PBR surfaces.

## Inputs and outputs

- `MaterialResolver(baseUrl = '/materials').loadTheme(theme)` loads a [theme index](../../../materials/schema/theme-index.schema.json). `resolve(key)` returns its [MaterialEntry](../../../materials/schema/material-entry.schema.json), including aliases, or `null`. `mapUrl(theme, path)` returns the served map URL. `counts` and `report()` expose resolved and unresolved keys.
- `MaterialResolver.loadBindings(name)` loads one Materials-owned binding document. `missionCatalog(theme)` returns the material catalog consumed by [mission assets](../mission-assets/CONTRACT.md).
- `PbrMaterialFactory(resolver, profile = {})` consumes that resolver and [PBR profile settings](pbr-profile.schema.json) from [game look](../game/look/CONTRACT.md). Optional `textureMaxSize` caps the longest image edge in pixels; omission keeps source resolution. `build(key, variantId?)` returns a cached `MeshStandardMaterial`, or `MeshPhysicalMaterial` for transmission. An omitted or unknown variant selects the canonical variant.
- `variant(key, {variantId?, emissiveScale?, emissiveLevel?, emissive?: THREE.Color, side?})` returns a cached tuned clone. `emissiveLevel` overrides catalog strength; otherwise `emissiveScale` multiplies it. Callers keep cached materials unchanged.
- `tint(key)` returns a promise for the basecolor's mean linear `THREE.Color`, or neutral white when unavailable. Every loaded map exposes `Symbol.for('urbe.texture-ready')`, a promise resolving after its load attempt and scalar fallback handling.
- `materialForViewerSurface(factory, source, parcel)` resolves a GLB material by name, preserves `userData.materialVariant` and double-sidedness, and otherwise selects the parcel's deterministic variant. [Exterior](../../../exterior/CONTRACT.md) and [Interior](../../../interior/CONTRACT.md) publish the source material metadata.
- `BuildingViewerApp.configFromUrl()` reads `mode=building`, `parcel`, `out`, `source=shell|interior` and `backend=webgpu|webgl`. `start()` loads the selected scene through `BuildingAssets`, shows its floor controls and first-person inspection camera, and reports loading, ready, unavailable or failed state.
- `BuildingAssets(parcel, out='/out')` ensures a build through [the development boundary](../server/CONTRACT.md), loads the blueprint and selected GLB, and checks response MIME before decoding. Build requests and results use [building-build-request](../server/schema/building-build-request.schema.json) and [building-build-result](../server/schema/building-build-result.schema.json).

## Invariants

- Basecolor and emission are sRGB; normal, roughness, metallic and AO are linear. Maps share UV channel 0 and `flipY=false`. Three.js samples roughness from green and metallic from blue; Materials publishes grayscale RGB maps for these quantities.
- Enabled maps fit the texture budget before readiness and GPU upload. Downsampling preserves aspect ratio to whole pixels, alpha, authored image content and texture identity. Smaller images retain their source size. Budgeting leaves metre tiling, UV alignment, channels and tuned material sharing unchanged; textures retain normal Three.js disposal ownership.
- Roughness and metallic pixels carry absolute surface values. A bound map uses a scalar multiplier of 1. A disabled or failed map uses the catalog scalar instead, including tuned clones.
- Tiled geometry supplies world-metre UVs; repeats are the inverse catalog tile size. Exact surfaces clamp their 0..1 UVs. Geometry owns alignment and boundaries.
- Fitted decals use basecolor alpha once, retain depth testing and disable depth writes. Transmissive surfaces use the catalog transmission, IOR and tint.
- Viewer material replacement preserves authored interior variants and two-sided surfaces; it does not multiply their embedded scalar factors into catalog maps.

## Errors

- An unresolved key produces a named magenta material and appears in the resolver report. Texture-load or resizing failures detach the failed map and settle readiness; scalar-map failures use the catalog factors, including tuned copies. Theme, binding and JSON fetch failures propagate ordinary errors.
- `E_PBR_TEXTURE_BUDGET`: `textureMaxSize` is supplied without a positive integer pixel dimension.
- Asset errors are `E_BUILD_RESPONSE`, `E_BLUEPRINT_UNAVAILABLE`, `E_BLUEPRINT_INVALID`, `E_SOURCE_UNAVAILABLE`, `E_SOURCE_RESPONSE`, `E_SOURCE_LOAD`, or the development boundary's [build errors](../server/schema/building-build-error.schema.json). The viewer exposes retry and exterior recovery.

## Dependencies

Materials, Exterior, Interior and the linked Engine build, mission-asset and look contracts; Three.js materials, texture loader and GLTFLoader; game city variant selection; the [building UI](../ui/CONTRACT.md).
