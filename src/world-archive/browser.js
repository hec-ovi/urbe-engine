import { ArchiveReader } from './ArchiveReader.js';
import { readOptions } from './IndexValidation.js';
import { fail, WorldArchiveError } from './errors.js';

export { WorldArchiveError } from './errors.js';

async function responseBytes(response, limit, code, name) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) fail(code, `Archive response exceeds declared bytes: ${name}`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail(code, `Archive response exceeds declared bytes: ${name}`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function openWorldArchive(indexUrl, options = {}) {
  readOptions(options);
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if ((typeof indexUrl !== 'string' && !(indexUrl instanceof URL)) || !String(indexUrl) || typeof fetcher !== 'function') fail('E_ARCHIVE_INPUT', 'Expected an index URL and fetch implementation');
  if (!globalThis.crypto?.subtle) fail('E_ARCHIVE_INPUT', 'World archive reads require Web Crypto SHA-256');
  const url = String(indexUrl);
  const location = url.split(/[?#]/, 1)[0];
  const base = location.slice(0, location.lastIndexOf('/') + 1);
  const read = async (file, expectedBytes) => {
    const target = file === 'index.json' ? url : `${base}${file}`;
    let response;
    try { response = await fetcher(target); }
    catch (error) { fail('E_ARCHIVE_IO', `Could not fetch archive file: ${file}`, error); }
    if (!response.ok) fail(file === 'index.json' ? 'E_ARCHIVE_IO' : 'E_ARCHIVE_PART', `Archive request failed (${response.status}): ${file}`);
    return responseBytes(response, expectedBytes ?? 32 * 1024 * 1024, file === 'index.json' ? 'E_ARCHIVE_INDEX' : 'E_ARCHIVE_HASH', file);
  };
  let index;
  try { index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('index.json'))); }
  catch (error) {
    if (error instanceof WorldArchiveError) throw error;
    fail('E_ARCHIVE_INDEX', 'Invalid archive index JSON', error);
  }
  const digest = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const reader = new ArchiveReader(index, read, digest, options);
  return { index: reader.index, read: () => reader.read(), readProjection: projection => reader.readProjection(projection), readCollection: (pointer, range) => reader.readCollection(pointer, range) };
}
