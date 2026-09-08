import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, WorldArchiveError } from './errors.js';
import { iterateJsonBytes, jsonValue, numericTuple, ownEntry, pointerChild } from './JsonValue.js';
import { freezeJson, validateIndex } from './IndexValidation.js';

const bytes = value => Buffer.byteLength(JSON.stringify(value));

export function hashJson(value) {
  const hash = createHash('sha256');
  let bytes = 0;
  for (const chunk of iterateJsonBytes(value)) { hash.update(chunk); bytes += chunk.byteLength; }
  return { sha256: hash.digest('hex'), bytes };
}

export class ArchiveWriter {
  constructor(directory, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('E_ARCHIVE_INPUT', 'Expected archive write options');
    const { maxRecords = 100, maxPartBytes = 4 * 1024 * 1024 } = options;
    if (typeof directory !== 'string' || !directory || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxPartBytes) || maxPartBytes < 64) {
      fail('E_ARCHIVE_INPUT', 'Expected a directory, positive maxRecords and maxPartBytes of at least 64');
    }
    this.directory = directory;
    this.maxRecords = maxRecords;
    this.maxPartBytes = maxPartBytes;
    this.collections = [];
    this.seen = new Set();
    this.partNumber = 0;
    this.originalHash = createHash('sha256');
    this.originalBytes = 0;
    this.pendingHash = '';
  }

  async write(value) {
    let prepared = false;
    try {
      await mkdir(this.directory, { recursive: true });
      if ((await readdir(this.directory)).length) fail('E_ARCHIVE_INPUT', 'Archive directory must be empty');
      await mkdir(join(this.directory, 'parts'));
      prepared = true;
      const root = await this.encode(value, '', '', false);
      this.hashToken('\n');
      this.flushHash();
      const index = {
        format: 'urbe-world-archive', version: '1.0.0',
        json: { sha256: this.originalHash.digest('hex'), bytes: this.originalBytes }, root: root.value,
        collections: this.collections.sort((a, b) => a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0),
      };
      validateIndex(index);
      const chunks = [];
      let size = 0;
      for (const chunk of iterateJsonBytes(index)) {
        size += chunk.byteLength;
        if (size > 32 * 1024 * 1024) fail('E_ARCHIVE_SIZE', 'Archive index exceeds 32 MiB');
        chunks.push(chunk);
      }
      await writeFile(join(this.directory, '.index.json'), Buffer.concat(chunks));
      await rename(join(this.directory, '.index.json'), join(this.directory, 'index.json'));
      return freezeJson(index);
    } catch (error) {
      if (prepared) await rm(this.directory, { recursive: true, force: true });
      if (error instanceof WorldArchiveError) throw error;
      fail('E_ARCHIVE_IO', 'Could not write world archive', error);
    }
  }

  hashToken(token) {
    this.pendingHash += token;
    if (this.pendingHash.length >= 16384) this.flushHash();
  }

  flushHash() {
    this.originalHash.update(this.pendingHash);
    this.originalBytes += Buffer.byteLength(this.pendingHash);
    this.pendingHash = '';
  }

  async encode(input, pointer, key, arrayEntry, normalized = false, arrayDepth = 0) {
    let value = normalized ? input : jsonValue(input, key);
    if (value === undefined) {
      if (arrayEntry) value = null;
      else fail('E_ARCHIVE_INPUT', `No JSON representation at ${pointer || '/'}`);
    }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && Buffer.byteLength(value) > this.maxPartBytes) fail('E_ARCHIVE_SIZE', `Scalar exceeds part budget at ${pointer || '/'}`);
      const token = JSON.stringify(value);
      const size = Buffer.byteLength(token);
      if (size + 3 > this.maxPartBytes) fail('E_ARCHIVE_SIZE', `Scalar exceeds part budget at ${pointer || '/'}`);
      this.hashToken(token);
      return { value, bytes: size };
    }
    const tuple = numericTuple(value);
    if (tuple) {
      const token = JSON.stringify(tuple);
      const size = Buffer.byteLength(token);
      if (size + 3 <= this.maxPartBytes) { this.hashToken(token); return { value: tuple, bytes: size }; }
    }
    if (this.seen.has(value)) fail('E_ARCHIVE_INPUT', `Circular value at ${pointer || '/'}`);
    this.seen.add(value);
    const result = Array.isArray(value)
      ? await this.array(value, pointer, arrayDepth)
      : await this.object(value, pointer, arrayDepth);
    this.seen.delete(value);
    return result;
  }

  async object(value, pointer, arrayDepth) {
    const result = {};
    let size = 2;
    let count = 0;
    this.hashToken('{');
    for (const key of Object.keys(value)) {
      const input = jsonValue(value[key], key);
      if (input === undefined) continue;
      if (Buffer.byteLength(key) > this.maxPartBytes) fail('E_ARCHIVE_SIZE', `Object key exceeds part budget at ${pointer || '/'}`);
      const field = JSON.stringify(key);
      if (count++) { size++; this.hashToken(','); }
      this.hashToken(field); this.hashToken(':');
      const child = await this.encode(input, pointerChild(pointer, key), key, false, true, arrayDepth);
      size += Buffer.byteLength(field) + 1 + child.bytes;
      ownEntry(result, key, child.value);
    }
    this.hashToken('}');
    if (size + 3 > this.maxPartBytes) {
      const arrays = this.inlineArrays(result, pointer).sort((a, b) => b.bytes - a.bytes);
      for (const array of arrays) {
        if (size + 3 <= this.maxPartBytes) break;
        await this.externalize(array.value, array.pointer);
        ownEntry(array.parent, array.key, null);
        size += 4 - array.bytes;
      }
    }
    if (size + 3 > this.maxPartBytes) fail('E_ARCHIVE_SIZE', `Record exceeds part budget at ${pointer || '/'}`);
    return { value: result, bytes: size };
  }

  inlineArrays(value, pointer) {
    const result = [];
    for (const key of Object.keys(value)) {
      const child = value[key];
      const childPointer = pointerChild(pointer, key);
      if (Array.isArray(child)) {
        if (child.length) result.push({ parent: value, key, pointer: childPointer, value: child, bytes: bytes(child) });
      } else if (child !== null && typeof child === 'object') result.push(...this.inlineArrays(child, childPointer));
    }
    return result;
  }

  async array(value, pointer, arrayDepth) {
    const length = value.length;
    const recordCollection = arrayDepth === 0 && length > this.maxRecords && value.some(entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
    let external = recordCollection;
    let entries = [];
    let size = 2;
    let offset = 0;
    const descriptor = { pointer, count: length, parts: [] };
    const flush = async () => {
      if (!entries.length) return;
      descriptor.parts.push(await this.part(entries, offset));
      offset += entries.length;
      entries = []; size = 2;
    };
    this.hashToken('[');
    for (let index = 0; index < length; index++) {
      if (index) this.hashToken(',');
      const child = await this.encode(value[index], pointerChild(pointer, index), String(index), true, false, arrayDepth + 1);
      if (size + child.bytes + (entries.length ? 1 : 0) + 1 > this.maxPartBytes) {
        external = true;
        await flush();
      }
      entries.push(child.value);
      size += child.bytes + (entries.length > 1 ? 1 : 0);
      if (external && recordCollection && entries.length === this.maxRecords) await flush();
    }
    this.hashToken(']');
    if (!external) return { value: entries, bytes: size };
    await flush();
    this.collections.push(descriptor);
    return { value: null, bytes: 4 };
  }

  async externalize(array, pointer) {
    const descriptor = { pointer, count: array.length, parts: [] };
    let entries = [];
    let size = 2;
    let offset = 0;
    for (const value of array) {
      const next = bytes(value);
      if (entries.length && size + next + 2 > this.maxPartBytes) {
        descriptor.parts.push(await this.part(entries, offset));
        offset += entries.length; entries = []; size = 2;
      }
      entries.push(value); size += next + (entries.length > 1 ? 1 : 0);
    }
    if (entries.length) descriptor.parts.push(await this.part(entries, offset));
    this.collections.push(descriptor);
  }

  async part(entries, start) {
    const data = Buffer.from(`${JSON.stringify(entries)}\n`);
    if (data.byteLength > this.maxPartBytes) fail('E_ARCHIVE_SIZE', 'Collection part exceeds byte budget');
    const file = `parts/${String(this.partNumber++).padStart(8, '0')}.json`;
    await writeFile(join(this.directory, file), data);
    return { file, start, count: entries.length, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
  }
}
