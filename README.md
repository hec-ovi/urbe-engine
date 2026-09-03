# urbe-engine

The assembler and the game client. It turns every generated layer of a city (blueprint, links, building shells, interiors, materials, population, names, questlines) into one world on disk, then plays that world first person at street level in the browser on three.js WebGPU.

Only generated data is rendered. No placeholder geometry, no invented population, no untextured surface outside the deliberate light emitters.

## Run

```
npm install
npm run dev -- --port 5306
npm test
```

Open [http://localhost:5306/](http://localhost:5306/). The front door keeps generated cities and playable games in separate libraries. New Game runs four stages: city shells, selected interiors, the main quest plus up to three side jobs, then the saved game. Automatic creation uses nine interiors. Manual creation furnishes only the buildings selected in stage 2.

Catalog games open directly with `/?mode=game&game=<id>`. A catalog game loads its own city, interiors, quests, player position, inventory and discovered locations from `out/games/<id>`, then saves the current state before returning to the launcher. A city remains a shell-only artifact under `out/cities/<id>`.

Other commands:

- `npm run assemble -- --parcel <id> --out <dir> [--glb merged|named] [--interior]` builds a single parcel end to end.
- `npm run assemble-city -- --blueprint <path> --out <dir> --workers 8` builds a city directly. Add `--reuse-shells true --interior-parcels <id,id,...>` to furnish an exact set without rebuilding its shells.
- `npm run simulate` boots the population over an assembled world and prints stats, a crowd slice, three NPC lives, latencies and a conservation check.
- `npm run install-character-assets` validates and installs the CC0 Source characters and Pro animation pack from the workspace resources folder; `npm run audit-character-assets` verifies the local store without changing it.
- `npm run build` produces the static client.

The client tools stay available on explicit modes: `?mode=city&out=/out/cities/small` shows a whole city, `?mode=building&parcel=<id>&out=/out/games/small` inspects a building, and `?mode=experiment` runs the render scale comparison. Add `source=interior` to the building URL to inspect its furnished version.

## Local preview services

From the family root, `docker compose up` starts every box. The fixed ports are:

| Port | Service | Open |
| --- | --- | --- |
| 5301 | Atlas map and city generator | [http://localhost:5301/](http://localhost:5301/) |
| 5302 | Connections, roads and transit networks | [http://localhost:5302/](http://localhost:5302/) |
| 5303 | Exterior building shell preview | [http://localhost:5303/](http://localhost:5303/) |
| 5304 | Furnished interior preview | [http://localhost:5304/](http://localhost:5304/) |
| 5305 | Population simulation testbed | [http://localhost:5305/testbed/](http://localhost:5305/testbed/) |
| 5306 | Engine launcher and playable games | [http://localhost:5306/](http://localhost:5306/) |
| 5307 | PBR material database preview | [http://localhost:5307/](http://localhost:5307/) |

The quest compiler runs as a worker and has no browser port.

## Assembly

`assemble-city` runs the link layer once over the blueprint, then generates every exterior shell in parallel. Its direct CLI default furnishes five buildings referenced by carried questlines; `--interiors N` changes that count. The staged game creator uses nine so the ten-step main quest and three side jobs have every required location. The other buildings stay closed shells. A QA report separates shell failures from interior candidates that stayed closed. Interiors are requested in `keys` texture mode, so the runtime resolves materials itself. Each furnished interior is written per floor (`interior/floors/<tag>.glb` beside each floor JSON), which is what the game streams.

Venue parcels (hotel, coffee shop, market, clinic, police, diner) ask exterior for a lettered marquee saying what the place is, until the naming pass gives it a name. Everything else gets no sign, because a blank one is worse than none.

The output directory ends holding exactly the blueprint it was built from: folders for parcels the blueprint no longer has are dropped, and `manifest.json` names every complete shell in `parcels`, the enterable subset in `interiors`, and floor files only for that subset. That manifest is the only list the game loads, so a leftover folder from an older blueprint can never stand a building inside the one that replaced it.

## The game

`?mode=game&game=<id>` loads a saved catalog game. Without `game`, the direct preview takes its run from `world` (atlas sample), `out` (assembled directory), `backend` (`webgpu` default, `webgl`), `hour` (world clock, default 21), `crowd` and `cars` (instance capacity), `density` (street population scale, default 1), and `quality` (`low`, `medium`, `high`, `ultra`; unset follows the backend). Debug views are off unless asked for: `lanes=debug` paints the whole lane graph, `lanes=glow` puts the teal centreline strips back, `exposure` moves the grade one variable at a time.

- **Streets** are the blueprint's ground cover: grade roadway in the material database's dry street variant, sidewalks and blocks in its 2 m plate variant raised 12 cm, and curb stone around every raised road edge. Highways use the lane-aligned road variant over Atlas' exact path and width, with U across the lanes and V along the elevation profile; their deck frame and supports use the concrete entry. Road paint follows each lane's 3D path: broken white lines between lanes running the same way, a solid double line against oncoming traffic.
- **Buildings** merge across the city by material key, so the skyline costs one draw call per key. Shells come from each parcel's own exterior GLB, under a megabyte each. Only the manifest's interior subset streams per floor: within 70 m of one, only the floors within one of yours are fetched, cut into rooms in a worker and made solid, one more above and below stays in memory for the stairs and lifts, and everything further is dropped with its vertex data.
- **Which buildings are enterable** you can see: a thin lit strip runs up the jambs and over the head of every entrance that has something behind it, its entrance fixture is lit, and the minimap marks each enterable venue with a dot. A venue's sign follows the population library, lit while somebody is on duty in there and dark once the place shuts. A shell-only parcel keeps its door leaf fixed shut and offers no strip or prompt.
- **Links between buildings** are built from the connections layer's own centerlines and cross-sections: bridges and AC tubes you can walk through, tubes you can also walk on top of, tunnels at their basement apertures, and wires hanging as the published catenaries. Each end is sliced onto the exact hole the facade was carved with, so a diagonal tube closes with no gap. The whole city's links are three draw calls.
- **Transit** puts a shelter and a lit sign at every bus stop, drives buses along their routes at the positions the timetables give in closed form, and builds each train and subway station's street entrances as stairs down with signage. The minimap and full map draw exactly the generated lines and their served stops or entrances; the full map keeps the published route height. Shelters and buses are instanced, so the count never grows the draw calls.
- **Lifts** are rideable. E at a landing calls the cab and opens the doors, E inside takes you to the next floor the shaft serves, and a moving cab carries you with it. The doors are the ones the interior layer published, cut out of their floor band and given a slide.
- **The day** runs on the same 1:1 clock: the sun's real arc decides which of four states the sky is in, and one number switches the whole city together. Lamp lenses, venue signs, ad screens, facade fixtures and lit window panes go out at sunrise and come back at dusk, and the real lights dim by the same figure, so what you see and what the shading gets never disagree. Exposure follows in stops taken from the real illuminance ratio. A run still starts at night.
- **Neon** is the venue's own lettered sign off its shell, plus ad screens on the facade each parcel's street access faces, lit window panes behind a deterministic share of the windows, and lamp posts every 19 m on alternating kerbs and one on each junction corner, with a wall-mounted pack on a real facade wherever a post does not fit, so every walkable stretch in the city, alleys included, is covered. Alleys and service corners carry seeded trash bags, crates and boxes. Every one of them is a real light in lumens, and every one sits on something the world actually built.
- **Light** is photometric throughout. A street luminaire carries 12000 lm at 3000 K, an entrance fixture 800 lm, a venue sign 140 to 420 lm; each has inverse-square decay and the range it publishes. WebGPU bins them into a cluster grid, so hundreds cost a compute dispatch rather than a shading term each; the WebGL2 fallback batches the nearest into uniform arrays, where lights coming and going never recompile a material. Interiors are cut into the rooms the interior layer published and lit by their own fixtures, through a fixed pool of light slots, and each room's fill light is computed from its own surfaces and its fixtures' flux rather than dialled by hand.
- **The look** is AgX tone response at one authored exposure, dropping 1.6 stops when you step into a room and coming back over 0.6 s. Height fog carries the colour of the light actually filling the air, so a street under sodium lamps reads warm and its shadows are never black. An environment probe baked from the city at your position is what wet ground and glass reflect on medium through ultra. Bloom is fed by the emissive channel, so tubes, lenses and lit windows glow and the walls they light do not. Low disables the probe and bloom, keeps base colour, normal and emission maps, and holds pattern families to two variants; higher tiers add texture channels and variety.
- **People** are the population library's, never invented here. The crowd is asked for edge by edge around the player, so the pavement in front of you carries who the library says is on it; pedestrians walk the Connections `path3` graph at 1.4 m/s, through station stairs, passages, platforms and building links at their published height, and hold at signalled crossings until the walk phase. Each building's on-duty staff stand in its lobby. The library resamples a pavement every few minutes and hands the same people new handles, so each refresh fits the people already walking to the ones it reports now instead of spawning them again: the street stays at the number the library says is out there for as long as the session runs, and anyone left over walks off and leaves from well behind you. Each one is dressed from a garment map read off its own skeleton, with its own skin tone, shirt, trousers, hair and sleeve and hem lengths, and you cannot walk through any of them. Talking to one swaps in one of all six full-resolution Source bodies with an age- and gender-compatible head style and optional facial hair from all 32 original files, then drives it with the Pro talking animation. The mass crowd keeps two baked regular bodies and downscaled maps so it remains 4 draw calls at any population, measured at 287 people in 4 draw calls and 0.08 ms of CPU per frame.
- **Cars** drive each lane's 3D path at its posted speed, carry lane elevation and body pitch over ramps, hold at a red, then drive the turn connection's 3D curve through the intersection onto the next lane, keeping a following gap.
- **Movement** is a Rapier capsule with a kinematic character controller: pointer-lock mouse look, WASD at 1.4 m/s and 4 m/s on shift, eye height 1.7 m, autostep that makes curbs and interior stairs walkable. Building shells are trimeshes carrying their real door and window openings, so a doorway needs no special case. Lamp posts are thin cylinders you bump into. An interior floor band becomes solid when the stream puts it in the scene and stops being solid when it takes it out, so what you can walk on is exactly what you can see.
- **HUD**: clock and district, interact prompt, position readout, an about line naming every loaded path, the NPC panel, a minimap, an orbiting full map (M), an inventory grid (I), a pause menu and a live performance readout with frame time, GPU milliseconds, draw calls, lit fixtures, live interiors and the tier in force.

Character, animation and vehicle packs are CC0 assets kept in a model store outside the repo, served from `URBE_MODELS_DIR`. Blueprints come from the sibling atlas directory, or from `URBE_ATLAS_DIR`.

A run either starts or reports the failure: anything that goes wrong during startup is caught and shown on the loading panel with its message. There is no partial world.

## In the urbe family

It depends on every other box: the plan from [urbe-atlas](../urbe-atlas), links and networks from [urbe-transit](../urbe-transit), shells from [buildingforge](../buildingforge), interiors from [interiorforge](../interiorforge), textures from [pbrforge](../pbrforge), people from [urbe-population](../urbe-population), names from [urbe-namer](../urbe-namer) and stories from [urbe-quests](../urbe-quests). The full picture lives in [urbe](../urbe).
