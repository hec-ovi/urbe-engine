# Kit assembly

Turns an Atlas parcel into a table of Exterior kit pieces, so a city ships a few hundred shared pieces and one small table per building instead of a unique shell each.

## In

- Atlas parcel: `id`, `lot` (a rectangle whose sides are whole 8 m bays), type and tier, floor envelope, `landmark` flag, access point and street, from the city blueprint.
- The shared request fields come from `RequestAssembler.assemble(parcelId)`: seed, building id, parcel frame, type, tier, floor count and marquee text.
- The published piece kit: `kit.json` and its piece GLBs, from Exterior's kit CLI. `KitManifest.load(dir)` validates it against [kit.schema.json](../../../../exterior/schemas/kit.schema.json); the directory defaults to the sibling build and `URBE_KIT_DIR` overrides it. `KitManifest.find(dir)` is the same load, returning null when that directory publishes no kit at all, so a machine without Exterior's build still assembles its city.
- Exterior `planAssembly`, called in process. Its input follows [kit-request.schema.json](../../../../exterior/schemas/kit-request.schema.json) and its result [placement.schema.json](../../../../exterior/schemas/placement.schema.json).

## Out

`KitAssembler(atlas, requestAssembler, kit)`:

- `candidate(parcelId)` is the kit building this parcel gets, or null when it keeps the generator.
- `build(parcelId, parcelDir)` writes both files and returns the table. It also drops the `<parcel>.glb` and `<parcel>.request.json` of a generated shell that stood on the parcel before, so the folder holds one building and the world ships no dead geometry. The reverse is the city CLI's: a parcel it sends back to the generator loses its table.

`<out>/<parcel>/<parcel>.placements.json` follows [kit-placements.schema.json](kit-placements.schema.json): `parcel`, `family`, `baysAcross`, `baysDeep`, `floors`, `signText`, `lot` (the ground it was built on), `bounds` (the world box of its massing), and `plan`, which is Exterior's placement result verbatim: `family`, `bands`, `placements`, `signAnchors`, `doors`. Exterior plans in the parcel's own metres, so positions are world positions and a building carries no transform of its own.

`<out>/<parcel>/<parcel>.blueprint.json` is the same blueprint a generated shell publishes, so the streaming catalog, rooftop fitting and the game read both paths the same way. A kit parcel has no `<parcel>.glb`: the game draws it from the pieces.

`<out>/kit/` is the published kit copied once per city. `KitManifest.publish(outDir)` copies it, or keeps it when the world is already being built from its own copy, and returns the manifest reference `{ file: "kit/kit.json", sha256 }`; the manifest's `sources` names the parcels that took this path.

## Rules

- A parcel keeps the generator when it is a landmark, when its lot is not a rectangle of whole bays, when connections carve its facade or it needs a basement, when no family fits its height, or when the run furnishes its interior, which is built into a generated shell.
- Family choice is a stable hash of the atlas seed and the parcel id over the families whose published `fits` accept the lot and the floor count.
- Bays follow the lot: an edge of 8N metres is two 4 m corner arms and N-1 straight bays, so each face places N pieces. `baysAcross` and `baysDeep` are those N, the count `fits.bays` is stated in, and a storey places 2 x (across + deep) pieces.
- Floors are the count the shared request picked, held inside the family's own range and its height: ground plus (F-2) middle bands plus the crown must fit the parcel envelope. Three floors is the minimum a kit building has.
- Pieces are planned with the kit's own seed, so the table names exactly the piece files published beside the world.
- Every request is checked against the kit request schema and every result against the placement and table schemas before anything is written, and the piece count must tile the lot.
- Same blueprint, same kit, same buildings, byte for byte.

## Errors

`E_KIT_MANIFEST` (no kit, or one that fails its schema), `E_KIT_FIT` (asked for a building on a parcel no family fits), `E_KIT_PLACEMENTS` (Exterior refused the request, or its result fails a schema or does not tile the lot). All are `AssemblyError`.

## Depends on

[Exterior's piece kit](../../../../exterior/src/kit/CONTRACT.md), the [Atlas blueprint](../../../../atlas/CONTRACT.md), and [assembly](../CONTRACT.md) for the shared request and the world manifest. Exterior publishes piece geometry as fixed for every seed; the table names pieces by id alone and relies on that.
