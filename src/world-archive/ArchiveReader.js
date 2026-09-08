import { fail, WorldArchiveError } from './errors.js';
import { ownEntry, pointerChild } from './JsonValue.js';
import { freezeJson, pointerSegments, readOptions, validateIndex } from './IndexValidation.js';

function ancestors(pointers) {
  const result = new Set();
  for (const pointer of pointers) {
    let prefix = '';
    for (const key of pointerSegments(pointer)) {
      result.add(prefix);
      prefix = pointerChild(prefix, key);
    }
  }
  return result;
}

export class ArchiveReader {
  constructor(index, readBytes, digest, options) {
    this.index = freezeJson(validateIndex(index));
    this.readBytes = readBytes;
    this.digest = digest;
    this.concurrency = readOptions(options).concurrency;
    this.collections = new Map(index.collections.map(collection => [collection.pointer, collection]));
    this.branches = ancestors(this.collections.keys());
    this.active = 0;
    this.waiting = [];
  }

  async part(part) {
    if (this.active >= this.concurrency) await new Promise(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      const bytes = await this.readBytes(part.file, part.bytes);
      if (bytes.byteLength !== part.bytes || await this.digest(bytes) !== part.sha256) fail('E_ARCHIVE_HASH', `Part content differs: ${part.file}`);
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch (error) { fail('E_ARCHIVE_PART', `Invalid JSON part: ${part.file}`, error); }
      if (!Array.isArray(value) || value.length !== part.count) fail('E_ARCHIVE_PART', `Part count differs: ${part.file}`);
      return value;
    } catch (error) {
      if (error instanceof WorldArchiveError) throw error;
      fail('E_ARCHIVE_IO', `Could not read archive part: ${part.file}`, error);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  async hydrate(value, pointer, context, fromIndex = false) {
    const collection = this.collections.get(pointer);
    if (collection) {
      if (value !== null) fail('E_ARCHIVE_INDEX', `Expected collection placeholder: ${pointer || '/'}`);
      context?.visited.add(pointer);
      return this.collection(collection, 0, collection.count, context);
    }
    if (value === null || typeof value !== 'object') return value;
    if (!this.branches.has(pointer) && !context?.branches.has(pointer)) return fromIndex ? structuredClone(value) : value;
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const childPointer = pointerChild(pointer, index);
        if (context?.omit.has(childPointer)) fail('E_ARCHIVE_RANGE', 'Projection can omit object properties only');
        result.push(await this.hydrate(value[index], childPointer, context, fromIndex));
      }
      return result;
    }
    const result = {};
    for (const key of Object.keys(value)) {
      const childPointer = pointerChild(pointer, key);
      if (context?.omit.has(childPointer)) { context.omitted.add(childPointer); continue; }
      ownEntry(result, key, await this.hydrate(value[key], childPointer, context, fromIndex));
    }
    return result;
  }

  async collection(collection, start, end, context) {
    const wanted = collection.parts.filter(part => part.start < end && part.start + part.count > start);
    const result = [];
    for (let offset = 0; offset < wanted.length; offset += this.concurrency) {
      const batch = wanted.slice(offset, offset + this.concurrency);
      const values = await Promise.all(batch.map(part => this.part(part)));
      for (let partIndex = 0; partIndex < batch.length; partIndex++) {
        const part = batch[partIndex];
        const from = Math.max(start, part.start);
        const until = Math.min(end, part.start + part.count);
        for (let index = from; index < until; index++) {
          const childPointer = pointerChild(collection.pointer, index);
          if (context?.omit.has(childPointer)) fail('E_ARCHIVE_RANGE', 'Projection can omit object properties only');
          result.push(await this.hydrate(values[partIndex][index - part.start], childPointer, context));
        }
      }
    }
    return result;
  }

  async read() {
    return this.readProjection({ omit: [] });
  }

  async readProjection(projection = {}) {
    if (!projection || typeof projection !== 'object') fail('E_ARCHIVE_INPUT', 'Expected archive projection options');
    const { omit } = projection;
    if (!Array.isArray(omit)) fail('E_ARCHIVE_INPUT', 'Projection requires an omit array');
    for (const pointer of omit) {
      pointerSegments(pointer);
      if (pointer === '') fail('E_ARCHIVE_RANGE', 'Projection cannot omit the root');
    }
    const selected = [...new Set(omit)].filter(pointer => !omit.some(parent => pointer !== parent && pointer.startsWith(`${parent}/`)));
    const context = { visited: new Set(), omit: new Set(selected), omitted: new Set(), branches: ancestors(selected) };
    const value = await this.hydrate(this.index.root, '', context, true);
    const expected = [...this.collections.keys()].filter(pointer => !selected.some(parent => pointer === parent || pointer.startsWith(`${parent}/`))).length;
    if (context.visited.size !== expected) fail('E_ARCHIVE_INDEX', 'Archive contains unreachable collection descriptors');
    if (context.omitted.size !== selected.length) fail('E_ARCHIVE_RANGE', 'Unknown projection pointer');
    return value;
  }

  async locate(pointer) {
    let prefix = '';
    let value = this.index.root;
    for (const key of pointerSegments(pointer)) {
      const collection = this.collections.get(prefix);
      if (collection) {
        if (value !== null) fail('E_ARCHIVE_INDEX', `Expected collection placeholder: ${prefix || '/'}`);
        const index = Number(key);
        if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(index) || index >= collection.count) fail('E_ARCHIVE_RANGE', `Unknown collection index: ${pointer}`);
        const part = collection.parts.find(part => index >= part.start && index < part.start + part.count);
        value = (await this.part(part))[index - part.start];
      } else {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) fail('E_ARCHIVE_RANGE', `Unknown collection pointer: ${pointer}`);
        value = value[key];
      }
      prefix = pointerChild(prefix, key);
    }
    return value;
  }

  async readCollection(pointer, range = {}) {
    if (!range || typeof range !== 'object' || Array.isArray(range)) fail('E_ARCHIVE_RANGE', 'Expected a collection range');
    const value = await this.locate(pointer);
    const collection = this.collections.get(pointer);
    if (!collection && !Array.isArray(value)) fail('E_ARCHIVE_RANGE', `Pointer is not an array: ${pointer}`);
    if (collection && value !== null) fail('E_ARCHIVE_INDEX', `Expected collection placeholder: ${pointer || '/'}`);
    const count = collection ? collection.count : value.length;
    const { start = 0, end = count } = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > count) fail('E_ARCHIVE_RANGE', `Invalid collection range: ${pointer}`);
    if (collection) return this.collection(collection, start, end);
    const result = [];
    for (let index = start; index < end; index++) result.push(await this.hydrate(value[index], pointerChild(pointer, index), undefined, true));
    return result;
  }
}
