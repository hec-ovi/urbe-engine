import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { ArchiveReader } from './ArchiveReader.js';
import { ArchiveWriter } from './ArchiveWriter.js';
import { fail, WorldArchiveError } from './errors.js';

export { WorldArchiveError } from './errors.js';
export { iterateJsonBytes } from './JsonValue.js';
export { hashJson } from './ArchiveWriter.js';

export async function writeWorldArchive(value, directory, options) {
  return new ArchiveWriter(directory, options).write(value);
}

export async function openWorldArchive(directory, options) {
  if (typeof directory !== 'string' || !directory) fail('E_ARCHIVE_INPUT', 'Expected an archive directory');
  try {
    const root = await realpath(directory);
    const read = async (file, expectedBytes) => {
      let path;
      try { path = await realpath(join(root, file)); }
      catch (error) { fail(file === 'index.json' ? 'E_ARCHIVE_IO' : 'E_ARCHIVE_PART', `Missing archive file: ${file}`, error); }
      if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) fail('E_ARCHIVE_INDEX', `Archive path escapes its directory: ${file}`);
      const info = await stat(path);
      if (!info.isFile()) fail('E_ARCHIVE_IO', `Archive path is not a file: ${file}`);
      if (expectedBytes !== undefined && info.size !== expectedBytes) fail('E_ARCHIVE_HASH', `Part byte count differs: ${file}`);
      if (file === 'index.json' && info.size > 32 * 1024 * 1024) fail('E_ARCHIVE_INDEX', 'Archive index exceeds 32 MiB');
      return readFile(path);
    };
    let index;
    try { index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('index.json'))); }
    catch (error) {
      if (error instanceof WorldArchiveError) throw error;
      fail('E_ARCHIVE_INDEX', 'Invalid archive index JSON', error);
    }
    const reader = new ArchiveReader(index, read, bytes => createHash('sha256').update(bytes).digest('hex'), options);
    return { index: reader.index, read: () => reader.read(), readProjection: projection => reader.readProjection(projection), readCollection: (pointer, range) => reader.readCollection(pointer, range) };
  } catch (error) {
    if (error instanceof WorldArchiveError) throw error;
    fail('E_ARCHIVE_IO', 'Could not open world archive', error);
  }
}

export async function readWorldArchive(directory, options) {
  return (await openWorldArchive(directory, options)).read();
}
