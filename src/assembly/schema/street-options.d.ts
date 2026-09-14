import type { NativeMaterialCatalog } from '../../../../streets/src/schema/native-materials.ts';
/** OutDir.publishManifest streets option. City CLI always enables the default. */
export type StreetOptions = false | true | {
  /** Defaults to FNV-1a of `${atlas.meta.seed}:streets`. */
  seed?: number;
  /** Defaults to one; valid range zero through one. */
  wear?: number;
  /** Defaults to the published sibling Materials bindings/street-native.json. */
  nativeMaterials?: NativeMaterialCatalog | string;
};
