# CONTRACT: light (game inner box)

Purpose: turns every fixture the world published into real light, in photometric units, at a cost that does not grow with the city.

## In
- **Exterior fixtures**: `[{ position: Vector3, lumens, color: Color, range }]`, one per emitter the world actually built (lamp lens, venue sign, entrance fixture, ad screen, transit glow). Producers are `city/StreetLamps.js`, `city/Neon.js` and `transit.glows`.
- **Rooms**: objects carrying `{ center, area, albedo: Color, floorAlbedo: Color, flux, color, fixtures, fill: Vector4 }`. Built by `city/InteriorRooms.js` from the interior box's floor layouts; their surfaces are drawn by the shared module draws, so a room carries measurements and fixtures, not geometry. `fill` is the room's interreflected irradiance in lux and its floor reflectance, what every copy standing in the room carries; `floorFill(rooms)` is the same for a copy in no published room, the floor's rooms taken together.
- **Room fixtures**: the published `lights` entries of a floor, as `{ kind: 'spot'|'strip'|'cove', position, lumens, color, range, beamDeg, diffuse, length, angleDeg, facing, axis?, direction?, furniture? }`. A cove stands at a wall's top facing up or at its foot facing down as well as under the ceiling; `furniture` names the placement whose module carries the lens.
- A quality descriptor (`look/QualityTier.js`): `roomSlots`, `roomSpots`, `roomStrips`, `clusteredLights`, `batchedLights`, `haze`.
- The renderer, after `init()`.

## Out
- `LightingSystem.install(renderer, tier) -> { capacity }`: swaps in the lighting system the backend can run and returns how many fixtures may be lit at once.
- `CityLights(fixtures, capacity)`: `group` of fixed point-light slots to add to the scene, `update(position, delta)` selects nearby published fixtures with stable assignments and smooth handoffs, `count`, and `airColor(position) -> { color, lux }`, the colour of the light filling the air at a point.
- `CityLights(fixtures, capacity, {streamed:true})` reserves the complete fixed slot pool. `setFixtures(fixtures)` replaces resident sources, retaining dimming by fixture identity. Empty slots emit zero power and retain their renderer identity.
- `RoomLights(factory, tier)`: `update(rooms, position, delta)` binds the nearest rooms to light slots and writes their fixtures into them; `materialFor(key, source?)` is the material a room surface wears, lit by `pool.lightsNode`, the one lights node holding every slot's spots and strips and the per-copy fill. A source Three material keeps its PBR maps, factors, face behavior and alpha threshold, with an independent clone per source identity. Source unlit materials stay unlit. `releaseSources(materials)` disposes those clones; `releaseRooms(rooms)` clears dropped room references from the slots. Catalog materials remain cached. Materials are node materials so room lighting survives renderer conversion.
- `RoomFillNode`: the lighting node in the pool that reads each copy's fill from the channel its mesh publishes under `Symbol.for('urbe.fill-channel')` (`{ texture }`, one RGBA float texel per instance id: irradiance and floor reflectance) and adds it as irradiance, the upper half the fill and the lower half the fill bounced off the floor. A mesh publishing no channel adds nothing.
- `RoomFill.irradiance(room, flux, color)` is the computed interreflected fill in lux; `RoomFill.perCopy(room, flux, color)` is it as a copy carries it. `albedoOf(key)` is the reflectance of a material kind.
- `Haze.build(fixtures, { spread, cap }) -> Mesh | null`: one merged additive glow mesh, the air lit around each fixture.
- `kelvinColor(kelvin) -> Color`: blackbody temperature to light colour. `luminance(color)` is its relative brightness.

## Units
- `lumens` is luminous flux as the interior and exterior boxes publish it. Point lights take it through `power`, rect area lights through `power` after sizing, spot lights as candela over their own cone solid angle, because `power` assumes a 120 degree cone.
- `decay` is 2 everywhere. A fixture's `range` is a useful radius, raised to its distance from the surface it faces (the floor for a downlight or a cove at a wall's foot, the ceiling for a cove facing up) so its beam never ends in mid air, and is never 0: a clustered light with a zero radius is binned nowhere and silently emits nothing. A room spot's `distance` stands 2.5 times that reach, because Three's window term falls to zero **at** the cutoff: a downlight whose cutoff were its own height would deliver exactly nothing to the floor under it, and at this margin that floor keeps about 95 percent of its inverse-square value while the light still ends inside the room. Exterior fixtures keep `distance` at their published range, which is a reach and not a surface.
- A light probe's `color * intensity` is irradiance in lux, which is what makes the room fill computable.

## Invariants
- No light invents a brightness. Every level traces to a published figure, so relative brightness stays consistent across the whole city and one exposure works everywhere.
- There is no ambient light. The floor under the shadows is lit air and an environment probe, both in the look box.
- Room lights come from a fixed pool of light objects whose ids never change, and every room material wears the one lights node holding all of them. A lights node hashes light ids into the shader cache key, so a set built per room would compile a shader per room. The fill is never in that node: a fill light there would reach every room in the city at once, so it rides on each copy instead.
- Exterior fixtures use a fixed pool of unshadowed point-light objects whose ids never change. Walking copies position, colour, range and power from the nearest fixtures into those slots. Daylight sets their power to zero without removing them from the scene. The renderer therefore keeps the same light cache key for every frame.
- Exterior slots are exactly the set clustered lighting bins on the GPU; nothing else may join that set.
- Runtime replacement fades a slot out, relocates it at zero power, then fades it in over 0.5 seconds. Retained sources keep their slots; a 15 percent squared-distance preference prevents repeated swaps at a boundary. Startup selects immediately. Streaming preserves retained fixture identities and dimming.

## Errors
None thrown. A room with no fixtures gets a dark fill; a backend without clustering gets batching.

## Depends on
- ../../../CONTRACT.md's material factory for a key's base material and measured tint
- ../look/CONTRACT.md for the quality descriptor
- ../../../../interior/CONTRACT.md for the published floor `lights` and `rooms`

Colored interior lenses retain their published linear RGB. Optional world `axis` and `direction` vectors orient vertical or sloped lines; defaults use XZ `angleDeg` and vertical `facing`. Rectangular lights emit through local -Z; their width follows the lens axis.
