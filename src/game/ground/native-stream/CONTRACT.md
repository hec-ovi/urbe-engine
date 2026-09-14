# Native street residency

Loads the exact saved street pieces around the player and admits their physical triangles to Physics.

`NativeStreetStream(source, materials)` takes the [verified source](../native/schema/ports.d.ts) and [native material port](../materials/schema/ports.d.ts). It returns the [Ground stream surface](../schema/stream.d.ts). Piece bounds select residency; node transforms restore world coordinates once. Rendering and collision radii are independent. Updates coalesce and prepare serially; changed windows cancel obsolete admission.

Each GLB must contain the declared triangle count, surfaces, collision tags and native vertex attributes. Bounds measured from decoded vertices must be finite and match the source within Float32 precision. Material resources finish loading before admission. The current `prepare` port finishes before publication, including when replaced during pending preparation. Missing assets, material failures and invalid geometry reject without a fallback.

Collision uses only meshes tagged `streetCollision:true`, expands their exact world triangles in batches of at most 2,048, and never includes paint. Piece eviction drops its collision and releases geometry. Disposal releases resident geometry and aborts active piece reads. Source, shared materials and their textures remain caller-owned.

Errors: `E_NATIVE_STREET_STREAM` for invalid window, disposed stream or invalid decoded geometry; source, material, preparation and Physics errors propagate.

Dependencies: saved native street source, native Materials, Ground stream schema, Physics band admission, Three GLTFLoader.
