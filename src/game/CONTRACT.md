# CONTRACT: game (engine inner box)

Purpose: plays the assembled city as a first-person world at street level, at night, from generated data only.

## In
- `?mode=game` on the vite app, with the run described entirely by the URL query:
  - `world` (default `city-urbe-tiny`): atlas sample name, loaded from `/atlas/<world>.json`
  - `out` (default `/out/city-tiny`): the `assemble-city` output directory to read buildings from
  - `backend` (`webgpu` default, `webgl`)
  - `hour` (0-23, default 21): world clock start
  - `crowd` (default 200), `cars` (default 18): instance capacity
  - `stress` (default 0, max 40): debug only, repeats each real street agent N times over nearby walk edges to load-test the crowd renderer. Off in every normal run.
- Atlas blueprint per ../../../atlas/CONTRACT.md.
- Connections document, generated in-process from that blueprint by `connectionsRunner.js`; `signalStateAt` is consumed directly for signal state.
- Per parcel under `<out>/<id>/`: the exterior blueprint, and `interior/building.glb` plus `interior/npc.json`. A parcel with no assembled building is reported as unbuilt, never an error.
- Materials theme database under `/materials/<theme>` per ../../../materials/CONTRACT.md.
- CC0 character, animation and vehicle packs under `/models`, served from `URBE_MODELS_DIR` (default `<home>/models/quaternius`).

## Out
- A walkable city: pointer-lock mouse look, WASD at 1.4 m/s, 4 m/s on shift, eye height 1.7 m, gravity and collision through Rapier.
- `GameApp.tick(delta)`: one deterministic step of clock, physics, agents, interaction and render. The animation loop calls it with real elapsed time; a harness with no display can call it directly.
- HUD under `src/ui`: clock and district, interact prompt, position readout, about line naming every loaded path, NPC panel, pause menu, performance readout.

## What the world is made of
- **Ground**: the blueprint's `volumetric.ground` cover. Roadway at y=0, sidewalk, block and open areas at y=0.12, every raised surface ringed by a curb skirt down to y=-0.06 so no height step can open a gap. One merged mesh per material; roadway takes a wet finish (low roughness, high environment intensity).
- **Buildings**: every assembled merged GLB. Shells merge across the whole city by material key, so the skyline costs one draw call per key. Each building's interior stays a group at its real world position **in the same scene**: entering is walking through a door, never a load or a swap. Interiors are hidden and their colliders dropped beyond a radius, and come back before the player can see in.
- **Doors**: the ground-floor `door` opening from each exterior blueprint. Its leaf is split out of the shell geometry into a hinged pivot and swings 100 degrees on E.
- **Neon**: the exterior layer emits no signage, so the game hangs it: blade signs and ad screens on the facade each parcel's street access faces, textured by the materials database's emissive `signage` and `ad-screen` entries; lit window panes behind a deterministic share of every window opening, coloured by building type; emissive lane strips down the connections lane centrelines; lamp posts along every street. A fixed pool of point lights follows the nearest sign and lamp positions, so real light on the road costs the same in a village and a city.
- **Sky**: `SkyMesh` with the sun below the horizon, `FogExp2` in the same colour, a moon key, stars, and one PMREM bake into `scene.environment`.

## Physics
- Rapier 0.20, fixed 1/60 step. Ground and every building shell are fixed trimeshes built once; the shells carry their real door and window openings, so a doorway is walkable with no special case. Interior trimeshes load within 55 m and drop past 75 m.
- Player: capsule collider driven by `KinematicCharacterController` with autostep (0.42 m, which is what makes curbs and interior stairs walkable) and snap-to-ground.

## People and traffic
- Population is the simulation library's, never invented here. The city crowd slice is the authoritative set of people on the street; those whose walk edge is near the player are spawned where the simulation says they are and then walk the connections walk graph at 1.4 m/s, holding at signalled crossings until the walk phase. The parcel crowd slice adds each nearby building's on-duty staff, standing in its lobby.
- Every person keeps its `crowdId`. Talking instantiates it, interrupts its routine, shows the identity and weekly routine the simulation returns, and resumes it on close.
- Rendering: animation clips are baked once into vertex animation buffers, so the whole crowd is 4 draw calls (two models, body and hair) and no skeletons at any population. Measured: 0.02-0.2 ms of CPU per frame from 10 to 260 people.
- Cars drive the connections lane graph at each lane's posted speed, take a turn connection at the end and hold at a red. Two instanced draws per model.

## Errors
The whole run either starts or reports why: any failure during startup is caught and shown on the loading panel with its message. There is no partial world.

## Invariants
- Only generated data is rendered: no placeholder geometry, no invented population, no untextured surface outside the deliberate light emitters.
- Interiors are continuous with the street: same scene, real world position, no loading screen and no camera jump.
- The player cannot pass through a building shell and cannot fall through the ground.
- The crowd's draw call count does not grow with the number of people.

## Depends on
- ../../../atlas/CONTRACT.md, ../../../connections/CONTRACT.md, ../../../materials/CONTRACT.md, ../../../simulation/CONTRACT.md
- ../assembly/CONTRACT.md for the assembled world on disk
