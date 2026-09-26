# CONTRACT: objective routes

Purpose: calculates a repeatable route from the player's current feet to an objective over Connections' authoritative walk graph.

## Inputs

- Walk network: [schema/walk-network.schema.json](schema/walk-network.schema.json). Nodes and edges come from `connections.networks.walk`; every edge carries its complete `path3` walking surface.
- Route request: [schema/route-request.schema.json](schema/route-request.schema.json). The current three-dimensional player position and one parcel, station, or stop identity.
- Route places: [schema/route-places.schema.json](schema/route-places.schema.json). The city's doors, one outside point per parcel, given to `new ObjectiveRouter(network, { places })`.
- Guide update: [schema/guide-update.schema.json](schema/guide-update.schema.json). Current feet, elapsed frame time, optional force flag, and a routable destination or null.

## Outputs

- Route result: [schema/route-result.schema.json](schema/route-result.schema.json). Ordered nodes, edges, exact 3D path and total walking distance through the destination's published entry node. A parcel with a door carries on from that node to the door in one straight step, in the path and in the distance, so the route ends where the player walks in and not on the sidewalk Atlas tied the entry to.
- Guide result: [schema/guide-result.schema.json](schema/guide-result.schema.json). The current route or null and whether the presentation needs to redraw it.

## Events

- `route(request)` calculates a new shortest path. Calling it again from changed feet is rerouting; no stale route state is retained.
- `ObjectiveGuide.update(request)` routes a changed objective immediately and otherwise reroutes only after 0.75 seconds when the feet moved at least three metres.

## Errors

- `E_OBJECTIVE_ROUTE_INPUT`: an input does not match its schema.
- `E_OBJECTIVE_ROUTE_OUTPUT`: a result does not match its schema.
- `E_OBJECTIVE_ROUTE_NETWORK`: the graph is empty, duplicated, or references missing nodes.
- `E_OBJECTIVE_ROUTE_DESTINATION`: the requested published entry does not exist.
- `E_OBJECTIVE_ROUTE_UNREACHABLE`: no walk path reaches the destination.

## Dependencies

- Connections walk-network contract, by its public output only.

## Invariants

- Route geometry is composed only from `path3`; flat compatibility paths are never used.
- Parcel routes finish on an `entry` node, then on the parcel's door when the places carry one; station routes on a station node, and bus routes on a stop node with the matching `ref`. When a place has several entrances, the least-cost reachable destination wins; equal costs use node id order.
- Equal-cost choices resolve by edge and node id, so identical inputs produce identical output.
- The current feet lead to the nearest graph node and count toward the displayed distance. A piece of the graph made only of `link-portal` nodes is a building link whose ends stand inside the buildings it joins, off the walk graph, so the feet never lead there.
- The guide never calls the router every frame. It retains one validated result between bounded reroutes.
- A failed route attempt clears the presented route and retries only after the same cadence and movement threshold.
