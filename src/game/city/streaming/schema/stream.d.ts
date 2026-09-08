type Point2 = [number, number];
type Point3 = [number, number, number];
interface MaterialBinding { key: string; variantId: string; }
/** Assembly schema: src/assembly/schema/shell-catalog.schema.json. */
export interface ShellRecord {
  id: string;
  center: Point3;
  bounds: {min: Point3; max: Point3};
  floorCount: number;
  basementCount: number;
  bands: {bottom: number; top: number; outline: Point2[]; material: MaterialBinding}[];
  roof: {elevation: number; outline: Point2[]; parapetHeight: number;
    material: MaterialBinding; parapetMaterial: MaterialBinding};
}
export interface ShellStreamSettings {
  catalog: {version: '1.0.0'; seed: string; buildings: ShellRecord[]};
  factory: unknown;
  buildings: Map<string, unknown>;
  loadBuildings(ids: string[]): Promise<Map<string, unknown>>;
  cellSize?: number;
  loadRadius?: number;
  dropRadius?: number;
  skylineRadius?: number;
  loader?: {load(buildings: Map<string, unknown>): Promise<Omit<ShellCell, 'id'|'ids'|'buildings'>>};
  prepare?(cell: ShellCell): Promise<void>;
  added?(cell: ShellCell): void;
  removed?(cell: ShellCell): void;
  onError?(error: Error): void;
}
export interface ShellCell {
  id: string;
  ids: string[];
  buildings: Map<string, unknown>;
  group: unknown;
  doors: unknown[];
  entrances: unknown[];
  shellColliders: Map<string, unknown>;
  triangles: number;
}
export declare class ShellStream {
  constructor(settings: ShellStreamSettings);
  readonly group: unknown;
  readonly doors: unknown[];
  readonly entrances: unknown[];
  readonly centers: Map<string, unknown>;
  readonly shellColliders: Map<string, unknown>;
  readonly triangles: number;
  prepare?: ShellStreamSettings['prepare'];
  added?: ShellStreamSettings['added'];
  removed?: ShellStreamSettings['removed'];
  load(position: {x: number; z: number}): Promise<this>;
  update(position: {x: number; z: number}): void;
  settled(): Promise<void>;
  dispose(): Promise<void>;
}
