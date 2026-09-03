# CONTRACT: light (game inner box)

Purpose: turns every fixture the world published into real light, in photometric units, at a cost that does not grow with the city.

## In
- **Exterior fixtures**: `[{ position: Vector3, lumens, color: Color, range }]`, one per emitter the world actually built (lamp lens, venue sign, entrance fixture, ad screen). Producers are `city/StreetLamps.js` and `city/Neon.js`.
- **Rooms**: objects carrying `{ center, area, albedo: Color, floorAlbedo: Color, flux, color, fixtures, wear(binding, roomLights), binding }`. Built by `city/InteriorRooms.js` from the interior box's floor documents.
- **Room fixtures**: the published `lights` entries of a floor, as `{ kind: 'spot'|'strip'|'cove', position, lumens, color, range, beamDeg, diffuse, length, angleDeg, facing }`.
- A quality descriptor (`look/QualityTier.js`): `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `haze`.
- The renderer, after `init()`.

## Out
- `LightingSystem.install(renderer, tier) -> { capacity }`: swaps in the lighting system the backend can run and returns how many fixtures may be lit at once.
- `CityLights(fixtures, capacity)`: `group` of fixed point-light slots to add to the scene, `update(position, delta)` copies the nearest published fixtures into those slots, `count`, and `airColor(position) -> { color, lux }`, the colour of the light filling the air at a point.
- `RoomLights(factory, tier)`: `update(rooms, position, delta)` binds the nearest rooms to light slots and writes their fixtures and fill into them; `materialFor(binding, key)` is the material a room's mesh wears, and `dim` is the binding for interior geometry belonging to no room. Materials are node materials: a standard one loses `lightsNode` in the conversion the renderer does for it.
- `RoomFill.apply(light, room, flux, color)`: writes the computed interreflected fill onto a hemisphere light. `albedoOf(key)` is the reflectance of a material kind.
- `Haze.build(fixtures, { spread, cap }) -> Mesh | null`: one merged additive glow mesh, the air lit around each fixture.
- `kelvinColor(kelvin) -> Color`: blackbody temperature to light colour. `luminance(color)` is its relative brightness.

## Units
- `lumens` is luminous flux as the interior and exterior boxes publish it. Point lights take it through `power`, rect area lights through `power` after sizing, spot lights as candela over their own cone solid angle, because `power` assumes a 120 degree cone.
- `decay` is 2 everywhere. `distance` is the published `range` and is never 0: a clustered light with a zero radius is binned nowhere and silently emits nothing.
- A light probe's `color * intensity` is irradiance in lux, which is what makes the room fill computable.

## Invariants
- No light invents a brightness. Every level traces to a published figure, so relative brightness stays consistent across the whole city and one exposure works everywhere.
- There is no ambient light. The floor under the shadows is lit air and an environment probe, both in the look box.
- Room light sets come from a fixed pool of light objects whose ids never change. A lights node hashes light ids into the shader cache key, so a set built per room would compile a shader per room.
- Exterior fixtures use a fixed pool of unshadowed point-light objects whose ids never change. Walking copies position, colour, range and power from the nearest fixtures into those slots. Daylight sets their power to zero without removing them from the scene. The renderer therefore keeps the same light cache key for every frame.
- Exterior slots are exactly the set clustered lighting bins on the GPU; nothing else may join that set.

## Errors
None thrown. A room with no fixtures gets a dark fill; a backend without clustering gets batching.

## Depends on
- ../../../CONTRACT.md's material factory for a key's base material and measured tint
- ../look/CONTRACT.md for the quality descriptor
- ../../../../interior/CONTRACT.md for the published floor `lights` and `rooms`
