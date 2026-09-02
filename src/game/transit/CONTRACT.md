# CONTRACT: transit (game inner box)

Purpose: puts the city's public transport on the street and under it, from the blueprint and the timetable: a shelter and a lit sign on every bus stop, the buses that are in service right now, and the shaft, passage and platform room behind every station entrance.

## In
- **Atlas blueprint** (`../../../../atlas/CONTRACT.md`): `transit.busStops` (`{ id, edgeId, position: [x, z] }`), `transit.trainStations` and `transit.subwayStations` (`{ id, position, entrances: [[x, z], ...], platform: ring, box: { bottom, top }, shafts: [{ footprint: ring, top, bottom, passage: ring }] }`), and `streets.edges` for the centreline a stop's shelter faces.
- **Networks** (`../../../../connections/CONTRACT.md`): `networks.transit.routes`. Only `kind: 'bus'` is drawn; where a train or a subway vehicle is at time t is under the ground this box does not build.
- **Materials**: `PbrMaterialFactory` (`../../../building/PbrMaterialFactory.js`), for `build( key, variantId )` and `variant( key, tweaks )`.
- **Clock**: seconds since midnight, per frame, as `time/GameClock.js` reports them.
- **Player**: the player's feet in world metres, per frame.

## Out
`new Transit( { atlas, networks, factory, capacity } )` builds everything and exposes:
- `group`: one `Group` to add to the scene. Holds `bus-shelters`, `station-entrances` and `buses`.
- `glows`: `[{ position: Vector3, lumens, color: Color, range }]`, the shape `light/CONTRACT.md` takes as an exterior fixture. One per bus stop sign box (180 lm at 5000 K), one per station entrance name band (900 lm at 4000 K).
- `colliders`: `Map<string, BufferGeometry|null>` of position-only trimeshes, the shape `physics/WorldColliders.js` `addShells` consumes. `transit:shelters` is the frames, roofs and sign masts; `transit:entrances` is the portals and, where a station publishes no shaft, that entrance's own stair; `transit:stations` is every platform floor, ceiling, wall, shaft, stair and passage.
- `update( player, daySeconds )`: places the buses that are running at that time. No delta: a bus's place is a function of the clock alone.
- `count`: buses on screen.

## Cost
- Bus stops: one instanced mesh per material, three for the whole city (frame, glass, sign box), 176 triangles of geometry each way.
- Buses: one instanced mesh per material, three for the whole fleet (body, glazing, tyres), capacity bounded and dropped past 320 m from the player.
- Station entrances: merged, one mesh for every entrance's concrete plus one lit band per mode, three for the whole city.
- Station volumes: two merged meshes for the whole city, structure and floor. On the small blueprint (two surface platforms, two subway rooms, four shafts, two passages) that is 4,472 triangles, 4,464 of collider and 42 published fixtures.
- Nine draw calls on the full blueprint (23 stops, 10 entrances, 9 bus routes), three on the small one, which has no bus stops. `update` costs 0.02 ms a frame over nine routes.

## Invariants
- Nothing is invented. Every shelter stands on a blueprint bus stop, every entrance on a blueprint entrance point, and every bus is where `transitVehiclesAt` says it is; this box never integrates a vehicle forward or spawns one of its own.
- An empty collection builds nothing: no stops means no shelter mesh, no bus mesh and a null collider, and the group is empty.
- A shelter faces the roadway. The way there is the shortest way from the stop back to its street edge's centreline, which is the direction someone waiting has to watch.
- A stair descends towards its own station, treads rise 0.175 m on a 0.3 m going, and the flight is 1.8 m clear: inside the controller's 0.42 m autostep and more than twice the 0.7 m capsule.
- A shaft's stair is not authored, it is fitted: as many treads as one flight of the published footprint holds, as many flights as the published depth needs at no more than 0.19 m a tread, and the rise spread evenly over all of them. A 12 m shaft in an 8 m footprint comes out four flights of eighteen at 0.168 m. No tread is ever outside the controller's step.
- A shaft standing inside its own platform ends at the room's ceiling and drops through a hole in it. One standing outside is joined to the room by the passage the atlas publishes, and the walls of shaft, passage and room all open where they meet.
- A platform at or above grade is already the city floor, so it gets a canopy on posts rather than a room.
- Nothing underground is unlit: the platform carries a fixture every 14 m and every stair landing and passage carries its own, all published as real lumens like everything else.
- A station wall is one surface with no thickness, drawn from both sides, because it is seen from the room on one side and the shaft on the other.
- Geometry UVs are world metres, so one material key reads at one scale on a 12 m bus flank and on a 0.09 m post.
- Buses get no collider. They are handled the way the crowd is, by pushing the player out.
- Service periods run past midnight while the clock's day seconds wrap at 24:00, so the routes are asked again a day later during that overrun; a timetable that ends by midnight is asked once.

## Errors
None thrown. A stop naming a street edge the blueprint no longer carries is dropped, and so is an entrance standing exactly on its own station.

## Depends on
- `../../../building/PbrMaterialFactory.js` for every material; no colour is chosen here
- `../ground/GroundBuilder.js` for `SIDEWALK_HEIGHT`, the level a shelter and a stair mouth stand on, and for the floor being cut open over every shaft that breaks the surface
- `../ground/Polygons.js` for `fill` (with holes) and `pointInRing`
- `../light/Color.js` for `kelvinColor`, and `../light/CONTRACT.md` for what a published fixture is
- `../../../../connections/CONTRACT.md` for `networks.transit.routes` and `transitVehiclesAt( routes, t )`
- `../../../../atlas/CONTRACT.md` for the transit collections and the street graph
