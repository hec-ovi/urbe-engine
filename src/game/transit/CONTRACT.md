# CONTRACT: transit

Purpose: renders published public transport and provides schema-checked boarding over Atlas places and Connections timetables.

## Inputs

- Renderer blueprint and network: Atlas `transit` and `streets.edges`, plus Connections `networks.transit.routes`, per their public contracts. `new Transit({ atlas, networks, factory, capacity })` consumes them without changing them.
- Materials: `PbrMaterialFactory` for every shelter, station and vehicle surface.
- Render update: player feet in world meters and clock seconds since midnight.
- Journey data: [schema/transit-data.schema.json](schema/transit-data.schema.json). This is the consumed Atlas place and Connections route subset. Runtime relation checks also require unique ids, referenced places, matching template and stop counts, ordered stop distances and times, valid route distance bounds, and non-overlapping service periods.
- Restored journey state: [schema/journey-state.schema.json](schema/journey-state.schema.json). Omit it for a new waiting state.
- Boardable service query: [schema/service-query.schema.json](schema/service-query.schema.json). Current player feet, published place identity and clock time.
- Board request: [schema/board-request.schema.json](schema/board-request.schema.json). The selected trip, route, stop occurrence, scheduled route departure, player feet, published place and clock time.
- Journey update request: [schema/journey-update-request.schema.json](schema/journey-update-request.schema.json). Current clock time.
- Disembark request: [schema/disembark-request.schema.json](schema/disembark-request.schema.json). Current clock time.
- Gameplay frame request: [schema/gameplay-update-request.schema.json](schema/gameplay-update-request.schema.json). Current clock time and whether an existing world interaction owns E.
- Gameplay service selection: [schema/gameplay-service-selection.schema.json](schema/gameplay-service-selection.schema.json). One exact service previously offered by the current frame.

## Outputs

- `Transit.group`: one Three.js group containing `bus-shelters`, `station-entrances`, station volumes, `buses`, `trains` and `subways`.
- `Transit.glows`: exterior fixtures shaped for `light/CONTRACT.md`. Each bus sign emits 180 lm at 5000 K and each station name band emits 900 lm at 4000 K.
- `Transit.colliders`: position-only trimeshes named `transit:shelters`, `transit:entrances` and `transit:stations` for `physics/WorldColliders.js`.
- `Transit.count`: number of visible bus, train and subway vehicles after `update`.
- Boardable service list: [schema/service-list.schema.json](schema/service-list.schema.json). Each exact service identifies its route, public line, mode, stop occurrence, next stop, final destination stop, arrival, departure, published position and stable trip id.
- Board result: [schema/board-result.schema.json](schema/board-result.schema.json). A successful result returns the selected service and serializable aboard state.
- Journey update result: [schema/journey-update-result.schema.json](schema/journey-update-result.schema.json). Route shape position, heading, remaining published stops and whether the vehicle is dwelling.
- Disembark result: [schema/disembark-result.schema.json](schema/disembark-result.schema.json). Published stop or platform position and the new waiting state.
- Serializable state: [schema/journey-state.schema.json](schema/journey-state.schema.json). It stores waiting or aboard status, clock rollover, and active trip identity.
- Gameplay frame: [schema/gameplay-view.schema.json](schema/gameplay-view.schema.json). Prompt, aboard status, current line and next stop, exact services, and the underlying journey result.
- Gameplay action: [schema/gameplay-action.schema.json](schema/gameplay-action.schema.json). No action, an explicit service choice, a board result, or a disembark result.

## Events

- `Transit.update(player, daySeconds)` places every visible vehicle directly from `transitVehiclesAt`. It takes no delta and integrates no position.
- `TransitJourney.listBoardable(request)` lists services currently dwelling at the requested published place and within 3 m of the player. Being outside reach is a valid empty list.
- `TransitJourney.board(request)` enters one exact scheduled trip while it dwells at the selected stop occurrence and the player is within 3 m.
- `TransitJourney.update(request)` recomputes an aboard player location from route shape and service elapsed time, and lists current or future stops.
- `TransitJourney.disembark(request)` leaves only during a published stop dwell and returns the Atlas stop or platform center. A final stop with zero dwell is available only at its exact arrival time.
- The first update after service termination automatically changes the journey to waiting and returns the final published stop or platform position. This prevents a missed final dwell from trapping the player aboard.
- `TransitGameplay.update(request)` carries an aboard controller to the journey result without physics integration. While waiting it queries `Locator.transitPlace` only when the caller reports no higher-priority interaction.
- `TransitGameplay.activate()` boards the only service, opens an explicit choice for multiple services, or requests disembarkation while aboard. `board(service)` revalidates the chosen dwell and reach through `TransitJourney`.

## Errors

Every journey method returns either `ok: true` or `ok: false` with one code from this closed vocabulary:

- `E_TRANSIT_INVALID_DATA`: input, restored state, route data or Atlas relationships fail validation.
- `E_TRANSIT_ABSENT_ROUTE`: a requested or restored route does not exist.
- `E_TRANSIT_WRONG_PLACE`: the place is unpublished, has the wrong mode, or is not the selected route stop occurrence.
- `E_TRANSIT_OUT_OF_SERVICE`: the departure is not scheduled or the active trip is outside its route duration.
- `E_TRANSIT_MISSED_VEHICLE`: the selected vehicle already left the requested stop.
- `E_TRANSIT_MOVING_VEHICLE`: boarding or disembarking was attempted between dwells.
- `E_TRANSIT_OUT_OF_REACH`: boarding was attempted more than 3 m from the published place.
- `E_TRANSIT_ALREADY_ABOARD`: listing or boarding was requested during a journey.
- `E_TRANSIT_NOT_ABOARD`: update or disembark was requested while waiting.

Renderer construction throws no transit error. Empty optional collections build nothing, as before.

## Cost

- Bus stops use three city-wide instanced meshes. Station entrances use one merged concrete mesh plus one lit band per mode. Station volumes use two merged meshes.
- Each active vehicle mode uses three instanced meshes for body, glazing and running gear. Capacity is bounded per mode, nearest vehicles win, and vehicles farther than 320 m use no instance.
- Empty vehicle modes allocate no mesh or draw call. The maximum vehicle cost is nine draw calls across bus, train and subway.

## Dependencies

- Atlas public contract for stop, station, platform and street geometry.
- Connections public contract and `transitVehiclesAt` for route geometry and timetable placement.
- `building/PbrMaterialFactory.js` for rendered materials.
- `ground/GroundBuilder.js` and `ground/Polygons.js` for station and shelter geometry.
- `light/Color.js` and `light/CONTRACT.md` for fixtures.

## Invariants

- Rendered vehicles and aboard players use the authoritative 3D `route.shape` and template offsets. Neither renderer nor journey state integrates position or invents track geometry.
- The trip id is `trip:<route id length>:<route id>:<absolute scheduled departure>`. Connections exposes no trip id, so route id plus scheduled departure supplies the deterministic identity without punctuation ambiguity.
- Stop ids can occur more than once on an out-and-back route. `stopIndex` identifies the exact scheduled occurrence.
- Service periods can end after 86400. Serialized clock rollover resolves a wrapped day time against the same absolute trip without moving the vehicle incrementally.
- Disembark positions come from Atlas bus stop coordinates at the Connections stop height, or the Atlas station center at its published platform level.
- A malformed route, dangling place reference, invalid restored trip or non-schema request fails closed before journey state changes.
- An aboard restore also requires a saved clock observation. Invalid or stale gameplay restores become a fresh waiting journey and never carry the player.
- While aboard, the physics capsule is disabled and placed from each exact journey update. Walking, jumping and crouching are disabled; mouse look and panels remain available. Disembarkation and automatic termination re-enable collision at the published place.
- Identical route data, serialized state and request produce identical output.
- Geometry UVs use world meters and every visible surface uses a material from `PbrMaterialFactory`.
- Transit vehicles have no physics collider.

## How to modify this blackbox safely

Keep timetable math aligned with Connections' `transitVehiclesAt`, including its dwell boundary behavior. Update every affected schema and focused journey or renderer test, then run the complete engine tests and build.
