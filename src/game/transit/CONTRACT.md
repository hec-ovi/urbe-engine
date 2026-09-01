# CONTRACT: transit (game inner box)

Purpose: puts the city's public transport on the street, from the blueprint and the timetable: a shelter and a lit sign on every bus stop, the buses that are in service right now, and a stair down into every station entrance.

## In
- **Atlas blueprint** (`../../../../atlas/CONTRACT.md`): `transit.busStops` (`{ id, edgeId, position: [x, z] }`), `transit.trainStations` and `transit.subwayStations` (`{ id, position: [x, z], entrances: [[x, z], ...] }`), and `streets.edges` for the centreline a stop's shelter faces.
- **Networks** (`../../../../connections/CONTRACT.md`): `networks.transit.routes`. Only `kind: 'bus'` is drawn; where a train or a subway vehicle is at time t is under the ground this box does not build.
- **Materials**: `PbrMaterialFactory` (`../../../building/PbrMaterialFactory.js`), for `build( key, variantId )` and `variant( key, tweaks )`.
- **Clock**: seconds since midnight, per frame, as `time/GameClock.js` reports them.
- **Player**: the player's feet in world metres, per frame.

## Out
`new Transit( { atlas, networks, factory, capacity } )` builds everything and exposes:
- `group`: one `Group` to add to the scene. Holds `bus-shelters`, `station-entrances` and `buses`.
- `glows`: `[{ position: Vector3, lumens, color: Color, range }]`, the shape `light/CONTRACT.md` takes as an exterior fixture. One per bus stop sign box (180 lm at 5000 K), one per station entrance name band (900 lm at 4000 K).
- `colliders`: `Map<string, BufferGeometry|null>` of position-only trimeshes, the shape `physics/WorldColliders.js` `addShells` consumes. `transit:shelters` is the frames, roofs and sign masts; `transit:entrances` is the stair treads, landings, side walls and balustrades.
- `update( player, daySeconds )`: places the buses that are running at that time. No delta: a bus's place is a function of the clock alone.
- `count`: buses on screen.

## Cost
- Bus stops: one instanced mesh per material, three for the whole city (frame, glass, sign box), 176 triangles of geometry each way.
- Buses: one instanced mesh per material, three for the whole fleet (body, glazing, tyres), capacity bounded and dropped past 320 m from the player.
- Station entrances: merged, one mesh for every entrance's concrete plus one lit band per mode, three for the whole city.
- Nine draw calls on the full blueprint (23 stops, 10 entrances, 9 bus routes), three on the small one, which has no bus stops. `update` costs 0.02 ms a frame over nine routes.

## Invariants
- Nothing is invented. Every shelter stands on a blueprint bus stop, every entrance on a blueprint entrance point, and every bus is where `transitVehiclesAt` says it is; this box never integrates a vehicle forward or spawns one of its own.
- An empty collection builds nothing: no stops means no shelter mesh, no bus mesh and a null collider, and the group is empty.
- A shelter faces the roadway. The way there is the shortest way from the stop back to its street edge's centreline, which is the direction someone waiting has to watch.
- A stair descends towards its own station, treads rise 0.175 m on a 0.3 m going, and the flight is 1.8 m clear: inside the controller's 0.42 m autostep and more than twice the 0.7 m capsule.
- Geometry UVs are world metres, so one material key reads at one scale on a 12 m bus flank and on a 0.09 m post.
- Buses get no collider. They are handled the way the crowd is, by pushing the player out.
- Service periods run past midnight while the clock's day seconds wrap at 24:00, so the routes are asked again a day later during that overrun; a timetable that ends by midnight is asked once.

## Errors
None thrown. A stop naming a street edge the blueprint no longer carries is dropped, and so is an entrance standing exactly on its own station.

## Depends on
- `../../../building/PbrMaterialFactory.js` for every material; no colour is chosen here
- `../ground/GroundBuilder.js` for `SIDEWALK_HEIGHT`, the level a shelter and a stair mouth stand on
- `../light/Color.js` for `kelvinColor`, and `../light/CONTRACT.md` for what a published fixture is
- `../../../../connections/CONTRACT.md` for `networks.transit.routes` and `transitVehiclesAt( routes, t )`
- `../../../../atlas/CONTRACT.md` for the transit collections and the street graph

## Open
The stair below a station entrance is drawn but not yet visible or walkable: `ground/` fills every cover polygon solid, including the pavement over the entrance, and lays bedrock at y = -0.8 under the whole city. Cutting the entrance footprint out of the cover polygon, and dropping the bedrock below the deepest shaft, is what opens it. Above ground the balustrade, portal and lit band read as built.
