export type BuildingModelKind = 'ornamental-tree' | 'palm' | 'shrub';
export interface BuildingModelInstance {
  kind: BuildingModelKind;
  /** Original root, world metres. */
  position: [number, number, number];
  /** Available width, height and depth in the model's yaw frame. */
  size: [number, number, number];
  rotation?: number;
}
/** Third BuildingsLoader constructor argument; omitted keys retain the JSON mapping. */
export interface BuildingModelOptions {
  modelAssets?: Partial<Record<BuildingModelKind, string | null>>;
}
/** Additional fields returned by BuildingsLoader.load(). */
export interface BuildingModelResult {
  unresolvedModelInstances: {parcelId: string; index: number; kind: BuildingModelKind}[];
  /** Idempotent; removes model groups and releases their resources. */
  disposeModelInstances(): void;
}
