# CONTRACT: game (engine inner box)

Purpose: plays the assembled city as a first-person world at street level, at night, from generated data only.

## In
- `?mode=game` on the vite app, with the run described entirely by the URL query:
  - `world` (default `city-urbe-tiny`): atlas sample name, loaded from `/atlas/<world>.json`
  - `out` (default `/out/city-tiny`): the `assemble-city` output directory to read buildings from
  - `backend` (`webgpu` default, `webgl`)
  - `hour` (0-23, default 21): world clock start
  - `crowd` (default 200), `cars` (default 18): instance capacity
  - `density` (default 1): the simulation's `params.streetDensity`, the researched share of the population out in public space
  - `stress` (default 0, max 40): debug only, repeats each real street agent N times over nearby walk edges to load-test the crowd renderer. Off in every normal run.
  - `lanes=debug` paints every lane of the road graph end to end, `lanes=glow` restores the teal emissive centreline strips. Debug only; a normal run gets painted road markings.
- Atlas blueprint per ../../../atlas/CONTRACT.md.
- Connections document, generated in-process from that blueprint by `connectionsRunner.js`; `signalStateAt` is consumed directly for signal state.
- `<out>/manifest.json` (../assembly/CONTRACT.md): which blueprint the directory was assembled from and which parcels finished. It is the only list of buildings the game reads, so a folder left behind by an older blueprint is never loaded on top of the city that replaced it. A missing manifest, or one from another blueprint, fails the run with what to re-run.
- Per parcel the manifest names, under `<out>/<id>/`: the exterior blueprint, and `interior/building.glb` plus `interior/npc.json`. A blueprint parcel the manifest does not name is reported as unbuilt, never an error.
- Materials theme database under `/materials/<theme>` per ../../../materials/CONTRACT.md.
- CC0 character, animation and vehicle packs under `/models`, served from `URBE_MODELS_DIR` (default `<home>/models/quaternius`).

## Out
- A walkable city: pointer-lock mouse look, WASD at 1.4 m/s, 4 m/s on shift, eye height 1.7 m, gravity and collision through Rapier. W walks along the look direction, A and D strafe left and right of it.
- `GameApp.tick(delta)`: one deterministic step of clock, physics, agents, interaction and render. The animation loop calls it with real elapsed time; a harness with no display can call it directly.
- HUD under `src/ui`: clock and district, interact prompt, position readout, about line naming every loaded path, NPC panel, pause menu, performance readout.

## What the world is made of
- **Ground**: the blueprint's `volumetric.ground` cover. Roadway at y=0, sidewalk, block and open areas at y=0.12, every raised surface ringed by a curb skirt down to y=-0.06 so no height step can open a gap. One merged mesh per material; the roadway takes a damp finish, which is a darker albedo and a mildly lowered roughness over a damped grain, because a mirror finish over an asphalt normal map turns every chip of aggregate into a specular point and the street sparkles.
- **Buildings**: every assembled merged GLB. Shells merge across the whole city by material key, so the skyline costs one draw call per key. Each building's interior stays a group at its real world position **in the same scene**: entering is walking through a door, never a load or a swap. Interiors are hidden and their colliders dropped beyond a radius, and come back before the player can see in.
- **Doors**: the ground-floor `door` opening from each exterior blueprint. Its leaf is split out of the shell geometry into a hinged pivot and swings 100 degrees on E.
- **Road markings**: paint on the lane boundaries of the connections road graph, so it lands where the cars actually drive. Every lane paints its own left boundary: broken white where the lane sharing that boundary runs the same way, half of a solid double centre line where it does not. Paint white, low emissive, one draw call for the city.
- **Neon**: a venue's own lettered sign comes off its exterior shell (`options.signage`, ../assembly/CONTRACT.md); the game hangs the ad screens on the facade each parcel's street access faces, textured by the materials database's emissive `ad-screen` entries. Lit window panes sit behind a deterministic share of every window opening, coloured by building type, with per-window brightness and a head-to-sill fall-off baked into vertex colours so the whole skyline is one draw call. Lamp posts run every 19 m on alternating kerbs of every street, one on each junction's widest corner, none inside a plaza and a sparse ring around its edge, each a pole, an arm, a dark housing and an emissive lens. A fixed pool of point lights follows the nearest glows, so real light on the road costs the same in a village and a city, and every glow sits on something the world actually built: a venue's sign, the fixtures over an entrance, a lamp lens, an ad screen. A building with no sign gets no sign light, so nothing ever lights an empty panel.
- **Materials**: every map loads with `flipY` off. The geometry that wears them comes from glTF, whose UVs put v = 0 at the top of the image; the game's own panels are authored the same way. The material a key resolves to is shared by every mesh of that key and is never edited in place: a hotter emission or a two-sided panel takes a tuned copy.
- **Sky**: `SkyMesh` with the sun below the horizon, `FogExp2` in the same colour, a moon key, stars, and one PMREM bake into `scene.environment`.

## Physics
- Rapier 0.20, fixed 1/60 step. Ground and every building shell are fixed trimeshes built once; the shells carry their real door and window openings, so a doorway is walkable with no special case. Each lamp post is one thin fixed cylinder, not a mesh. Interior trimeshes load within 55 m and drop past 75 m.
- Nobody in the crowd is a physics body, so the player is pushed out of them instead: every frame, the whole overlap with everyone within arm's reach, summed and resolved through the same character controller, so a person cannot be walked through and a push cannot shove the player through a wall.
- Player: capsule collider driven by `KinematicCharacterController` with autostep (0.42 m, which is what makes curbs and interior stairs walkable) and snap-to-ground.

## People and traffic
- Population is the simulation library's, never invented here. The crowd slice for each walk edge around the player is the authoritative set of people on that pavement (a city-scope slice is a sample of the whole city, so it starves the street in front of the player); every agent it reports is spawned where the simulation says it is and then walks the connections walk graph at 1.4 m/s, holding at signalled crossings until the walk phase. The parcel crowd slice adds each nearby building's on-duty staff, standing in its lobby.
- Every person keeps its `crowdId`. Talking instantiates it, interrupts its routine, shows the identity and weekly routine the simulation returns, and resumes it on close.
- Rendering: animation clips are baked once into vertex animation buffers, so the whole crowd is 4 draw calls (two models, body and hair) and no skeletons at any population. Measured: 287 people in 4 draw calls, 0.08 ms of CPU per frame.
- Dress: the base characters ship undressed, so the clothes are painted on. A garment map baked at load says which part of the body each vertex belongs to, read off the bones driving it, and each person carries their own skin tone, shirt, trousers, hair colour and where their sleeves and hems end, all decided once from their crowd id. Nothing is added to the mesh, so the draw call count does not move.
- Cars drive the connections lane graph at each lane's posted speed. At the end of a lane a car takes one of that lane's turn connections, chosen by its own seeded rng, holds at the stop line while that turn is red, then drives the turn's own curve through the intersection onto the next lane: the corner is driven, never jumped. Cars keep a 7 m following gap on the line they share and spawn into a gap wide enough for one. A car leaves the world past 140 m from the player, or where the lane graph ends with no turn connection. Two instanced draws per model.

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
