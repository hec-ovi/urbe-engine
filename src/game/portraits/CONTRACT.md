# CONTRACT: portraits

Purpose: small pictures of the game's own things, drawn by the game's renderer, for screens that show them: a person's face from their own avatar and a place's own building.

## In

- `Snapshots({ renderer, size = 256, encode? })`: the game's renderer. `take( stage )` queues one picture; `stage()` (it may be async) answers `{ scene, camera, done?() }`, or null when there is nothing to draw. `step()` does one piece of work: stages the picture asked for last (a screen asks last for what it shows now), or draws the staged one into a `size` square render target (half floats on WebGPU, floats on WebGL) and starts reading it back; it does nothing while a stage or a read is under way. The host steps it (GameApp does once a frame while the world holds still: paused, or a panel open), so a picture never costs a frame of play.
- `Portraits({ snapshots, poser, sim })`: the [CharacterPoser](../agents/CONTRACT.md) the focused rig shares and the simulation port (`getNPC`). `portrait({ npcId } | { recipe })`: the person's recipe is the look the crowd dresses them in (`Crowd.personLook`), or the recipe given.
- `BuildingShots({ snapshots, pieces, buildings, readJson? })`: the [kit runtime](../city/kit/CONTRACT.md)'s `KitPieces`, whose `plans` hold every plan the city has stood this run, and the building sources by parcel id. `building( parcelId )` reads the parcel's placement record for the plan it is a copy of.

## Out

- Every picture is a URL (a PNG blob), or null when it cannot be had, and each is drawn once: a portrait per recipe, a building per plan, whoever asks.
- A drawing is the probe's: the render target bound, no MRT, no tone mapping, linear output, a clear of nothing; the renderer's target, MRT, tone mapping, output colour space and clear colour are put back. The read-back is tone mapped (ACES) and encoded to sRGB over a neutral dark backdrop (a soft radial falloff, every border at its edge colour so the square shows no seam on a ground of that colour) in script, top row first.
- A portrait: the person dressed from their recipe (body shape, skin, hair and hairstyle, eyes, garments, height) as the focused rig is (`CharacterPoser.pose`), held at three tenths of the idle clip, pictured head and shoulders from their front left and a little above (a 24 degree lens, 1.5 m off the head bone, the frame centred on it), under a warm key, a cool rim and a soft sky; the rig goes back to the poser once drawn.
- A building: the plan's facade surfaces and door leaves, each wearing one plain material with the facade material's colour and colour map (glass dark and plain), on a dark plinth a quarter wider than the footprint, framed whole from the front right and above (a 30 degree lens). Window scenery and storey plates are left out. The picture draws the plan's own attributes under geometry of its own, let go once drawn, so its upload leaves with it.

## Errors

None thrown to the caller: a person the city does not hold, a recipe that cannot be dressed, a parcel that is not a kit building, a plan the city has not stood this run (a building out of reach since the game started) and a renderer that fails all resolve null, with a warning when dressing or drawing fails, and the screen shows its own stand-in.

## Depends on

[Agents](../agents/CONTRACT.md) (CharacterPoser, Crowd's look), [kit runtime](../city/kit/CONTRACT.md) (KitPieces), three's WebGPU renderer on either backend.
