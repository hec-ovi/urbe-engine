# CONTRACT: props (game inner box)

Purpose: dresses the city with the things a real one leaves against a wall, down the alleys and around the backs of the blocks, in three instanced draws however much of it there is.

## In
- Atlas blueprint per ../../../../atlas/CONTRACT.md. Read: `streets.edges` (an `alley` is pedestrian ground between two blocks, carriageway 0), `parcels` (`footprint` counter-clockwise, `access.point` for the street door), `meta.seed`.
- `networks.walk` per ../../../../connections/CONTRACT.md: the authoritative walkable segments, which is what nothing may stand on.
- A material factory (../../../CONTRACT.md): `build(key, variantId)`.

## Out
- `Dressing(atlas, walk, factory).build() -> { group, colliders, counts }`
  - `group`: named `props`, one `InstancedMesh` per model (`props:bag`, `props:crate`, `props:box`), each the whole city's worth of that model.
  - `colliders`: a `Map` holding one merged position-only `BufferGeometry` under `props`, which is the shape `physics/WorldColliders.addShells` takes. Crates and boxes only.
  - `counts`: `{ total, bag, crate, box }`.

## What stands where
- **Alleys**: piles of one to four bin bags against one wall, sides alternating down the alley.
- **Gaps**: where two buildings' facades face each other closer than 7 m, bags or crates against one of them.
- **Service corners**: the corners of a block more than 14 m from its own street door, where the deliveries stack: one to three crates squared up to the wall, with a box or two beside them.

Models: a bin bag (a lumpy sack about 0.5 m), a wooden crate (0.6 m), a moulded plastic box (0.5 x 0.45 m). Bags and boxes wear `cyberpunk/plastic/poor` in its `bag` variant, crates `cyberpunk/wood/poor`.

## Invariants
- Deterministic: the same atlas dresses identically on every run, off one seeded stream taken from `meta.seed`.
- Nothing blocks anything. No prop stands inside a building footprint, within 3.5 m of a parcel's street access point, or within 1.1 m of a walk-graph edge, and two piles never stand within 2.8 m of each other.
- Everything stands on the pavement, at y = 0.12 (`ground/GroundBuilder.js`).
- Three draw calls for the city, whatever the count: one instanced mesh per model, instanced across the whole world.
- Crates and boxes are solid and publish a collider. A bag does not: a sack of rubbish gives way, and a collider on one would turn a pile of it into a wall the player is stopped by.
- Geometry UVs are metres in model space, which is what the tiled material entries expect. An instanced prop is drawn from its own geometry at every one of its positions, so model metres are the only metres its UVs can carry.

## Errors
None thrown. A city with no alleys, no gaps and no service corners dresses to an empty group and an empty collider map.

## Depends on
- ../../../../atlas/CONTRACT.md and ../../../../connections/CONTRACT.md for the world it reads
- ../../../CONTRACT.md for a key's material
- ../city/StreetLamps.js for `samplePath`, ../ground/Polygons.js for ring geometry, ../ground/GroundBuilder.js for the pavement height, ../../city/Rng.js for the seeded stream
