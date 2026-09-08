import { fail } from './errors.js';

export const pointerChild = (pointer, key) => `${pointer}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

export function jsonValue(value, key) {
  if (value !== null && ['object', 'function', 'bigint'].includes(typeof value) && typeof value.toJSON === 'function') value = value.toJSON(key);
  if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
  if (typeof value === 'bigint' || value instanceof BigInt) fail('E_ARCHIVE_INPUT', 'BigInt has no JSON representation');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'object' ? value : undefined;
}

export function ownEntry(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}

export function numericTuple(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const tuple = [];
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, index);
    if (!entry || typeof entry.value !== 'number') return null;
    tuple.push(Number.isFinite(entry.value) ? entry.value : null);
  }
  return tuple;
}

function* stringTokens(value) {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 8192, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

export function* jsonTokens(input) {
  const seen = new Set();
  function* visit(value, key, arrayEntry = false, normalized = false) {
    if (!normalized) value = jsonValue(value, key);
    if (value === undefined) {
      if (arrayEntry) { yield 'null'; return; }
      fail('E_ARCHIVE_INPUT', 'Root value has no JSON representation');
    }
    if (typeof value === 'string') { yield* stringTokens(value); return; }
    if (value === null || typeof value !== 'object') { yield JSON.stringify(value); return; }
    const tuple = numericTuple(value);
    if (tuple) { yield JSON.stringify(tuple); return; }
    if (seen.has(value)) fail('E_ARCHIVE_INPUT', 'Circular values have no JSON representation');
    seen.add(value);
    if (Array.isArray(value)) {
      const length = value.length;
      yield '[';
      for (let index = 0; index < length; index++) {
        if (index) yield ',';
        yield* visit(value[index], String(index), true);
      }
      yield ']';
    } else {
      yield '{';
      let first = true;
      for (const field of Object.keys(value)) {
        const entry = jsonValue(value[field], field);
        if (entry === undefined) continue;
        if (!first) yield ',';
        first = false;
        yield* stringTokens(field); yield ':';
        yield* visit(entry, field, false, true);
      }
      yield '}';
    }
    seen.delete(value);
  }
  yield* visit(input, '');
  yield '\n';
}

export function* iterateJsonBytes(value) {
  const encoder = new TextEncoder();
  let pending = '';
  for (const token of jsonTokens(value)) {
    pending += token;
    if (pending.length >= 16384) { yield encoder.encode(pending); pending = ''; }
  }
  if (pending) yield encoder.encode(pending);
}
