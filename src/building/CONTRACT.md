# CONTRACT: building

Purpose: previews assembled buildings and resolves their authored material keys into shared Three.js PBR surfaces.

## Paired previews

`POST /api/building` additionally accepts `request`, an Exterior BuildingRequest whose
`buildingId` equals `parcel`. It calls the existing Exterior and Interior library APIs
in a worker process, writing the exact shell, blueprint, original request, and
`interior/building.json` with the producer's layout tables. Every standalone request
creates a pair; a partial or ground-only interior is an explicit build failure.
Reusing an id with a different request is rejected. `preview.json` version 2 binds the
original request, shell and blueprint hashes, shared room/furniture catalogs, and
separate Exterior/Interior source revisions. Revisions hash producer sources, schemas,
package manifests/locks, material catalogs and the relevant Engine adapters; Exterior
also includes its compiled Interior core-feasibility dependency. Unchanged files use
cached hashes, so repeat calls check freshness without regenerating the pair. An
Interior-only edit or missing layout, NPC file, shared catalog or model rebuilds the
interior while retaining the exact shell. An Exterior edit, missing shell/blueprint or
legacy metadata without source revisions regenerates both producers. Existing env
overrides for Interior, modules, props and Materials are included in revision identity.

The worker stages the whole pair and checks every above-ground floor and referenced
asset before promoting it. Producer/resource failures leave the previous published
pair intact; directory replacement rolls back if promotion fails. An edit while a
build is running rejects that build rather than marking mixed sources current. Shared
room/furniture identities include model bytes as well as catalogs, so a material or
geometry edit with an unchanged catalog receives a fresh URL. Missing shared files
are repaired from the producer output before the pair is published.

`?mode=building&parcel=<id>&out=/out/previews&source=interior&view=walk` opens the pair
in first person. The viewer consumes placement tables through the game's
InteriorModules, InteriorProps and InteriorStream. BuildingsLoader keeps exterior
door motion and cuts the shell slabs around the interior's actual floors and wells.
Physics, PlayerBody, Input, PlayerController, Interactor and Elevators are shared with
the game. WASD walks, Shift runs, Space jumps, C crouches, E opens doors or operates
lifts, and Escape releases the pointer. Click the viewport to capture it. `Walk from`
selects the main entrance, any published floor, or Roof when the crown publishes
a connected roof exit; floor geometry and collision are
ready before teleporting. Inspection mode retains the free camera and floor slicing.
Legacy combined interior GLBs remain readable.

The Brightness slider changes exposure immediately from 0.5× to 32× in both
inspection and walk modes. Bright inspection selects 8×; Reset light restores
the authored 1× night exposure. The `brightness` URL parameter preserves the
selection across reloads and source changes; omitted or invalid values use 1×.
Press Escape to release the camera and reach the controls. Lighting controls
change the preview frame without rebuilding its assets.

## Inputs and outputs

- `MaterialResolver(baseUrl = '/materials').loadTheme(theme)` loads a [theme index](../../../materials/schema/theme-index.schema.json). `resolve(key)` returns its [MaterialEntry](../../../materials/schema/material-entry.schema.json), including aliases, or `null`. `mapUrl(theme, path)` returns the served map URL. `counts` and `report()` expose resolved keys, unresolved keys and the `key#variant` names the catalog does not publish. `variantOf(entry, key, variantId)` returns the named variant, or the canonical one while recording the name that missed.
- `MaterialResolver.loadBindings(name)` loads one Materials-owned binding document. `missionCatalog(theme)` returns the material catalog consumed by [mission assets](../mission-assets/CONTRACT.md).
- `PbrMaterialFactory(resolver, profile = {})` consumes that resolver and [PBR profile settings](pbr-profile.schema.json) from [game look](../game/look/CONTRACT.md). Optional `textureMaxSize` caps the longest image edge in pixels; omission keeps source resolution. `build(key, variantId?)` returns a cached `MeshStandardMaterial`, or `MeshPhysicalMaterial` for transmission. An omitted variant selects the canonical one; an unknown name selects it too and joins the resolver report.
- `variant(key, {variantId?, emissiveScale?, emissiveLevel?, emissive?: THREE.Color, side?})` returns a cached tuned clone. `emissiveLevel` overrides catalog strength; otherwise `emissiveScale` multiplies it. Callers keep cached materials unchanged.
- `tint(key)` returns a promise for the basecolor's mean linear `THREE.Color`, or neutral white when unavailable. Every loaded map exposes `Symbol.for('urbe.texture-ready')`, a promise resolving after its load attempt and scalar fallback handling.
- `materialForViewerSurface(factory, source, {parcel, blueprint})` resolves a GLB material by name through the city's own [shell surface rules](../game/city/CONTRACT.md): the authored `userData.materialVariant`, else the building's published variant, else the parcel's seeded pattern, with double-sidedness and the lit-diffuser level preserved. [Exterior](../../../exterior/CONTRACT.md) and [Interior](../../../interior/CONTRACT.md) publish the source material metadata.
- `BuildingViewerApp.configFromUrl()` reads `parcel`, `out`, `source=shell|interior`, `backend=webgpu|webgl`, `view=inspect|walk` and `quality=low|medium|high|ultra` (unset follows the backend, as a played run does). The host URL carries `mode=building`. `start()` loads the selected scene through `BuildingAssets`, shows its floor controls and first-person inspection camera, and reports state. Every stage names itself while it runs (requesting the build, reading the world, starting the renderer, resolving materials, reading the model, lighting the street, preparing surfaces, baking reflections), counts its progress where it has a count, and says how long it has been running past a second and a half. Surface preparation runs against a 15 second budget: past it the preview draws anyway and its ready line carries how many surfaces were prepared, the rest compiling as they first draw.
- `FloorSlicer(floors).attach(material)` and `.apply(value)` cut the model at one floor's ceiling through a material mask, so a blended decal, a masked cutout and a transmissive pane keep the alpha behaviour the catalog authored.
- `BuildingAssets(parcel, out='/out')` ensures a build through [the development boundary](../server/CONTRACT.md), loads the blueprint and shell GLB plus paired Interior placement tables, and checks response MIME before decoding. `loadWorld()` returns the Atlas blueprint and walk graph of a built city, or `null` for a single building folder. Build requests and results use [building-build-request](../server/schema/building-build-request.schema.json) and [building-build-result](../server/schema/building-build-result.schema.json).

## Invariants

- Maps prefer the catalog's compressed sibling where the run can transcode it and fall back to the PNG master otherwise, keeping one texture identity either way. Basecolor and emission are sRGB; normal, roughness, metallic and AO are linear. Maps share UV channel 0 and `flipY=false`. Three.js samples roughness from green and metallic from blue; Materials publishes grayscale RGB maps for these quantities.
- Enabled maps fit the texture budget before readiness and GPU upload. Downsampling preserves aspect ratio to whole pixels, alpha, authored image content and texture identity. Smaller images retain their source size. Budgeting leaves metre tiling, UV alignment, channels and tuned material sharing unchanged; textures retain normal Three.js disposal ownership.
- Roughness and metallic pixels carry absolute surface values. A bound map uses a scalar multiplier of 1. A disabled or failed map uses the catalog scalar instead, including tuned clones.
- Tiled geometry supplies world-metre UVs; repeats are the inverse catalog tile size. Exact surfaces clamp their 0..1 UVs. Geometry owns alignment and boundaries.
- Fitted decals use basecolor alpha once, retain depth testing and disable depth writes. Transmissive surfaces use the catalog transmission, IOR and tint.
- Viewer material replacement preserves authored interior variants and two-sided surfaces; it does not multiply their embedded scalar factors into catalog maps.
- The preview is the game's own frame, so modelling and materials can be judged from it: it installs the shared [night look](../game/look/CONTRACT.md) (AgX at the authored exposure, the sky key in lux, the air, an environment probe baked once from the opening camera, bloom and dither), builds its materials against the resolved quality tier, and lights the building with the fixtures it carries itself plus its world's street lamps, in lumens. Its opening frame stands off the face the entrance looks out of, at a quarter of the building's height, because that is the side the street lights. What the street owns is absent apart from its lamps: no neighbours to reflect and no road surface. Paired interiors use the game’s RoomLights, per-room fill and floor streaming. The staging ground plane and the floor slice are the preview's own.

## Errors

- An unresolved key produces a named magenta material and appears in the resolver report. A compressed map this run cannot decode reloads the PNG master into the same texture; texture-load or resizing failures then detach the failed map and settle readiness, and scalar-map failures use the catalog factors, including tuned copies. Theme, binding and JSON fetch failures propagate ordinary errors.
- `E_PBR_TEXTURE_BUDGET`: `textureMaxSize` is supplied without a positive integer pixel dimension.
- Asset errors are `E_BUILD_RESPONSE`, `E_BLUEPRINT_UNAVAILABLE`, `E_BLUEPRINT_INVALID`, `E_SOURCE_UNAVAILABLE`, `E_SOURCE_RESPONSE`, `E_SOURCE_LOAD`, or the development boundary's [build errors](../server/schema/building-build-error.schema.json). The viewer exposes retry and exterior recovery.

## Dependencies

Materials, Exterior, Interior and the linked Engine build, mission-asset and look contracts; Three.js materials, texture loader and GLTFLoader; the [game city](../game/city/CONTRACT.md) shell surface rules and building fixtures, the [game look](../game/look/CONTRACT.md) night installer, the [game light](../game/light/CONTRACT.md) fixture pool; the [building UI](../ui/CONTRACT.md).
