/** Request: exterior/schemas/building-request.schema.json. */
export type ExteriorRequest = Record<string, unknown>;
/** Result: exterior/schemas/blueprint.schema.json. */
export type ExteriorBlueprint = Record<string, unknown>;
export declare class ExteriorWorkers {
  constructor(count?: number);
  /** Writes keys-only GLB and blueprint into the supplied directory. */
  run(request: ExteriorRequest, outDir: string): Promise<ExteriorBlueprint>;
  /** Cancels unfinished work and releases producer workers. */
  close(): Promise<void>;
}
