# urbe-engine

Version 0.22.0. Loads an assembled city into a first-person Three.js game with streamed buildings, physics, NPCs, quests and revisioned saves.

## Run

```sh
npm install
npm run play -- --port 5306
```

Open [the launcher](http://localhost:5306/). It lists cities and saved games, imports and exports descriptors, and calls creation APIs for optional interiors and stories. A game with `questBundle: null` supports free play.

`npm run dev` enables source reloads. `npm run build` builds the browser client; the development HTTP routes and resource mounts require the Vite server. `npm test` runs the contract suites, including local HTTP listeners.

## Call

[SKILL.md](SKILL.md) gives a copyable catalog-to-play example. [CONTRACT.md](CONTRACT.md) links requests, results and errors. [docs/INDEX.md](docs/INDEX.md) maps runtime responsibilities.

- `/?mode=game&game=<id>` restores a catalog game. `/?mode=game&out=/out/<world>` opens a session-only preview.
- `npm run assemble -- --parcel <id> --blueprint <path> --out <dir>` builds one parcel; `--interior` adds its interior.
- `npm run assemble-city -- --blueprint <path> --out <dir>` builds a city. Options and output layout: [Assembly](src/assembly/CONTRACT.md).
- Building, city, scale and street-prop previews: [preview interfaces](CONTRACT.md#previews).

## Resources

The server mounts sibling Materials catalogs, Atlas samples and Engine `out/`. `URBE_ATLAS_DIR` overrides the sample directory. `URBE_MODELS_DIR` selects character, animation and prop assets, default `~/models/quaternius`. [Character installation](src/game/agents/CONTRACT.md) and [prop installation](src/game/props/CONTRACT.md) describe their audited stores.

Text dialogue uses `LLM_BASE_URL` (default `http://localhost:8080/v1`) and `LLM_MODEL` (default first advertised model). Prompts come from Quests.

Exports contain JSON descriptors and references. Asset packaging and complete-game portability are open in [docs/ISSUES.md](docs/ISSUES.md). Crowd and car capacities default to zero; explicit `crowd` and `cars` query values enable them. Large-world moving performance remains an acceptance task.
