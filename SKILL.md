---
name: urbe-engine
description: Load and play an assembled Urbe city, or call its launcher, creation, preview, dialogue and save APIs.
---

# Urbe Engine

Version 0.23.0. Engine loads city artifacts into a first-person game with streaming, physics, NPCs, quests and saved progress.

## Call

Run `npm run play -- --port 5306` from the repository. Use `POST /api/launcher` for catalog operations, then open the returned play URL. Creation and single-building assembly are separate calls described in [CONTRACT.md](CONTRACT.md).

Launcher JSON has `method` (required, no default) and `input` (omitted only for `catalog`). `continueGame`, `exportGame` and `exportCity` take an existing ID. `importGame` takes a game descriptor; `saveCurrent` takes a live save payload. All creation fields and defaults are linked from the [request schema](src/server/schema/launcher-request.schema.json).

## Play parameters

Query values are strings; [the query and parsed-setting types](src/game/data/schema/game-config.d.ts) give the complete fields and limits.

| Field | Default | Meaning |
| --- | --- | --- |
| `mode` | launcher | `game` enters play |
| `game` | absent | Catalog ID; restores its directory and save |
| `out` | `/out/city-tiny` | Preview artifact directory; ignored with `game` |
| `world` | `city-urbe-tiny` | Atlas sample fallback for a direct preview |
| `backend` | `webgpu` | `webgl` selects WebGL2 |
| `quality` | backend default | High on WebGPU, low on WebGL2; medium and ultra also supported |
| `hour` | `21` | Start world hour, 0-23; saved world time takes precedence; lighting stays at 21 |
| `crowd`, `cars` | `0`, `0` | Capacities, each 0-600; not guaranteed visible counts |
| `crowdRadius`, `carRadius` | `90`, `110` | Population radius in metres, 1-10000 |
| `density` | `1` | Population scale, 0-8 |
| `exposure`, `fog` | `0.024`, `0.0003` | Exposure 0.005-4, fog density 0-0.05 |
| `lanes`, `stress`, `off` | `paint`, `0`, empty | Diagnostics: lane mode, repeated crowd bodies (0-40), omitted rendering stages |

## Response and errors

`catalog` returns `{games,cities}`; `continueGame` returns `{playUrl}`. Other result schemas are linked in [CONTRACT.md](CONTRACT.md). Playing grants input after startup preparation. Invalid or missing content leaves a visible loading error. A free-play descriptor has `questBundle: null`.

Launcher failures return a non-2xx response with `{code,message}`. Codes include missing game/city, invalid descriptor, unsafe path, missing reference, revision conflict, unavailable creation and storage failure. The [contract](CONTRACT.md#errors) lists the declared sets and dependency-error limitation. Never overwrite a save after a revision conflict; reload its acknowledged descriptor first.

## Worked example

With the server running and a game already in its catalog, this prints its play URL without creating or modifying content:

```sh
node --input-type=module <<'JS'
const base = 'http://localhost:5306';
async function call(method, input) {
  const response = await fetch(`${base}/api/launcher`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({method, ...(input === undefined ? {} : {input})})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}
const {games} = await call('catalog');
const game = games.find(game => game.playable);
if (!game) throw new Error('The catalog contains no playable game.');
const {playUrl} = await call('continueGame', game.id);
console.log(new URL(playUrl, base).href);
JS
```
