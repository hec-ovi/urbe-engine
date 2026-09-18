# Kit assembly

Turns an Atlas parcel into a kit building: the city plans each distinct building once and every parcel carries only the plan it stands from and the frame it stands in, so a 3 x 3 km city ships a few hundred shared pieces, a few hundred plans and under a kilobyte per building.

## In

- Atlas parcel: `id`, `lot` (a rectangle whose sides are whole 8 m bays), type and tier, floor envelope, `landmark` flag, access point and street, from the city blueprint.
- Atlas blocks and `meta.blockTemplates`: the size-and-zone tilings Atlas repeats. A block with `template` is dressed by that template; a block without one is tiled on its own.
- The shared request fields come from `RequestAssembler.assemble(parcelId)`: seed, building id, parcel frame, type, tier, floor count and marquee text.
- The published piece kit: `kit.json` and its piece GLBs, from Exterior's kit CLI. `KitManifest.load(dir)` validates it against [kit.schema.json](../../../../exterior/schemas/kit.schema.json); the directory defaults to the sibling build and `URBE_KIT_DIR` overrides it. `KitManifest.find(dir)` is the same load, returning null when that directory publishes no kit at all, so a machine without Exterior's build still assembles its city.
- Exterior `planAssembly`, called in process. Its input follows [kit-request.schema.json](../../../../exterior/schemas/kit-request.schema.json) and its result [placement.schema.json](../../../../exterior/schemas/placement.schema.json).

## Out

`KitAssembler(atlas, requestAssembler, kit)`:

- `candidate(parcelId)` is the kit building this parcel gets, or null when it keeps the generator.
- `absorbedBy(parcelId)` is the neighbour whose merged building covers this lot, or null. That lot stands empty and ships no files while that neighbour is a `candidate` and its building stands; a host the kit passes over covers nothing, and the lot keeps a building of its own.
- `build(parcelId, parcelDir)` writes both files and returns the record. It also drops the `<parcel>.glb` and `<parcel>.request.json` of a generated shell that stood on the parcel before, so the folder holds one building and the world ships no dead geometry. The reverse is the city CLI's: a parcel it sends back to the generator loses its record.
- `plans` is the `PlanLibrary` this run filled. `publish(outDir, used)` writes every plan it drew to `<out>/kit/plans/`, drops the files no standing building names, and fails with `E_KIT_PLACEMENTS` when a standing parcel names a plan the out dir does not hold.

`<out>/<parcel>/<parcel>.placements.json` follows [kit-placements.schema.json](kit-placements.schema.json): `parcel`, `plan` (the plan id), `origin` and `rotationY` (where the plan's origin stands and how far it is turned), `lot` (the Atlas lot this parcel owns, which identifies the folder's ground), `bounds` (the world box of its massing), `signText`, `family`, `floors`, `tint` (what its instance colour is hashed from) and `absorbs` when a merge gave it its neighbour's lot too. Around 300 bytes.

`<out>/kit/plans/<plan>.json` follows [kit-plan.schema.json](kit-plan.schema.json): `id`, `family`, `baysAcross`, `baysDeep`, `floors`, Exterior's `bands`, `pieces` (each piece file named once), `placements` (one copy each: the piece index, its lot face, its position and its turn), `signAnchors` and `doors`. A plan speaks its own metres, with its origin at zero and face 0 running along +X. The world matrix of a copy is the parcel's frame times the plan's placement.

`<out>/<parcel>/<parcel>.blueprint.json` is the same blueprint a generated shell publishes, so the streaming catalog, rooftop fitting and the game read both paths the same way. A kit parcel has no `<parcel>.glb`: the game draws it from the pieces.

`KitManifest.publish()` puts the kit in the shared store (`../SharedResources.js`) and returns `{ file: "kit.json", sha256, shared }`; the world references those bytes instead of copying them, and the manifest's `sources` names the parcels that took this path.

## Rules

- A parcel keeps the generator when it is a landmark, when its lot is not a rectangle of whole bays, when connections carve its facade or it needs a basement, or when no family fits its height. A parcel the run opens keeps the kit: its blueprint is the one interior is furnished from.
- A block Atlas tiled from a template is dressed by the template, not by its parcels. A stable hash of the world seed, the template id and the lot slot picks the family and the floor count for that slot, so every block of one template reads the same. The slot's floor ceiling is the median of the floor counts its own parcels' envelopes allow, so it follows the skyline of its zone without one clipped parcel flattening every instance; a templated parcel then takes the template's height rather than its own envelope.
- One variation per block instance: a stable hash of the block id either moves one slot's floor count by one within its fits, or merges two adjacent slots of equal depth into one rectangular building, whose lot stands one long building where the neighbouring blocks stand two. The merged-over lot ships nothing.
- A parcel on a block with no template keeps the per-parcel choice: a stable hash of the atlas seed and the parcel id over the families whose published `fits` accept the lot, and the floor count the shared request picked held inside the family's range and the parcel envelope.
- Bays follow the lot: an edge of 8N metres is two 4 m corner arms and N-1 straight bays, so each face places N pieces. `baysAcross` and `baysDeep` are those N counted from the entrance face, the count `fits.bays` is stated in, and a storey places 2 x (across + deep) pieces.
- Floors are at least three: ground, a middle and a crown, which is also what an interior needs to fill.
- Pieces are planned with the kit's own seed, so a plan names exactly the piece files the world binds in the shared store.
- Every request is checked against the kit request schema and every result against the placement, plan and record schemas before anything is written, and the piece count must tile the lot.
- A plan placed in a parcel's frame has to stand exactly where Exterior planned that same building on the parcel itself; a drift between the two fails the parcel rather than moving every copy of the plan.
- Same blueprint, same kit, same buildings, byte for byte.

## Errors

`E_KIT_MANIFEST` (no kit, or one that fails its schema), `E_KIT_FIT` (asked for a building on a parcel no family fits), `E_KIT_PLACEMENTS` (Exterior refused the request, its result fails a schema or does not tile the lot, a plan does not stand where the parcel was planned, or a standing parcel names a plan the out dir lost). All are `AssemblyError`.

## Depends on

[Exterior's piece kit](../../../../exterior/src/kit/CONTRACT.md), the [Atlas blueprint](../../../../atlas/CONTRACT.md), and [assembly](../CONTRACT.md) for the shared request, the shared store and the world manifest. Exterior publishes piece geometry as fixed for every seed; a plan names pieces by id alone and relies on that.
