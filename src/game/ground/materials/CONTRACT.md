# Native street materials

Builds Three.js node materials from the authored street surface catalog.

## In and out

`new NativeStreetMaterials(binding, loadTexture)` takes the [Materials binding](../../../../../materials/schema/street-native.schema.json) and a [texture resource port](schema/ports.d.ts). `build(surfaceId, options?)` returns a cached node material. `resources(material)` returns its texture resources, also exposed as `material[Symbol.for('urbe.material-resources')]` for renderer preparation. Callers await every `ready` promise before renderer preparation. `dispose()` releases materials; texture ownership stays with the supplied resource port.

The [port schema](schema/ports.d.ts) defines optional road roughness and geometry attributes. GLBs name the surface with material extras `streetNativeSurface`. The geometry supplies POSITION, NORMAL, TEXCOORD_0 and, where needed, `_STREET_WEAR` and `_STREET_HEIGHT`. GLTFLoader exposes custom attributes as `_street_wear` and `_street_height`. Wear is continuous across asphalt, parking and paint; height is relative to the source road datum. `assertGeometry(material, geometry)` checks required attributes and their vertex counts before admission.

## Rules

The [source equations and UV rules](../../../../../materials/sources/streets/scene-native/CONTRACT.md) govern all eleven effects. Shader values use the supplied source coefficients. World coordinates drive asphalt offset blending with unshifted gradients. Complete panel UVs, mask UVs and curb UVs remain producer-owned. Colors decode from sRGB; opacity is applied once. Coated surfaces use physical node materials. Other surfaces use standard node materials.

The texture port must return a distinct configured resource for each texture identity, matching its published color space, axis wraps and `flipY=true`. Its readiness includes successful decoding and any texture budgeting. Only paths beginning `themes/` are accepted; hosts map the remainder under their public theme URL. Raw source directories have no public route. The box performs no network requests and does not own image resizing or GPU preparation.

## Errors

`E_STREET_MATERIAL`: malformed catalog, missing map identity, unknown surface, invalid texture resource, invalid override, missing geometry attributes or use after disposal. Texture readiness errors propagate from the resource port. Failed resources never become a scalar substitute.

## Dependencies

Materials native binding and source contract; Three.js TSL and node materials. Three.js APIs: [texture gradients](https://threejs.org/docs/pages/TextureNode.html#grad), [normal mapping](https://threejs.org/docs/pages/NormalMapNode.html), [physical nodes](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html).
