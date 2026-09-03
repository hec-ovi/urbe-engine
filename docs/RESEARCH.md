# Research conclusions (2026 state of the art)

Deep research pass for the engine box. Decisions only; the reasoning that did not change a decision is left out.
Baseline verified against source, not memory: `three@0.185.1` (r185, published 2026-07-01), zero runtime dependencies, exports `three`, `three/webgpu`, `three/tsl`, `three/addons/*`.

Everything below was checked against the r185 source tree or the library's own registry entry on 2026-08-31.

## 0. The pivot that shapes everything: WebGPU is the target

Read this before the rest. Two facts from the r185 source decide most of the architecture.

**BatchedMesh has no multi-draw on the WebGPU path.** `WebGPUBackend.draw()` loops over the batch and issues one `drawIndexed` per visible instance. On the WebGL path with `WEBGL_multi_draw` the same batch is one call. So on WebGPU, `BatchedMesh` costs one draw call per building and buys nothing but memory packing.
- `src/renderers/webgpu/WebGPUBackend.js` L1805-1833 (the per-instance loop), vs `src/renderers/WebGLRenderer.js` L1303-1322.
- Open issue from the r169 era measuring this: https://github.com/mrdoob/three.js/issues/29580 (BatchedMesh example 25fps WebGL vs 13fps WebGPU on a Galaxy S20 FE, Oct 2024, still open, not re-measured since). https://github.com/mrdoob/three.js/issues/31935 tracks multiDraw-instanced, open.

**Indirect draws are real and available, on the non-batched path.** Any ordinary geometry can carry `geometry.setIndirect(new THREE.IndirectStorageBufferAttribute(...))`, and the backend then issues `drawIndexedIndirect` with the count read from GPU memory. A compute pass writes that count. This is the WebGPU-native replacement for multi-draw.
- `WebGPUBackend.js` L1836-1858; official example `webgpu_struct_drawindirect.html`. Its own docstring says it works only with a WebGPU backend, so it has no WebGL2 path.
- Bringing this to `BatchedMesh` is PR https://github.com/mrdoob/three.js/pull/30645, still a draft as of 2026-07-07, and its author reports it currently costing more than plain `drawIndexed` because of per-frame indirect buffer updates.

**WebGPU punishes many small draws harder than WebGL does.** Open issue https://github.com/mrdoob/three.js/issues/30560 ("Current UBO system has severe performance issues with many render items", Feb 2025, still open, last touched 2026-03-10): 20,000 separate cube meshes run ~60fps on WebGL and ~15fps on WebGPU on an M1 Pro, because each object costs its own `setBindGroup` and `writeBuffer`. The maintainers' answer is to instance and batch. Once instanced, the direction reverses: a 100k-instance test roughly halves CPU frame time against WebGL.

The city therefore renders as: one `InstancedMesh` per building archetype, a compute pass that culls, picks an LOD and writes instance counts, and one indirect draw per archetype. On this renderer the number of distinct render items is the thing to minimise, more so than on WebGL.

## 1. Large scale city rendering

- Renderer: `WebGPURenderer` from `three/webgpu`, `await renderer.init()`. `forceWebGL: true` selects the WebGL2 backend; without it, a missing `navigator.gpu` falls back to `WebGLBackend` automatically with a console warning (`src/renderers/webgpu/WebGPURenderer.js` L53-73). Guard with `WebGPU.isAvailable()` from `three/addons/capabilities/WebGPU.js`.
- WebGPU reach today: 83.99% full, 2.95% partial (caniuse `webgpu.json`, raw data). Chrome/Edge 113+, iOS Safari 26+, Samsung 24+. Desktop Safari is default-on only from macOS 26 Tahoe. Firefox is default-on on Windows and on macOS 26 Tahoe/Apple Silicon, flagged (`dom.webgpu.enabled`) elsewhere. Chrome on Linux "depends on hardware and drivers". Fallback is not optional.
- Geometry batching: `InstancedMesh` per archetype, not `BatchedMesh` (see section 0). Archetypes come from the exterior box: buildings that share a shell geometry share an instance buffer. Per-instance variation (colour, material set, floor count) goes in storage buffers read by `instanceIndex`.
- LOD: generate index-only LOD chains with `meshoptimizer@1.2.0` `simplify()`, which rewrites the index buffer over the same vertex array. Same vertex array is exactly what index-swapping LOD needs, and it is what the three.js example `webgl_batch_lod_bvh.html` does (10 geometries, 500k instances, 5 LODs each, 4 generated with meshoptimizer). On the WebGPU path, LOD selection is a compute pass that bins instances by screen-space size and writes per-LOD instance lists plus indirect counts.
- Impostors for the far tier: octahedral impostors are the proven technique (a demo pairs 200k trees on a 3072x3072 terrain, 2048px atlas, 16 sprites per side, with InstancedMesh2 + BVH: https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735). There is no published package: `agargaro/octahedral-impostor` is at `0.0.1` and is not on npm. Plan to write the baker and the TSL sampling material, or defer the far tier to a flat billboard first.
- Ruled out by the WebGPU choice: `@three.ez/instanced-mesh` (InstancedMesh2, 0.3.16) is WebGL only. Its WebGPU work is an unmerged PR (https://github.com/agargaro/instanced-mesh/pull/154) whose own author records a cap near 1000 instances from WebGPU's 64KB uniform buffer limit, against 200k+ on WebGL. Unusable for a city. `@three.ez/batched-mesh-extensions` (0.0.12) ships a `build/webgpu.js`, so its BVH culling and LOD do run on WebGPU, but per-instance uniforms are documented WebGL only. Both remain the best WebGL answer if WebGPU has to be abandoned.
- Frustum culling: `Object3D.frustumCulled` is per-object and does nothing inside an `InstancedMesh`. Per-instance culling is ours to write in the compute pass.
- Occlusion culling: three.js exposes hardware occlusion queries through the unified renderer. Set `object.occlusionTest = true`; `RenderList` counts them and both backends implement them (`WebGPUBackend.js`, `webgl-fallback/WebGLBackend.js`, example `webgpu_occlusion.html`). Results lag by a frame, so it suits coarse proxies (a tile's bounding box, a tower's hull), not per-building tests. There is no maintained Hi-Z occlusion library for three.js; do not plan on one.
- Draw call budget to design against: 150-300 per frame on mid-range desktop, tighter on mobile. Sourced figures cluster at "under 100 is comfortable, 500+ struggles on most hardware" (https://threejsroadmap.com/blog/draw-calls-the-silent-killer, https://www.utsubo.com/blog/threejs-best-practices-100-tips). No published three.js city demo reports real numbers, so these are design targets to validate on our own hardware, not literature values.
- Instrumentation: `renderer.info.render.drawCalls`, `.triangles`, `renderer.info.compute.frameCalls`. On WebGPU, construct with `{ trackTimestamp: true }` and `await renderer.resolveTimestampsAsync('render' | 'compute')` for real GPU-side milliseconds in `renderer.info.render.timestamp` (`src/renderers/common/Renderer.js` L2856, `WebGPUBackend.js` L294). Attach `renderer.inspector = new Inspector()` from `three/addons/inspector/Inspector.js` for the built-in profiler (performance, memory, timeline tabs).

Sources: three.js r185 source tree (raw.githubusercontent.com/mrdoob/three.js/r185/), https://threejs.org/docs/pages/BatchedMesh.html, https://threejs.org/manual/en/webgpurenderer.html, caniuse webgpu.json, https://github.com/agargaro/instanced-mesh, https://github.com/agargaro/batched-mesh-extensions, https://meshoptimizer.org/, https://web3dsurvey.com/webgl/extensions/WEBGL_multi_draw.

## 2. Crowd rendering

- three.js core has no instanced skinning: `InstancedMesh.js` and `BatchedMesh.js` contain no bone code, and PR #22667 (InstancedSkinnedMesh) was closed unmerged.
- The WebGPU path solves it officially. `webgpu_skinning_instancing_individual.html` in r185 is a complete GPU compute skinning implementation: skin indices, skin weights and source vertices in `StorageBufferAttribute`s, per-instance bone matrices in one storage buffer, a `Fn(...).compute(instanceCount * vertexCount)` kernel that writes deformed positions and normals into `attributeArray(...)`, and a plain `Mesh` whose `material.positionNode` / `normalNode` read that array. `renderer.compute(computeSkinning)` once per frame. Its subtitle states the point: per-instance poses are computed once and reused by every render pass.
- The same example already demonstrates a per-instance morph (a belly weight blended into the source position before skinning). That is the mechanism for the future runtime body and face variety, and it costs one extra storage buffer.
- Its cost model, and the constraint that sets the budget: the deformed-vertex buffer is `instanceCount * vertexCount * 2 * 16` bytes. A 3k-vertex character at 1000 instances is ~96 MB of VRAM. Vertex count per character is the lever, not instance count.
- CPU skinning ceiling for the near tier, measured by the community: stock `SkinnedMesh` + `AnimationMixer` falls under 60fps past roughly 200 instances (mixer update, bone matrix propagation and `Skeleton.update()` dominate); sharing one skeleton across instances in identical animation state reaches 1000+. https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196
- Baked vertex animation textures are the alternative for locked loops (walk, idle). There is no maintained npm baker; Blender addons (OpenVAT) plus a TSL sampling material is the route. Compute skinning covers the same ground with more flexibility, so VAT is a fallback, not the plan.
- Far tier: billboard impostors. A 2025 perceptual study puts impostors at 328KB against 5.19MB for the mesh at LOD-0 and finds them indistinguishable at low pixel density: https://arxiv.org/html/2510.20558v1
- There is no crowd engine for the web. This is ours to assemble.

Recommendation: three tiers. Near (dialogue distance, tens of NPCs) full `SkinnedMesh` + `AnimationMixer`. Mid (hundreds to low thousands) GPU compute skinning following `webgpu_skinning_instancing_individual`. Far (thousands) billboard impostors. Budget to prove: 50-150 near, a few thousand mid, tens of thousands far. Treat any claim of ten thousand independently skeleton-animated characters as unproven until we measure it.

Sources: three.js r185 examples `webgpu_skinning_instancing.html`, `webgpu_skinning_instancing_individual.html`, https://github.com/mrdoob/three.js/pull/22667, https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196, https://arxiv.org/html/2510.20558v1

## 3. Physics

- Engine: `@dimforge/rapier3d-compat@0.20.0` (2026-08-08), which tracks Rapier Rust 0.35.0. That release rewrote sleeping into persistent islands, enabled sweep-based CCD against fixed colliders by default, and shipped a broad phase tuned for large mostly-static worlds, which is exactly a city. `-simd-compat` is the same version if WASM SIMD is guaranteed. Alternative if Rapier's ergonomics fail: `jolt-physics@1.1.0`, which has character, vehicle and skeleton primitives natively but a much smaller web ecosystem. `cannon-es` last published 2022 and `ammo.js` 2016; neither is a 2026 choice.
- Character controller: Rapier's `KinematicCharacterController` via `world.createCharacterController(offset)`, then `computeColliderMovement(collider, desiredTranslation)` and `computedMovement()`. Configure `enableAutostep(maxHeight, minWidth, includeDynamicBodies)` (off by default because it is expensive, and it is what makes stairs work), `enableSnapToGround(distance)` (keeps the character on descending steps and slopes), `setMaxSlopeClimbAngle` / `setMinSlopeSlideAngle`. Test slope limits against our actual trimesh ground: there is a history of that parameter not applying on trimesh terrain.
- Ragdoll on hit: hand-rolled, no library exists. One dynamic rigid body per bone, `RAPIER.JointData.spherical(...)` between adjacent bones, copy body transforms onto three.js bones each frame. Reference implementation: https://github.com/mattvb91/rapierjs-ragdoll (GitHub only, never published to npm). The animation-to-ragdoll and ragdoll-back-to-animation blend has no documented web recipe; design it as blending the animated pose toward the ragdoll's bone transforms over N frames.
- Vehicle, single user car: `DynamicRayCastVehicleController`, following the official example `physics_rapier_vehicle_controller.html`. Per-wheel `setWheelEngineForce`, `setWheelBrake`, `setWheelSteering`, `setWheelSuspension*`, then `updateVehicle(dt)`.
- https://github.com/depixeled-chris/gta7 uses **no physics engine**. Its dependencies are `lucide`, `simplex-noise` and `three@^0.160.0`. Collisions and driving are hand-rolled velocity-vector arcade physics. It is a feel and architecture reference: its simulation core stays three.js-free and testable in Node, with rendering in a separate layer.
- City-scale colliders: one compound collider of convex primitives per building, never one trimesh per building and never one trimesh for the city. All fixed rigid bodies, so they are outside the dynamic set and need no sleep management. Create and destroy colliders with tile load and unload.
- Loop: fixed 1/60 physics step decoupled from the render tick, interpolate rendered transforms between the last two states. Running the step in a worker is the community pattern, not an official one.

Sources: https://rapier.rs/docs/user_guides/javascript/character_controller, https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html, https://rapier.rs/docs/user_guides/javascript/joints, https://github.com/dimforge/rapier/blob/master/typescript/CHANGELOG.md, https://github.com/jrouwe/JoltPhysics.js, https://github.com/mattvb91/rapierjs-ragdoll, https://github.com/depixeled-chris/gta7

## 4. GLB asset pipeline

- Geometry: meshopt (`EXT_meshopt_compression`), not Draco. Decodes at roughly 1 GB/s per the spec, and its attributes stay quantized so they upload to the GPU in compact form. Draco decodes to float32 and needs a separate requantization pass, and `google/draco` has had no release since v1.5.7 (2024-01-17) while meshoptimizer shipped 1.0 in Dec 2025, 1.1 in Apr 2026 and 1.2 on 2026-06-30. Wire it up with `gltfLoader.setMeshoptDecoder(MeshoptDecoder)` from the `meshoptimizer` npm package; call `decoder.useWorkers(n)` to get decoding off the main thread.
- Textures: KTX2 / Basis (`KHR_texture_basisu`). UASTC for normal and ORM maps, ETC1S for albedo and facades. Encode with `ktx create` / `ktx encode` from KTX-Software v4.4.2. Loader: `KTX2Loader` with `setTranscoderPath(...)` (or `setTranscoderUrls(...)`) plus `detectSupport(renderer)` so it transcodes to the device's native BC/ETC2/ASTC format. Textures stay GPU-compressed after transcode; PNG and JPG expand to full RGBA in VRAM.
- Tooling: `@gltf-transform/cli@4.5.0` as the standing pipeline (composable, actively released through 2026). Order: `weld`, `dedup`, `instance` (writes `EXT_mesh_gpu_instancing`, which three.js `GLTFLoader` supports natively), `simplify`, `prune`, `meshopt`, then `etc1s` / `uastc` per texture slot. `gltfpack@1.2.0` is a reasonable one-shot alternative for batch jobs. `KHR_materials_variants` is not in core `GLTFLoader`; register the plugin from `examples/jsm/loaders/gltf_plugins` if the materials box needs it.
- Loading and disposal: one shared `GLTFLoader`. Do not rely on `THREE.Cache` for cross-load dedup, because `GLTFParser` keys embedded images on a fresh object URL per load. Keep a URL-keyed asset registry over the loader. On eviction, traverse the scene and call `geometry.dispose()`, `material.dispose()` and `texture.dispose()` for every texture slot on every material: material disposal frees only the compiled program, it does not cascade to textures.
- Avoiding hitches when a tile lands: decode and BVH build on a worker, `await renderer.compileAsync(scene, camera, tileGroup)` before splicing the tile into the visible graph, then add objects a handful per frame.
- Progressive LOD streaming: `@needle-tools/gltf-progressive@3.6.0` (MIT, zero deps, peer `three >= 0.183.0`) is used in the official r185 example `webgl_loader_gltf_progressive_lod.html` (237.9 MB of assets to a 2.9 MB initial download). It only selects and streams; the progressive data itself is produced by Needle Engine's build pipeline or Needle Cloud, with no documented free local CLI. So the runtime is adoptable, the encoder is a dependency we do not control. For a procedurally generated city we produce our own LOD chains anyway (section 1), so treat this as a reference, not a dependency.
- Tiling: `3d-tiles-renderer@0.5.2` gives screen-space-error LOD selection and a byte-capped LRU cache, at the cost of adopting the 3D Tiles tileset schema and its geospatial conventions. For a procedural flat city, a custom quadtree keyed to atlas districts and blocks is simpler and we already own the blueprint. Take the ideas (SSE-driven selection, hard byte cap on the cache, hysteresis between load and unload radius), not the dependency.
- Streaming scheme to start from: tile = a small group of city blocks, sized so the player crosses a boundary every few seconds at driving speed. Load radius 2 rings (25 cells), unload radius one ring beyond it so boundary crossing does not thrash.

Sources: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md, https://github.com/zeux/meshoptimizer/releases, https://github.com/google/draco/releases, https://github.com/KhronosGroup/KTX-Software/releases, https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md, https://gltf-transform.dev/cli, https://threejs.org/manual/en/how-to-dispose-of-objects.html, https://threejs.org/docs/pages/KTX2Loader.html, https://github.com/NASA-AMMOS/3DTilesRendererJS, https://engine.needle.tools/docs/gltf-progressive

## 5. Sky

- Use `SkyMesh` from `three/addons/objects/SkyMesh.js`. It is the WebGPU/TSL sibling of the classic `Sky`, built on `NodeMaterial`, and matches this renderer. `Sky` is the WebGL-only version; same model, same parameters.
- One draw call. Preetham analytic daylight, plus procedural clouds added to the shader this year (PR #32682 Jan 2026, improved by #33942 in r185): no cloud texture, no extra geometry.
- Parameters are TSL uniforms held directly on the object, so it is `sky.turbidity.value = 2`, not `material.uniforms.turbidity.value`: `turbidity` (2), `rayleigh` (1), `mieCoefficient` (0.005), `mieDirectionalG` (0.8), `sunPosition` (Vector3), `upUniform`, `cloudScale` (0.0002), `cloudSpeed` (0.0001), `cloudCoverage` (0.4), `cloudDensity` (0.4), `cloudElevation` (0.5), `showSunDisc` (1). Scale it huge (`sky.scale.setScalar(450000)`).
- Day and night: compute the sun direction from elevation and azimuth once per tick, write it into `sky.sunPosition.value` and mirror it onto a `DirectionalLight`; move light colour and intensity and `renderer.toneMappingExposure` with it.
- Lighting from the sky: `new THREE.PMREMGenerator(renderer).fromScene(...)` into `scene.environment`. Never per frame; it is a full cubemap render plus mip convolution. Rebake on a coarse threshold, once per in-game hour or when the sun has moved past a set angle. `scene.background` and `scene.environment` are independent.
- Fog: `exponentialHeightFogFactor` with colour and density driven off sun elevation, so ground haze thins over tall towers.
- Stars: one `Points` cloud, a few thousand points, additive, `sizeAttenuation: false`, `frustumCulled: false`, faded in as the sun drops. One draw call.
- Tone mapping: all of `ACESFilmicToneMapping`, `AgXToneMapping`, `NeutralToneMapping` exist in r185. The WebGPU examples lean `NeutralToneMapping` (used in `webgpu_skinning_instancing_individual`); the classic sky example still uses ACESFilmic. Taste, not spec.
- Skip `@takram/three-atmosphere@0.19.1`. It is Bruneton precomputed scattering built for planet-scale geospatial accuracy with LUT textures and real ephemeris. Maintained and good, and far more than a city at street level needs.

Sources: `three/addons/objects/SkyMesh.js` (r185), https://threejs.org/docs/pages/SkyMesh.html, https://threejs.org/docs/pages/PMREMGenerator.html, https://threejs.org/examples/webgpu_sky.html, https://discourse.threejs.org/t/bad-performances-when-animating-a-pmremgenerator-environment/48043

## 6. WebGPURenderer: maturity, TSL, compute, fallback

- Maturity: the official manual still calls the renderer experimental, while saying its maturity has greatly improved and pointing new projects at it. The honest reading is that the renderer is the project's direction of travel and the API is stable enough to build on, while specific paths (batched multi-draw, the UBO model under many render items) are open work. https://threejs.org/manual/en/webgpurenderer.html
- Not supported on this path, and this is what actually costs us: `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, and `EffectComposer`. Every custom shader is TSL. Post-processing is `PostProcessing` from `three/webgpu` plus the effect nodes under `three/addons/tsl/display/*`.
- TSL: import from `three/tsl`. The pieces we need: `Fn(([args]) => {...})` for reusable functions, `positionNode` and `normalNode` on a `NodeMaterial` for vertex displacement, `attribute('name','vec3')`, `texture(map, uv())`, `instanceIndex`, `vertexIndex`, `storage(bufferAttribute, type, count)` and `attributeArray(count, type)` for GPU buffers, `uniform(value)`. `wgslFn(...)` is the escape hatch into hand-written WGSL when a node does not exist. Reference: https://github.com/mrdoob/three.js/wiki/TSL-Spec and https://threejs.org/docs/TSL.html
- Compute: `Fn(() => {...})().compute(count)` then `renderer.compute(node)` or `await renderer.computeAsync(node)`. r185 ships 19 `webgpu_compute_*` examples. There is no official GPU frustum culling or crowd culling example: `webgpu_compute_birds.html` (boids) and `webgpu_struct_drawindirect.html` are the nearest building blocks. GPU-driven culling for the city is genuinely unbuilt ground, not a wiring job.
- The fallback is better than expected, and its holes are specific. `WebGLBackend` implements `compute()` on WebGL2 transform feedback (`src/renderers/webgl-fallback/WebGLBackend.js` L867-951), so TSL materials and ordinary compute passes both run on the WebGL2 backend. What does not survive: indirect draws and indirect dispatch (the backend warns and falls back to a plain count rather than crashing), atomics, and TSL `struct`. A silent behaviour change is worse than a crash, so the fallback path needs its own test pass, not an assumption.
- Occlusion queries (`object.occlusionTest = true`) work on both backends, so that one technique does not fork.
- What the WebGPU choice forces us to write ourselves: per-instance material variation via `storage()` buffers keyed by `instanceIndex` (the ready-made per-instance-uniform extensions do not reach WebGPU), the impostor and any vertex-animation material, and the GPU culling plus LOD selection plus indirect count pass.
- Policy: WebGPU by default, `WebGPU.isAvailable()` guard, automatic `WebGLBackend` fallback, and `forceWebGL: true` as an explicit QA switch. Firefox on Linux and on Android is WebGL2 in practice, so the fallback is a supported target with real users behind it, not dead code.

Sources: https://threejs.org/manual/en/webgpurenderer.html, https://github.com/mrdoob/three.js/wiki/TSL-Spec, https://github.com/mrdoob/three.js/issues/30560, https://github.com/mrdoob/three.js/pull/30645, https://github.com/mrdoob/three.js/issues/26600, r185 `src/renderers/webgl-fallback/WebGLBackend.js`, r185 `src/Three.WebGPU.js`, https://github.com/gpuweb/gpuweb/wiki/Implementation-Status

## 7. Desktop distribution

The decision is made by one fact: **WebKitGTK has no WebGPU.** WebKit bug 257694 is reopened with no activity since 2023, and the WebKitGTK 2.46, 2.48 and 2.50 release notes through Nov 2025 never mention it. Every shell that rides the OS webview (Tauri, Wails, Neutralino) inherits that gap and cannot flag its way out of it. On macOS the same family of shells needs WKWebView from macOS 26, which shipped WebGPU in Sept 2025; earlier releases render nothing.

- Ship on **Electron 44.1.0** (2026-08-31), which bundles Chromium 152.0.7977.65 and Node 24.19.0, on an 8-week major cadence. WebGPU comes from Chromium: on by default on Windows (D3D12) and macOS (Metal). Linux is a driver allowlist rather than an engine gap, so `app.commandLine.appendSwitch('enable-unsafe-webgpu')` plus `enable-features=Vulkan` and `ignore-gpu-blocklist` gives a real chance where WebKitGTK gives none.
- Electron also has the track record: confirmed commercial Steam titles ship on it. No commercially shipped game on Tauri was found. Steam integration is `steamworks.js` (npm 0.4.0, stale on the registry, repo active) or `steamworks-rs` if we were on Rust.
- Tauri 2.11.5 stays the better answer on size (a few MB against ~100MB) and idle RAM, and is the fallback if we ever drop WebGPU. It is not the answer for this project.
- **Never load assets over `file://`.** `fetch` against it is CORS-blocked with a null origin, and `WebAssembly.instantiateStreaming` needs a real `Content-Type: application/wasm`. That breaks the meshopt, KTX2 and Rapier WASM loads. Register a custom `app://` scheme with `protocol.registerSchemesAsPrivileged({ standard: true, secure: true, supportFetchAPI: true })` and serve it with `protocol.handle` backed by `net.fetch(pathToFileURL(...))`, which infers the right content type. Keep every asset URL root-relative; Electron has a known quirk resolving sibling-relative paths under a custom scheme.
- Vite: one codebase, two builds. `base: '/'` for the browser, `base: './'` for the desktop bundle served over `app://`. Content hashing is unaffected.

What the core must never import, so the same engine runs in a tab and in the shell:
- No file in the engine core imports `electron`, `node:fs`, or checks `process.versions.electron` / `window.__TAURI__`. Detection happens once at bootstrap, in the adapter-selection shim.
- Ports the core is given, each with a browser adapter and an Electron adapter: `SavePort` (IndexedDB in the browser, `fs` behind IPC on desktop), `AssetPort` (base URL plus fetch), `ShellPort` (window, fullscreen, menus), `UpdatePort`, `InputPort` (gamepad and keyboard). Renderer code never touches `fs`.
- This is the same box rule the project already follows: `shell-browser` and `shell-electron` are two adapter boxes behind one contract, and the engine core depends on the contract only.

Sources: https://bugs.webkit.org/show_bug.cgi?id=257694, https://webkitgtk.org/2025/11/26/webkitgtk-2.50.html, https://github.com/tauri-apps/tauri/issues/6381, https://releases.electronjs.org/release/v44.1.0, https://www.electronjs.org/docs/latest/tutorial/electron-timelines, https://www.electronjs.org/docs/latest/api/protocol, https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips, https://discourse.threejs.org/t/access-to-fetch-at-file-c-d-glb-from-origin-null-has-been-blocked-by-cors-policy/46480, https://v2.tauri.app/security/asset-protocol/

## 8. The stack for the scale prototype

| Concern | Choice | Version |
|---|---|---|
| Renderer | `three/webgpu` `WebGPURenderer`, WebGL2 backend as automatic fallback | three 0.185.1 |
| Shaders | TSL from `three/tsl`, `wgslFn` escape hatch | three 0.185.1 |
| Post-processing | `PostProcessing` from `three/webgpu` + `three/addons/tsl/display/*` | three 0.185.1 |
| Buildings | `InstancedMesh` per archetype + compute cull/LOD + `IndirectStorageBufferAttribute` | hand-written |
| LOD generation | `meshoptimizer` `simplify()`, index-only chains | 1.2.0 |
| Crowd, near | `SkinnedMesh` + `AnimationMixer` | three 0.185.1 |
| Crowd, mid | GPU compute skinning per `webgpu_skinning_instancing_individual` | hand-written |
| Crowd, far | billboard impostors | hand-written |
| Raycast / spatial | `three-mesh-bvh` (has a WebGPU API) | 0.9.14 |
| Physics | `@dimforge/rapier3d-compat` | 0.20.0 |
| Sky | `SkyMesh` from `three/addons/objects/SkyMesh.js` + `PMREMGenerator` + `FogExp2` | three 0.185.1 |
| Geometry compression | meshopt (`EXT_meshopt_compression`), decoder from `meshoptimizer` | 1.2.0 |
| Texture compression | KTX2 / Basis, `ktx create` from KTX-Software | 4.4.2 |
| Asset pipeline | `@gltf-transform/cli` | 4.5.0 |
| Desktop shell | Electron, `app://` custom protocol | 44.1.0 |
| Profiling | `renderer.info` + `{ trackTimestamp: true }` + `three/addons/inspector/Inspector.js` | three 0.185.1 |

Written by us, because nothing ships it: GPU frustum culling and LOD selection into indirect counts, per-instance material variation through `storage()` buffers keyed by `instanceIndex`, the impostor baker and its sampling material, the ragdoll bone-to-body rig and its blend back to animation, and the tile streaming scheme.

## 9. First measurable experiment

One experiment, and it can fail. Everything above rests on a single unproven claim: that the WebGPU indirect-draw path beats the naive path badly enough to carry a city.

**Build three variants of the same scene and measure them side by side.** Placeholder boxes only, no real assets, no textures beyond a flat material. N buildings on the atlas street grid, N swept from 1,000 to 50,000.

- A: one `Mesh` per building. The naive baseline, and the shape that issue #30560 says WebGPU handles worst.
- B: one `BatchedMesh`, `perObjectFrustumCulled: true`. The obvious choice, and the one section 0 predicts will disappoint on WebGPU.
- C: one `InstancedMesh` per archetype, a compute pass that frustum-culls and picks an LOD and writes counts into an `IndirectStorageBufferAttribute`, one indirect draw per archetype.

Measure, on each variant, at each N, on WebGPU and again with `forceWebGL: true`:
- `renderer.info.render.drawCalls` and `.triangles`
- GPU milliseconds from `{ trackTimestamp: true }` and `await renderer.resolveTimestampsAsync('render')`
- compute milliseconds from `resolveTimestampsAsync('compute')`
- CPU frame time, and the largest N that holds 60fps

**What would falsify the plan:** if C does not clearly beat B and A at 10,000+ buildings, or if the compute pass costs more than the draw calls it saves, then the WebGPU-first architecture is wrong and the answer is the WebGL path with `BatchedMesh` plus `@three.ez/batched-mesh-extensions`. Run this before any asset, any NPC, any physics body. It is a few hundred lines and it decides the shape of the whole engine.

Second experiment, once C wins: the same sweep for crowds. Compute-skinned instances from 100 to 10,000, measuring the same numbers plus the VRAM cost of the deformed-vertex buffer, which is `instances * vertices * 32` bytes and will bite before the frame time does.
