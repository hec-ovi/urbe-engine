# Kit assembly

Turns an Atlas parcel into a shared building: the city generates each distinct building once at full detail and every parcel carries only the plan it stands from and the frame it stands in, so a 1 km city ships a hundred or so shells and under a kilobyte per building.

## In

- Atlas parcel: `id`, `lot` (a rectangle whose sides are whole 8 m bays), type and tier, floor envelope, `landmark` flag, access point and street, from the city blueprint.
- Atlas blocks and `meta.blockTemplates`: the size-and-zone tilings Atlas repeats. A block with `template` is dressed by that template; a block without one is tiled on its own.
- The shared request fields come from `RequestAssembler.assemble(parcelId)`: seed, type, tier, floor count and marquee text.
- Exterior `generate`, run in the assembly workers ([../ExteriorWorkers.js](../ExteriorWorkers.js)), keys-only materials and a merged GLB. Its input follows [building-request.schema.json](../../../../exterior/schemas/building-request.schema.json) and its result [blueprint.schema.json](../../../../exterior/schemas/blueprint.schema.json).
- The Exterior package version, which is part of what a plan's bytes are named after.

## Out

`PlanLibrary({ workers })` ([PlanLibrary.js](PlanLibrary.js)) is the set of distinct buildings a run needs:

- `want(family, bays, floors)` registers one and returns its record; the id is `<family or plain>-<across>x<deep>x<floors>f`.
- `draw()` generates every registered plan that is not in the store already, all of them across the workers at once, and reads back each blueprint. It answers `{ drawn, reused, failed, ms }`. A plan Exterior refuses is dropped and named in `failures`, and the city CLI sends its parcels to the generator.
- `folder(id)` and `blueprintPath(id)` are where a plan's `<plan>.glb` and `<plan>.blueprint.json` stand: `<store>/plans/<hash>/`, the hash of the request that draws it and the Exterior that draws it. The same building is the same bytes for every city, so a second city redraws none of them.
- `publish(used)` writes the index of the plans a world stands on into the store beside them and returns `{ file: "kit.json", sha256, shared }`, which is what the world manifest binds. The index follows [kit-plans.schema.json](kit-plans.schema.json): the Exterior version, the plan seed and, per plan, its id, family, bay counts, floor count, the `glb` and `blueprint` paths relative to the store root, and the shell's length and byte hash. It fails with `E_KIT_PLANS` when a standing parcel names a plan the store does not hold.
- `bytes(used)` is what those shells and blueprints take on disk.

`KitAssembler(atlas, requestAssembler, plans)`:

- `candidate(parcelId)` is the building this parcel gets, or null when it keeps the generator; it registers that parcel's plan the first time it is asked and answers from the same decision after.
- `absorbedBy(parcelId)` is the neighbour whose merged building covers this lot, or null. That lot stands empty and ships no files while that neighbour is a `candidate` and its building stands; a host the kit passes over covers nothing, and the lot keeps a building of its own.
- `build(parcelId, parcelDir)` writes the record and returns it, after the plans are drawn. It also drops the `<parcel>.glb`, `<parcel>.request.json` and `<parcel>.blueprint.json` of a generated shell that stood on the parcel before, so the folder holds one building and the world ships no dead geometry. The reverse is the city CLI's: a parcel it sends back to the generator loses its record.
- `parcelBlueprint(planBlueprint, record)` ([PlanBlueprint.js](PlanBlueprint.js)) is one parcel's blueprint. `BuildingBlueprints(outDir, plans)` ([../BuildingBlueprints.js](../BuildingBlueprints.js)) is the blueprint of any standing building, whichever path built it, reading each plan once for the whole city.

`<out>/<parcel>/<parcel>.placements.json` follows [kit-placements.schema.json](kit-placements.schema.json): `parcel`, `plan`, `origin` and `rotationY` (where the plan's origin stands and how far it is turned, which together are the whole transform from the plan's metres to the world's), `lot` (the Atlas lot this parcel owns, which identifies the folder's ground), `bounds` (the world box of its massing), `signText`, `family`, `floors`, `tint` (what its instance colour is hashed from) and `absorbs` when a merge gave it its neighbour's lot too. Under a kilobyte.

`<store>/plans/<hash>/<plan>.blueprint.json` is Exterior's own blueprint for that building, in the plan's frame. A parcel's blueprint is that document moved and turned, which is what `BuildingSource` hands every consumer, so the streaming catalog, rooftop fitting, Interior and the game read both paths the same way. A kit parcel has neither a `<parcel>.glb` nor a `<parcel>.blueprint.json`: it is its record, and its building is its plan's.

## Rules

- A parcel keeps the generator when it is a landmark, when its lot is not a rectangle of whole bays, when a merge took its lot over, or when its envelope is shorter than two floors.
- A plan is drawn on a canonical lot at the origin: the footprint is its bays at 8 m, the access point is the middle of face 0, and the height allowance is its floors at 4.5 m plus room for a taller ground storey. So face 0 is the street side of every plan, and a parcel's frame is the corner its entrance face runs from and the quarter turn that puts face 0 in it. The entrance face is the lot edge nearest the Atlas access point.
- A plan with a family is generated with that family as `options.architecture`; a plan without one is generated with no architecture named, which is the generator's ordinary output on a plain rectangular plate. The type and tier a plan is drawn as follow its family (`corpo` and `high_rich` for corporate sectors, `residential` and `high_rich` for the other five, `residential` and `mid` for a plain plan) and move no wall.
- Family eligibility is published in [Families.js](Families.js) and is the lot size in whole bays, the floor count and the parcel's own use: corporate sectors needs 40 by 40 m and twelve floors on a corporate parcel or a high rich one; balcony grid, faceted bays, mirror frame and white grid need 24 m on both sides, mirror shutters 32, and all five stand only on rich and high rich parcels. White grid needs four floors, the rest three. Every other parcel gets a plan with no family. Garden taper is a landmark design and is never chosen here.
- A block Atlas tiled from a template is dressed by the template, not by its parcels. A stable hash of the world seed, the template id and the lot slot picks the family and the floor count for that slot, so every block of one template reads the same. A slot's family has to suit every parcel standing in it, so a mixed block never puts a luxury facade on a mid street. The slot's floor ceiling is the median of the floor counts its own parcels' envelopes allow, so it follows the skyline of its zone without one clipped parcel flattening every instance.
- One variation per block instance: a stable hash of the block id either moves one slot's floor count by one within its fits, or merges two adjacent slots of equal depth into one rectangular building, whose lot stands one long building where the neighbouring blocks stand two. The merged-over lot ships nothing.
- A parcel on a block with no template keeps the per-parcel choice: a stable hash of the atlas seed and the parcel id over the families its lot, its floors and its use accept, and the floor count the shared request picked held inside its envelope.
- A shared building carries no basement and no connection cut of its own, so a link that reaches a kit parcel meets its facade uncut.
- A parcel's blueprint is the plan's, so every copy of a building is the same building. Each point is moved and turned and each edge keeps the number the plan gave it, so a consumer reads an outline and an opening's edge against each other exactly as it does for a generated shell. Room envelopes and their construction lattice move with the floor they belong to.
- Every record is checked against the placement schema and every index against the plan schema before anything is written.
- Same blueprint, same Exterior, same buildings, byte for byte.

## Errors

`E_KIT_FIT` (asked for a shared building on a parcel none fits), `E_KIT_PLANS` (a standing parcel names a plan the store does not hold, or the index fails its schema), `E_KIT_PLACEMENTS` (a record fails its schema). All are `AssemblyError`.

## Depends on

[Exterior](../../../../exterior/CONTRACT.md) for `generate` and its published families, the [Atlas blueprint](../../../../atlas/CONTRACT.md), and [assembly](../CONTRACT.md) for the shared request, the producer workers, the shared store and the world manifest.
