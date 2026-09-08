import { fail } from './errors.js';

const hash = /^[a-f0-9]{64}$/;
const partPath = /^parts\/\d{8,}\.json$/;
const pointerPattern = /^(?:\/(?:[^~]|~[01])*)*$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

export function validateIndex(index) {
  if (!keys(index, ['format', 'version', 'json', 'root', 'collections']) || index.format !== 'urbe-world-archive' || index.version !== '1.0.0') {
    fail('E_ARCHIVE_INDEX', 'Unsupported world archive index');
  }
  if (!keys(index.json, ['sha256', 'bytes']) || !hash.test(index.json.sha256) || !positive(index.json.bytes) || !Array.isArray(index.collections)) {
    fail('E_ARCHIVE_INDEX', 'Invalid original JSON binding or collection list');
  }
  const pointers = new Set();
  const paths = new Set();
  for (const collection of index.collections) {
    if (!keys(collection, ['pointer', 'count', 'parts']) || typeof collection.pointer !== 'string' || !pointerPattern.test(collection.pointer) || !count(collection.count) || !Array.isArray(collection.parts) || pointers.has(collection.pointer)) {
      fail('E_ARCHIVE_INDEX', 'Invalid or repeated collection pointer');
    }
    pointers.add(collection.pointer);
    let offset = 0;
    for (const part of collection.parts) {
      if (!keys(part, ['file', 'start', 'count', 'bytes', 'sha256']) || typeof part.file !== 'string' || !partPath.test(part.file) || paths.has(part.file) || part.start !== offset || !positive(part.count) || !positive(part.bytes) || !hash.test(part.sha256)) {
        fail('E_ARCHIVE_INDEX', `Invalid collection part at ${collection.pointer || '/'}`);
      }
      offset += part.count;
      paths.add(part.file);
    }
    if (offset !== collection.count) fail('E_ARCHIVE_INDEX', `Collection counts differ at ${collection.pointer || '/'}`);
  }
  return index;
}

export function freezeJson(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function readOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('E_ARCHIVE_INPUT', 'Expected archive read options');
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) fail('E_ARCHIVE_INPUT', 'Concurrency must be an integer from 1 to 32');
  return { concurrency };
}

export function pointerSegments(pointer) {
  if (typeof pointer !== 'string' || !pointerPattern.test(pointer)) fail('E_ARCHIVE_RANGE', 'Expected a JSON pointer');
  return pointer === '' ? [] : pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}
