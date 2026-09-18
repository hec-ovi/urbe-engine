# Kit assembly

Turns an Atlas parcel into a kit building: the city plans each distinct building once and every parcel carries only the plan it stands from and the frame it stands in, so a 3 x 3 km city ships a few hundred shared pieces, a few hundred plans and under a kilobyte per building.

## In

- Atlas parcel: `id`, `lot` (a rectangle whose sides are whole 8 m bays), type and tier, floor envelope, `landmark` flag, access point and street, from the city blueprint.
- Atlas blocks and `meta.blockTemplates`: the size-and-zone tilings Atlas repeats. A block with `template` is dressed by that template; a block without one is tiled on its own.
- The shared request fields come from `RequestAssembler.assemble(parcelId)`: seed, building id, parcel frame, type, tier, floor count and marquee text.
- Atlas `meta.buildingGrid`, the city's construction lattice. A plan is drawn on the same lattice as the parcels that stand on it, so the room envelope behind its facade is the city's and not one derived from a lot.
- The published piece kit: `kit.json` and its piece GLBs, from Exterior's kit CLI. `KitManifest.load(dir)` validates it against [kit.schema.json](../../../../exterior/schemas/kit.schema.json); the directory defaults to the sibling build and `URBE_KIT_DIR` overrides it. `KitManifest.find(dir)` is the same load, returning null when that directory publishes no kit at all, so a machine without Exterior's build still assembles its city.
- Exterior `planAssembly`, called in process. Its input follows [kit-request.schema.json](../../../../exterior/schemas/kit-request.schema.json) and its result [placement.schema.json](../../../../exterior/schemas/placement.schema.json).

## Out

`KitAssembler(atlas, requestAssembler, kit)`:

- `candidate(parcelId)` is the kit building this parcel gets, or null when it keeps the generator.
- `absorbedBy(parcelId)` is the neighbour whose merged building covers this lot, or null. That lot stands empty and ships no files while that neighbour is a `candidate` and its building stands; a host the kit passes over covers nothing, and the lot keeps a building of its own.
- `build(parcelId, parcelDir)` writes the record and returns it. It also drops the `<parcel>.glb`, `<parcel>.request.json` and `<parcel>.blueprint.json` of a generated shell that stood on the parcel before, so the folder holds one building and the world ships no dead geometry. The reverse is the city CLI's: a parcel it sends back to the generator loses its record.
- `plans` is the `PlanLibrary` this run filled. `publish(outDir, used, composed)` writes every plan it drew and that plan's blueprint to `<out>/kit/plans/`, drops the files no standing building names, and fails with `E_KIT_PLACEMENTS` when a standing parcel names a plan document the out dir does not hold, or when a plan in `composed` has no blueprint there. `composed` is the plans whose parcels read their blueprint from the plan; a parcel an earlier run left a blueprint of its own keeps reading that file, so a run over part of a city publishes only the plans it redrew and the rest of the world stands untouched.
- `parcelBlueprint(planBlueprint, record)` ([PlanBlueprint.js](PlanBlueprint.js)) is one parcel's blueprint, composed from those two. `BuildingBlueprints(outDir).of(parcelId)` ([../BuildingBlueprints.js](../BuildingBlueprints.js)) is the blueprint of any standing building, whichever path built it, reading each plan once for the whole city.

`<out>/<parcel>/<parcel>.placements.json` follows [kit-placements.schema.json](kit-placements.schema.json): `parcel`, `plan` (the plan id), `origin`, `rotationY` and `face` (where the plan's origin stands, how far it is turned and which lot face its face 0 stands in), `lot` (the Atlas lot this parcel owns, which identifies the folder's ground), `bounds` (the world box of its massing), `signText`, `family`, `floors`, `floorKinds` and `exteriorStyle` (what this parcel's own type and tier make of the shared building), `tint` (what its instance colour is hashed from) and `absorbs` when a merge gave it its neighbour's lot too. Under a kilobyte.

`<out>/kit/plans/<plan>.json` follows [kit-plan.schema.json](kit-plan.schema.json): `id`, `family`, `baysAcross`, `baysDeep`, `floors`, Exterior's `bands`, `pieces` (each piece file named once), `placements` (one copy each: the piece index, its lot face, its position and its turn), `signAnchors` and `doors`. A plan speaks its own metres, with its origin at zero and face 0 running along +X. The world matrix of a copy is the parcel's frame times the plan's placement.

`<out>/kit/plans/<plan>.blueprint.json` is that building's blueprint, in the same frame as its plan, with its repeated storeys and facade grids written once: `plates` and `facade.gridPlates` hold each distinct one, and a `floors` entry names the plate it uses, the elevation it sits at and the placement its openings count from. A parcel's own blueprint is that document turned into its frame, which is what `BuildingSource` hands every consumer, so the streaming catalog, rooftop fitting, Interior and the game read both paths the same way. A kit parcel this run built has neither a `<parcel>.glb` nor a `<parcel>.blueprint.json`: it is its record, and its building is its plan's. The world manifest says per parcel which of the two holds its blueprint (`buildings.<parcel>.blueprint`), so a world assembled before the document moved to the plan keeps loading from the file beside each parcel.

`KitManifest.publish()` puts the kit in the shared store (`../SharedResources.js`) and returns `{ file: "kit.json", sha256, shared }`; the world references those bytes instead of copying them, and the manifest's `sources` names the parcels that took this path.

## Rules

- A parcel keeps the generator when it is a landmark, when its lot is not a rectangle of whole bays, when connections carve its facade or it needs a basement, or when no family fits its height. A parcel the run opens keeps the kit: its blueprint is the one interior is furnished from.
- A block Atlas tiled from a template is dressed by the template, not by its parcels. A stable hash of the world seed, the template id and the lot slot picks the family and the floor count for that slot, so every block of one template reads the same. The slot's floor ceiling is the median of the floor counts its own parcels' envelopes allow, so it follows the skyline of its zone without one clipped parcel flattening every instance; a templated parcel then takes the template's height rather than its own envelope.
- One variation per block instance: a stable hash of the block id either moves one slot's floor count by one within its fits, or merges two adjacent slots of equal depth into one rectangular building, whose lot stands one long building where the neighbouring blocks stand two. The merged-over lot ships nothing.
- A parcel on a block with no template keeps the per-parcel choice: a stable hash of the atlas seed and the parcel id over the families whose published `fits` accept the lot, and the floor count the shared request picked held inside the family's range and the parcel envelope.
- Bays follow the lot: an edge of 8N metres is two 4 m corner arms and N-1 straight bays, so each face places N pieces. `baysAcross` and `baysDeep` are those N counted from the entrance face, the count `fits.bays` is stated in, and a storey places 2 x (across + deep) pieces.
- The floor count is the published family's own range held inside the parcel envelope; the kit states how short its bands stand, and a parcel no family fits keeps the generator. A building shorter than three floors has no ground, middle and crown to fill, so it is not an interior candidate.
- A parcel's blueprint is the plan's, so every copy of a building is the same building. Its openings are numbered from the plan's own pieces, where Exterior numbers a parcel's from the lot's first corner. A composed floor carries no room envelope: Exterior fits that rectangle on the construction lattice under the lot, which a shared plan cannot say, so it is left out rather than approximated. What the parcel decides, its floor kinds and its exterior style, is in the record.
- A composed blueprint is checked against the one Exterior draws for the parcel itself, opening by opening and everything a consumer reads, before the record is written; a drift fails that parcel rather than moving every copy of the plan.
- Pieces are planned with the kit's own seed, so a plan names exactly the piece files the world binds in the shared store.
- Every request is checked against the kit request schema and every result against the placement, plan and record schemas before anything is written, and the piece count must tile the lot.
- A plan placed in a parcel's frame has to stand exactly where Exterior planned that same building on the parcel itself.
- Same blueprint, same kit, same buildings, byte for byte.

## Errors

`E_KIT_MANIFEST` (no kit, or one that fails its schema), `E_KIT_FIT` (asked for a building on a parcel no family fits), `E_KIT_PLACEMENTS` (Exterior refused the request, its result fails a schema or does not tile the lot, a plan does not stand where the parcel was planned, or a standing parcel names a plan the out dir lost). All are `AssemblyError`.

## Depends on

[Exterior's piece kit](../../../../exterior/src/kit/CONTRACT.md), the [Atlas blueprint](../../../../atlas/CONTRACT.md), and [assembly](../CONTRACT.md) for the shared request, the shared store and the world manifest. Exterior publishes piece geometry as fixed for every seed; a plan names pieces by id alone and relies on that.
