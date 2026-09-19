import type { InteriorSource } from '../../city/schema/interior-stream';

/** Exterior and Interior document contents follow their producer schemas. */
export interface WorldBuilding {
  parcelId: string;
  blueprint: Record<string, unknown>;
  npc: Record<string, unknown> | null;
  /** The building manifest and its three placement layouts, or null for a closed shell. */
  interior: InteriorSource | null;
  hasInterior: boolean;
  source: 'kit' | 'shell';
  /** A kit parcel carries its placement table; a generated one carries its shell GLB. */
  placementsUrl?: string;
  /** A kit parcel's own word, lettered on its plan's sign field; null when it reads nothing. */
  word?: string | null;
  shellUrl?: string;
}
/** One city resource catalog copied beside the world, with the directory its files are relative to. */
export interface WorldResource {
  document: Record<string, unknown>;
  baseUrl: string;
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
  /** Interior's shared `modules.json`, required by a world with interiors. */
  interiorModules: WorldResource | null;
  /** Interior's shared furniture catalog, or null for a world with no furniture. */
  interiorProps: WorldResource | null;
}
