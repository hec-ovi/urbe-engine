# urbe-engine

The assembler and the game client. It turns every generated layer of a city (blueprint, links, building shells, interiors, materials, population, names, questlines) into one world on disk, then plays that world first person at street level in the browser on three.js WebGPU.

Only generated data is rendered. No placeholder geometry, no invented population, no untextured surface outside the deliberate light emitters.

## Run

```
npm install
npm run assemble-city -- --blueprint ../atlas/samples/city-urbe-small.json --out out/city --workers 8
npm run dev            # then open /?mode=game
npm test
```

Other commands:

- `npm run assemble -- --parcel <id> --out <dir> [--glb merged|named] [--interior]` builds a single parcel end to end.
- `npm run simulate` boots the population over an assembled world and prints stats, a crowd slice, three NPC lives, latencies and a conservation check.
- `npm run build` produces the static client.

The client has three modes on one vite app: `?mode=game` plays the city, `?mode=building&parcel=<id>` inspects one assembled building textured through the material database, and no mode runs the city render scale comparison.

## Assembly

`assemble-city` runs the link layer once over the blueprint, then the per-parcel pipeline in parallel workers: it derives a building request from the parcel and its apertures, picks a floor count guaranteed feasible by the exterior recipe, generates the shell, gates the interior on the core feasibility surface, and writes `<out>/<parcelId>/` with the exterior blueprint plus `interior/building.glb`, `interior/floors/*.json` and `interior/npc.json`. A QA report lists every parcel that failed and why, verbatim. Interiors are requested in `keys` texture mode, so the runtime resolves materials itself.

## The game

`?mode=game` takes its whole run from the URL: `world` (atlas sample), `out` (assembled directory), `backend` (`webgpu` default, `webgl`), `hour` (world clock, default 21), `crowd` and `cars` (instance capacity).

- **Streets** are the blueprint's ground cover: roadway with a wet finish, sidewalks and blocks raised 12 cm, every raised surface ringed by a curb skirt so no height step opens a gap.
- **Buildings** merge across the city by material key, so the skyline costs one draw call per key. Each interior stays a group at its real world position in the same scene, so entering a building means walking through its door with no load and no camera jump. Ground floor doors split their leaf out of the shell into a hinged pivot and swing on E.
- **Neon** is hung by the game: blade signs and ad screens on the facade each parcel's street access faces, lit window panes behind a deterministic share of the windows, emissive lane strips along the lane centerlines, lamp posts down every street. A fixed pool of point lights follows the nearest signs and lamps, so real light on the road costs the same in a village and in a city.
- **People** are the population library's, never invented here. Pedestrians walk the real walk graph at 1.4 m/s and hold at signalled crossings until the walk phase; each building's on-duty staff stand in its lobby. Talking to one instantiates it, interrupts its routine, shows the identity and weekly routine the library returns, and resumes it on close. Animation clips bake once into vertex animation buffers, so the whole crowd is 4 draw calls at any population, measured at 0.02 to 0.2 ms of CPU per frame from 10 to 260 people.
- **Cars** drive the lane graph at each lane's posted speed, take a turn connection at the end and hold at a red.
- **Movement** is a Rapier capsule with a kinematic character controller: pointer-lock mouse look, WASD at 1.4 m/s and 4 m/s on shift, eye height 1.7 m, autostep that makes curbs and interior stairs walkable. Building shells are trimeshes carrying their real door and window openings, so a doorway needs no special case. Interior colliders load within 55 m and drop past 75 m.
- **HUD**: clock and district, interact prompt, position readout, an about line naming every loaded path, the NPC panel, a pause menu and a live performance readout.

Character, animation and vehicle packs are CC0 assets kept in a model store outside the repo, served from `URBE_MODELS_DIR`.

A run either starts or reports the failure: anything that goes wrong during startup is caught and shown on the loading panel with its message. There is no partial world.

## In the urbe family

It depends on every other box: the plan from [urbe-atlas](../urbe-atlas), links and networks from [urbe-transit](../urbe-transit), shells from [buildingforge](../buildingforge), interiors from [interiorforge](../interiorforge), textures from [pbrforge](../pbrforge), people from [urbe-population](../urbe-population), names from [urbe-namer](../urbe-namer) and stories from [urbe-quests](../urbe-quests). The full picture lives in [urbe](../urbe).
