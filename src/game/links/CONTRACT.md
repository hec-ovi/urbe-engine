# CONTRACT: links (game inner box)

Purpose: builds every inter-building link the connections box published as merged geometry and one static collider, sliced so each end closes on the exact hole the facade was carved with.

## In
- **The connections document** (`../../../../connections/CONTRACT.md`): `links` and `apertures`. Each link carries its centerline `path`, a `crossSection` (`rect` or `circle`), `walkable: { over, inside }` and both endpoint aperture ids. Each aperture carries `cut.polygon`, the exact opening on the face plane.
- A `PbrMaterialFactory` (`../../building/PbrMaterialFactory.js`) for the material behind a key.

## Out
`new Links( connections, factory ).build()` returns:
- `group`: one `THREE.Group` named `links`, holding one merged mesh per material key. Add it to the scene.
- `colliderGeometry`: one merged position-only `BufferGeometry` covering every walkable link surface in the city, or `null` when there is none. Static and small, so it goes into the physics world once as a trimesh (`../physics/WorldColliders.js`), never streamed.
- `triangles`, `drawCalls`: what the box costs.

## Kinds
| kind | section | built as | solid |
| --- | --- | --- | --- |
| bridge | rect 4 x 3.2 | concrete shell, ends open | walk through |
| ac-tube | rect 1.6 x 1.6 | sheet metal shell, ends open | walk through and over |
| tunnel | rect 3 x 2.8 | concrete shell at basement level, ends open | walk through |
| wire | circle 0.1 | closed cable tube along the published catenary | nothing |

## Invariants
- A link's geometry is its own `path` and `crossSection` and nothing else. Ends are never inset or extended: `path[0]` and the last point already sit on the two face planes.
- Each end face is sliced by the plane of its aperture's `cut.polygon`, so a diagonal link closes on the carved hole instead of a square cut near it. The end cross section coincides with the cut polygon to within a millimetre.
- The section frame is the one the apertures were cut with: `right` horizontal and square to the axis, `up` square to both. A sloped link tilts its section with the axis.
- Every link ends on a wall it faces, so the axis is never parallel to the face plane it terminates on (measured minimum over the city: 0.65 of a right angle away from parallel).
- A rect link is one shell with no wall thickness: the aperture's cut is that surface, and the floor you walk on is the section's own bottom, level with the floor plate the exterior box aligns to the aperture's `base`. Shells are drawn from both sides.
- Solid follows the flags, not the kind: `inside || over` puts the whole shell in the collider, neither puts nothing there. The shell is one surface, so walking through a bridge and standing on a tube are the same triangles.
- UVs are world metres both ways, `station` along the link and section perimeter across it, because the materials tile over world-metre UVs.
- The whole city merges by material key, never by link: three keys, three draw calls, whatever the city's size.
- No link carries a published emitter, so this box publishes no light. Bridges and tunnels are lit by whatever reaches through their open ends.

## Errors
None thrown. A link of a kind this box does not know is skipped rather than drawn wrong.

## Depends on
- `../../../../connections/CONTRACT.md` for `links` and `apertures`
- `../../../CONTRACT.md`'s material factory for a key's material
- `../physics/WorldColliders.js` for what consumes `colliderGeometry`
