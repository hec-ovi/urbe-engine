import type { BufferGeometry, Material, Object3D } from 'three';

/** One entry from catalog.schema.json properties.assets. */
export interface ModelAsset {
  id: string;
  file: string;
  height?: number;
  size?: [number, number, number];
}
export type LoadModelAsset = (url: string) => Promise<{scene: Object3D}>;
export interface ModelPart { geometry: BufferGeometry; material: Material; tintable: boolean; }
export declare class ImportedModels {
  constructor(loadAsset?: LoadModelAsset);
  load(spec: ModelAsset): Promise<ModelPart[]>;
  /** Call after pending loads settle. Parts are invalid after disposal. */
  dispose(): void;
}
