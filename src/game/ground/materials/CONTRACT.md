# Native street materials

Builds Three.js node materials from the authored street surface catalog.

## In and out

`new NativeStreetMaterials(binding, loadTexture)` takes the [Materials binding](../../../../../materials/schema/street-native.schema.json) and a [texture resource port](schema/ports.d.ts). `build(surfaceId, options?)` returns a cached node material. `resources(material)` returns its texture resources, also exposed as `material[Symbol.for('urbe.material-resources')]` for renderer preparation. Callers await every `ready` promise before renderer preparation. `dispose()` releases materials; texture ownership stays with the supplied resource port.

`build` also takes the values one copy asks for itself, as nodes the caller's own per instance table answers with: `instances` supplies the tint that multiplies whatever the effect paints and the wear that adds to the baked field, and, where the surface needs them, the scan transform and the glyphs a display face letters. `scanCells` names the four surfaces whose maps that quad picks between, resolved once into the shared scan material, and the atlas cell is chosen in the shader. A display face with glyphs letters them from its own letter atlas sheet, one centred row of square cells on the 1.8 m marquee face, and reads transparent outside them. Materials are cached per surface, override and table, and a surface is transparent exactly where its effect paints an opacity.

The [port schema](schema/ports.d.ts) defines optional road roughness, per copy values and geometry attributes. GLBs name the surface with material extras `streetNativeSurface`. The geometry supplies POSITION, NORMAL, TEXCOORD_0 and, where needed, `_STREET_WEAR` and `_STREET_HEIGHT`. GLTFLoader exposes custom attributes as `_street_wear` and `_street_height`. Wear is continuous across asphalt, parking and paint; height is relative to the source road datum. `assertGeometry(material, geometry)` checks required attributes and their vertex counts before admission.

## Rules

`new NativeTextureSource(options?).load` supplies the texture resource port. Its [options](schema/ports.d.ts) choose the public theme URL, image decoder, fetch implementation, preparation/budget callback and anisotropy. Defaults use `/materials`, browser fetch, PNG decoding and anisotropy 8. Each texture identity downloads once; SHA-256 and original pixel dimensions must match before the preparation callback. Readiness includes that callback. `dispose()` frees its textures and prevents pending work from becoming ready.

The [source equations and UV rules](../../../../../materials/sources/streets/scene-native/CONTRACT.md) govern the published effects. Shader values use the supplied source coefficients. World coordinates drive asphalt offset blending with unshifted gradients. Complete panel UVs, mask UVs and curb UVs remain producer-owned. Colors decode from sRGB; opacity is applied once. Coated surfaces use physical node materials. Other surfaces use standard node materials.

Authored district surfaces also use the published world/metre sampling, emissive solid strips and textured display effect. A display multiplies its sRGB-decoded face by tint and brightness for emission. The `led-matrix` field of a marquee run draws its face tint and roughness alone, with no dot lattice, lettering or emission. Source metadata and authored map hashes remain producer-owned. [Three.js emissive nodes](https://threejs.org/docs/pages/MeshStandardNodeMaterial.html#emissiveNode) supply the light response.

The texture port must return a distinct configured resource for each texture identity, matching its published color space, axis wraps and `flipY=true`. Its readiness includes successful decoding and any texture budgeting. Only paths beginning `themes/` are accepted; hosts map the remainder under their public theme URL. Raw source directories have no public route. The material factory performs no network requests and does not own image resizing or GPU preparation.

## Errors

`E_STREET_MATERIAL`: malformed catalog, missing map identity, unknown surface, invalid texture resource, invalid override, missing geometry attributes or use after disposal. Texture readiness errors propagate from the resource port. Failed resources never become a scalar substitute.

`E_STREET_TEXTURE`: invalid source options/reference, conflicting identity, failed HTTP/hash/dimension/decode/preparation checks, or disposed source. These failures reject readiness and retain no decoded image.

## Dependencies

Materials native binding and source contract; Three.js TSL and node materials. Three.js APIs: [texture gradients](https://threejs.org/docs/pages/TextureNode.html#grad), [normal mapping](https://threejs.org/docs/pages/NormalMapNode.html), [physical nodes](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html).
