# Kit assembly

Turns an Atlas parcel into a placement table of Exterior kit pieces, so a city ships one small table per building instead of one unique shell.

## In

- Atlas parcel: `id`, lot size (a multiple of 8 m on both sides), building type and tier, floor count, `landmark` flag, access point and seed, from the city blueprint.
- Exterior kit manifest `kit.json` and its schema (`../../../exterior/schemas/kit.schema.json`): families, pieces, module (8 m bay, 4 m corner arm, 4.5 m floor), what each family fits.
- Exterior `planAssembly` (`../../../exterior/src/kit/`), whose result follows `../../../exterior/schemas/placement.schema.json`.

## Out

- `<out>/<parcel>/<parcel>.placements.json`: the placement result as Exterior published it, plus `family`, `baysAcross`, `baysDeep`, `floors`, `bounds` and the parcel transform. Written for every ordinary parcel.
- `<out>/<parcel>/<parcel>.blueprint.json`: the building blueprint Exterior emits for the assembled building (openings, doors, floors), so Interior, Connections, Simulation and the runtime read every building the same way.
- Landmark parcels keep the per-parcel generator and its `<parcel>.glb`; the manifest marks which path each parcel took.
- `<out>/kit/`: the piece files and `kit.json` copied once per city, hashed in the manifest.

## Rules

- Family choice is a stable hash of the atlas seed and parcel id over the families whose `fits` accept the lot and floor count; identical lots and types ask for identical buildings.
- Bays across and deep follow the lot: an edge of 8N metres is two 4 m corner arms and N-1 bays. Height repeats middle bands; nothing is stretched.
- Every placement table validates against the placement schema before it is written; a parcel whose family fits nothing falls back to the generator and is reported as such.
- Same blueprint, same kit, same placements, byte for byte.

## Errors

`E_KIT_MANIFEST` (missing or invalid kit), `E_KIT_FIT` (no family fits and the generator was not allowed), `E_KIT_PLACEMENTS` (result fails its schema).

## Depends on

Exterior kit contract, Atlas blueprint, the assembly manifest.
