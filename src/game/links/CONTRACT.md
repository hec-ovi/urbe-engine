# CONTRACT: links (game inner box)

Purpose: builds every inter-building link and fitted rooftop antenna span Connections published as merged geometry, plus one static collider for walkable links.

## In
- **The connections document** (`../../../../connections/CONTRACT.md`): `links` and `apertures`. Each link carries its centerline `path`, a `crossSection` (`rect` or `circle`), `walkable: { over, inside }` and both endpoint aperture ids. Each aperture carries `cut.polygon`, the exact opening on the face plane.
- **The rooftop span document** (`../../../../connections/schemas/rooftop-span-output.schema.json`): each span carries exact attachment endpoints, the rendering path evaluated from its authoritative catenary, cable thickness, sag and arc length. Assembly stores this document in the world manifest after Exterior has published every roof attachment and obstacle.
- A `PbrMaterialFactory` (`../../building/PbrMaterialFactory.js`) for the material behind a key.

## Out
`new Links( connections, factory ).build()` returns:
- `group`: one `THREE.Group` named `links`, holding one merged mesh per material key. Add it to the scene.
- `colliderGeometry`: one merged position-only `BufferGeometry` covering every walkable link surface in the city, or `null` when there is none. Static and small, so it goes into the physics world once as a trimesh (`../physics/WorldColliders.js`), never streamed.
- `triangles`, `drawCalls`: what the box costs.

## Kinds
The section comes from the link, never from here; these are what each kind is built as.

| kind | built as | solid |
| --- | --- | --- |
| bridge | open concrete deck between two 1.1 m railings, nothing over the top | walk on |
| ac-tube | sheet metal shell, ends open | walk through and over |
| tunnel | concrete shell at basement level, ends open | walk through |
| wire | closed cable tube along the published catenary | nothing |
| rooftop span | eight-sided cable tube along the published catenary path | nothing |

A kind this box does not know is skipped.

## Invariants
- A link's geometry is its own `path` and `crossSection` and nothing else. Ends are never inset or extended: `path[0]` and the last point already sit on the two face planes.
- Each end face is sliced by the plane of its aperture's `cut.polygon`, so a diagonal link closes on the carved hole. The end cross section coincides with the cut polygon to within a millimetre.
- The section frame is the one the apertures were cut with: `right` horizontal and square to the axis, `up` square to both. A sloped link tilts its section with the axis.
- Every link ends on a wall it faces, so the axis is never parallel to the face plane it terminates on (measured minimum over the city: 0.65 of a right angle away from parallel).
- A rect link is one shell with no wall thickness: the aperture's cut is that surface, and the floor you walk on is the section's own bottom, level with the floor plate the exterior box aligns to the aperture's `base`. Shells are drawn from both sides.
- A bridge is that shell opened: the deck is the section's own bottom, a railing stands on each edge of it, and nothing spans the top, so the aperture stays a doorway onto a crossing in the open air. It meets the two base corners of its cut exactly; a closed link meets all four.
- Solid follows the flags, not the kind: `inside || over` puts the whole surface in the collider, neither puts nothing there. A tube is one surface, so walking through it and standing on it are the same triangles; a bridge's railings are in the collider too, which is what stops a walk off the deck.
- UVs are world metres both ways, `station` along the link and section perimeter across it, because the materials tile over world-metre UVs.
- A rooftop span uses every path point Connections evaluated from the authoritative catenary. Its first and last ring centers equal the two published attachment positions and every ring radius equals half the published thickness.
- The whole city merges by material key, never by link: rooftop spans share the wire's rubber bucket, so they add no material bucket when ordinary wire exists. A closed rect sweeps four strips a segment, an open deck three, a street wire five and a rooftop span eight.
- No link carries a published emitter, so this box publishes no light. Bridges and tunnels are lit by whatever reaches through their open ends.

## Errors
None thrown. A link of a kind this box does not know is skipped rather than drawn wrong.

## Depends on
- `../../../../connections/CONTRACT.md` for `links`, `apertures` and rooftop spans
- `../../../CONTRACT.md`'s material factory for a key's material
- `../physics/WorldColliders.js` for what consumes `colliderGeometry`
