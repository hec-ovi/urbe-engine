import { afterEach, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { hashJson, iterateJsonBytes, openWorldArchive, readWorldArchive, writeWorldArchive } from '../index.js';
import { openWorldArchive as openBrowserArchive } from '../browser.js';

const directories = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'world-archive-'));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const fixture = () => ({
  meta: { seed: 'metropolis', position: [5000, 5000] },
  parcels: Array.from({ length: 27 }, (_, id) => ({ id: `p${id}`, polygon: [[id, 0], [id + 1, 0], [id + 1, 1], [id, 1]] })),
  streets: { proof: Array.from({ length: 17 }, (_, id) => ({ id, values: Array.from({ length: 150 }, (_, x) => [x, x / 7]) })) },
});

function fetchFiles(directory, requests, observe = () => {}) {
  let active = 0;
  return async url => {
    requests.push(String(url));
    observe(++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      const file = String(url).replace('/world/', '');
      try { return new Response(await readFile(join(directory, file))); }
      catch { return new Response('', { status: 404 }); }
    } finally { active--; }
  };
}

describe('WorldArchive public storage and read contract', () => {
  test('preserves a document larger than its part budget and validates the persisted schema', async () => {
    const path = await directory();
    const source = fixture();
    const index = await writeWorldArchive(source, path, { maxRecords: 4, maxPartBytes: 1024 });
    const schema = JSON.parse(await readFile(new URL('../schema/index.schema.json', import.meta.url), 'utf8'));
    expect(new Ajv2020().compile(schema)(index)).toBe(true);
    expect(index.json.bytes).toBeGreaterThan(30 * 1024);
    expect(index.collections.flatMap(collection => collection.parts).every(part => part.bytes <= 1024)).toBe(true);
    expect(index.collections.some(collection => collection.pointer === '/parcels')).toBe(true);
    expect(index.collections.some(collection => /polygon/.test(collection.pointer))).toBe(false);
    expect(JSON.stringify(await readWorldArchive(path))).toBe(JSON.stringify(source));
    expect(index.json).toEqual(hashJson(source));
    const other = await directory();
    await writeWorldArchive(source, other, { maxRecords: 4, maxPartBytes: 1024 });
    expect(await readFile(join(path, 'index.json'))).toEqual(await readFile(join(other, 'index.json')));
  });

  test('matches native JSON omission, property, unicode, toJSON and scalar semantics', async () => {
    const source = JSON.parse('{"__proto__":{"safe":true},"a/b~c":[1,2,3],"2":"two","1":"one"}');
    Object.assign(source, { absent: undefined, fn() {}, array: [undefined, NaN, Infinity, -0, Symbol()], date: new Date('2026-01-02T00:00:00Z'), unicode: `${'a'.repeat(8191)}😀\ud800\n`, number: new Number(7) });
    const expected = `${JSON.stringify(source)}\n`;
    expect(Buffer.concat([...iterateJsonBytes(source)]).toString()).toBe(expected);
    expect(hashJson(source)).toEqual({ bytes: Buffer.byteLength(expected), sha256: createHash('sha256').update(expected).digest('hex') });
    const path = await directory();
    const index = await writeWorldArchive(source, path);
    expect(index.json).toEqual(hashJson(source));
    expect(`${JSON.stringify(await readWorldArchive(path))}\n`).toBe(expected);
    expect(await (await openWorldArchive(path)).readCollection('/a~1b~0c', { start: 1 })).toEqual([2, 3]);
    let calls = 0;
    const stateful = { value: { toJSON() { return ++calls; } } };
    const second = await directory();
    const result = await writeWorldArchive(stateful, second);
    expect(calls).toBe(1);
    expect(result.json).toEqual(hashJson({ value: 1 }));
  });

  test('selects overlapping parts and explicitly omits producer data without fetching it', async () => {
    const path = await directory();
    const source = fixture();
    await writeWorldArchive(source, path, { maxRecords: 4, maxPartBytes: 1024 });
    const requests = [];
    let maximum = 0;
    const reader = await openBrowserArchive('/world/index.json', { fetch: fetchFiles(path, requests, active => { maximum = Math.max(active, maximum); }), concurrency: 2 });
    expect(Object.isFrozen(reader.index.root.meta)).toBe(true);
    expect(await reader.readCollection('/parcels', { start: 5, end: 7 })).toEqual(source.parcels.slice(5, 7));
    expect(requests).toHaveLength(2);
    expect(await reader.readCollection('/parcels/5/polygon', { start: 1, end: 3 })).toEqual(source.parcels[5].polygon.slice(1, 3));
    requests.splice(0);
    expect(await reader.readProjection({ omit: ['/streets/proof'] })).toEqual({ meta: source.meta, parcels: source.parcels, streets: {} });
    const omittedFiles = new Set(reader.index.collections.filter(collection => collection.pointer.startsWith('/streets/proof')).flatMap(collection => collection.parts.map(part => `/world/${part.file}`)));
    expect(requests.some(url => omittedFiles.has(url))).toBe(false);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(await reader.read()).toEqual(source);
  });

  test('rejects corrupt bytes before parsing and missing or malformed parts', async () => {
    const path = await directory();
    await writeWorldArchive({ rows: [{ id: 1 }, { id: 2 }] }, path, { maxRecords: 1 });
    const index = JSON.parse(await readFile(join(path, 'index.json'), 'utf8'));
    const part = index.collections[0].parts[0];
    const original = await readFile(join(path, part.file));
    await writeFile(join(path, part.file), original.toString().replace('1', '9'));
    await expect(readWorldArchive(path)).rejects.toMatchObject({ code: 'E_ARCHIVE_HASH' });
    const browser = await openBrowserArchive('/world/index.json', { fetch: fetchFiles(path, []) });
    await expect(browser.read()).rejects.toMatchObject({ code: 'E_ARCHIVE_HASH' });
    await rm(join(path, part.file));
    await expect(readWorldArchive(path)).rejects.toMatchObject({ code: 'E_ARCHIVE_PART' });
    const wrong = Buffer.from('{}\n');
    await writeFile(join(path, part.file), wrong);
    part.bytes = wrong.length; part.sha256 = createHash('sha256').update(wrong).digest('hex');
    await writeFile(join(path, 'index.json'), JSON.stringify(index));
    await expect(readWorldArchive(path)).rejects.toMatchObject({ code: 'E_ARCHIVE_PART' });
  });

  test('rejects invalid inputs, ranges, indices and unsafe paths without publishing partial data', async () => {
    const path = await directory();
    const circular = {}; circular.loop = circular;
    await expect(writeWorldArchive(circular, path)).rejects.toMatchObject({ code: 'E_ARCHIVE_INPUT' });
    await expect(readFile(join(path, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(writeWorldArchive({ value: 'x'.repeat(100) }, path, { maxPartBytes: 64 })).rejects.toMatchObject({ code: 'E_ARCHIVE_SIZE' });
    await writeWorldArchive({ rows: [{ x: 1 }, { x: 2 }] }, path, { maxRecords: 1 });
    await expect(writeWorldArchive({}, path)).rejects.toMatchObject({ code: 'E_ARCHIVE_INPUT' });
    const reader = await openWorldArchive(path);
    await expect(reader.readCollection('/rows', { end: 3 })).rejects.toMatchObject({ code: 'E_ARCHIVE_RANGE' });
    await expect(reader.readProjection({ omit: ['/rows/0'] })).rejects.toMatchObject({ code: 'E_ARCHIVE_RANGE' });
    await expect(reader.readProjection({ omit: ['/absent'] })).rejects.toMatchObject({ code: 'E_ARCHIVE_RANGE' });
    const index = JSON.parse(await readFile(join(path, 'index.json'), 'utf8'));
    index.collections[0].parts[0].file = '../outside.json';
    await writeFile(join(path, 'index.json'), JSON.stringify(index));
    await expect(openWorldArchive(path)).rejects.toMatchObject({ code: 'E_ARCHIVE_INDEX' });
    await expect(openWorldArchive(join(path, 'missing'))).rejects.toMatchObject({ code: 'E_ARCHIVE_IO' });
  });
});
