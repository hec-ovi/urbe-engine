/** Exterior and Interior document contents follow their producer schemas. */
export interface WorldBuilding {
  parcelId: string;
  blueprint: Record<string, unknown>;
  npc: Record<string, unknown> | null;
  floors: Array<Record<string, unknown> & { glbUrl: string }>;
  hasInterior: boolean;
  shellUrl: string;
}
/** Unique manifest shell IDs; rejects unknown IDs before requesting files. */
export type LoadBuildings = (ids: string[]) => Promise<Map<string, WorldBuilding>>;
/** WorldSource.load adds these ports beside the generated world and game. */
export interface WorldBuildingSources {
  buildings: Map<string, WorldBuilding>;
  loadBuildings: LoadBuildings;
  unbuilt: string[];
  /** Validated Assembly shell-catalog.schema.json, or null for legacy worlds. */
  shellCatalog: Record<string, unknown> | null;
}
