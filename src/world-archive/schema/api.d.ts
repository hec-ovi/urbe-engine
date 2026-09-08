export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface JsonBinding { sha256: string; bytes: number }
export interface ArchivePart extends JsonBinding { file: string; start: number; count: number }
export interface ArchiveCollection { pointer: string; count: number; parts: ArchivePart[] }
export interface ArchiveIndex {
  format: 'urbe-world-archive';
  version: '1.0.0';
  json: JsonBinding;
  root: JsonValue;
  collections: ArchiveCollection[];
}
export interface WriteOptions { maxRecords?: number; maxPartBytes?: number }
export interface ReadOptions { concurrency?: number }
export interface BrowserReadOptions extends ReadOptions { fetch?: typeof fetch }
export interface CollectionRange { start?: number; end?: number }
export interface ArchiveReader {
  /** Recursively frozen index, including root metadata and collection descriptors. */
  readonly index: Readonly<ArchiveIndex>;
  read(): Promise<JsonValue>;
  readProjection(projection: { omit: string[] }): Promise<JsonValue>;
  readCollection(pointer: string, range?: CollectionRange): Promise<JsonValue[]>;
}
export declare class WorldArchiveError extends Error {
  code: 'E_ARCHIVE_INPUT' | 'E_ARCHIVE_SIZE' | 'E_ARCHIVE_INDEX' | 'E_ARCHIVE_PART' | 'E_ARCHIVE_HASH' | 'E_ARCHIVE_RANGE' | 'E_ARCHIVE_IO';
}
/** Node: index.js */
export declare function writeWorldArchive(value: unknown, directory: string, options?: WriteOptions): Promise<ArchiveIndex>;
export declare function openWorldArchive(directory: string, options?: ReadOptions): Promise<ArchiveReader>;
export declare function readWorldArchive(directory: string, options?: ReadOptions): Promise<JsonValue>;
export declare function iterateJsonBytes(value: unknown): Iterable<Uint8Array>;
export declare function hashJson(value: unknown): JsonBinding;
/** Browser: browser.js exports this function as openWorldArchive. */
export declare function openBrowserWorldArchive(indexUrl: string | URL, options?: BrowserReadOptions): Promise<ArchiveReader>;
