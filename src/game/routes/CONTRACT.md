# CONTRACT: objective routes

Purpose: calculates a repeatable route from the player's current feet to an objective over Connections' authoritative walk graph.

## Inputs

- Walk network: [schema/walk-network.schema.json](schema/walk-network.schema.json). Nodes and edges come from `connections.networks.walk`; every edge carries its complete `path3` walking surface.
- Route request: [schema/route-request.schema.json](schema/route-request.schema.json). The current three-dimensional player position and one parcel, station, or stop identity.

## Outputs

- Route result: [schema/route-result.schema.json](schema/route-result.schema.json). Ordered nodes, edges, exact 3D path and total walking distance through the destination's published entry node.

## Events

- `route(request)` calculates a new shortest path. Calling it again from changed feet is rerouting; no stale route state is retained.

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
- Parcel routes finish on the parcel's `entry` node, station routes on the station node, and bus routes on the stop node with the matching `ref`.
- Equal-cost choices resolve by edge and node id, so identical inputs produce identical output.
- The current feet lead to the nearest graph node and count toward the displayed distance.

## How to modify this blackbox safely

Keep graph validation fail-closed and preserve 3D geometry. Update the exact schemas and route tests, then run the full engine test suite.
