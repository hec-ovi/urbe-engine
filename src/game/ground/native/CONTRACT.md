# Saved native streets

Loads a saved street manifest, with the piece kit and placement table it publishes, and serves its asset bytes to Game.

## In and out

`openNativeStreetSource(options)` takes the world URL, Assembly's street reference (`streets/manifest.json` with the manifest, kit and blueprint byte hashes, and optional `sharedKit` under `/out/shared`), the loaded blueprint's original bytes/data, optional `sharedBase` (default `/out/shared`) and an optional fetch function. It returns a source with immutable [manifest](../../../../../streets/src/schema/native-result.ts), `readPiece(id, signal?)`, `retainedAtlas()` and `dispose()`. [Ports](schema/ports.d.ts) name the required fields; `sharedKit` and `sharedBase` are the shared-store path the runtime also accepts.

The manifest carries the piece kit and the placement table it was published with, so both are covered by its own byte hash. `readPiece` returns the bytes of the file the kit names for that id: from `${sharedBase}/${sharedKit}/` when the reference carries `sharedKit`, otherwise from the directory the manifest's `files.kit` sits in. The kit runtime checks them against the size and SHA-256 the kit publishes and decodes them. The source caches no asset bytes. Kit bounds are piece-local and each placement puts its copy in the world.

`retainedAtlas()` returns a shallow rendering projection with only `delegated.remainingGroundIndices` and unreplaced module placements. It leaves the original blueprint untouched. Use this projection only for the retained Ground renderer. Planning, movement and gameplay use the complete original blueprint.

## Invariants

- The original blueprint bytes match Assembly's reference before the street manifest loads. The street manifest bytes match its reference. Its source hash follows `blueprintEncoding`: original JSON file bytes or UTF-8 `JSON.stringify` of the parsed blueprint.
- Native catalog and delegated highway/station hashes use UTF-8 `JSON.stringify`, preserving property/array order, with no whitespace or newline. Hashes are checked before freezing the parsed snapshot.
- Replacement and retained ground indices partition the complete original ground exactly. Every replacement has one declared owner. Replaced module planning covers require their module owner in the replacement list.
- Asset paths remain inside the bundle. Kit pieces have unique ids and files, finite local bounds, positive byte and triangle counts, complete hash metadata and only surfaces the catalog binds. The kit names four scan cells the catalog binds and the glyph charset its text indexes. Every placement names a kit piece, a finite position and yaw, its own cell, its owners and, where it carries one, a positive scale.
- A placement's shader values stay in the range its material can read: `wear` and each `tint` channel in 0 to 1, `scan` a finite offset with a positive scale, and every `text` index a glyph the kit publishes. Wear reaches the shader per placement, so a bundle that bakes it into its vertices instead is refused.
- Coverage stays exact: the constructed surface leaves nothing of the retained reservations missing and nothing outside them. Overhangs are drawn and collidable as they stand, so `report.overhangs` is read for its own consistency alone: each accepted entry names a placement in the table, a piece in the kit and its own boundary and fringe areas.
- Features retain their declared bounds and footprints independently of asset residency.
- Disposal aborts reads and prevents further requests. Network and identity failures never select older geometry or a different catalog.

## Errors

`E_WORLD_STREETS`: invalid source options/reference, byte or structural hash mismatch, malformed JSON/metadata, invalid ownership/replacement data, invalid piece/feature bounds, unavailable asset, unknown piece, or disposed source. Details identify the failed field or resource. The original cause is retained.

## Dependencies

Streets native request/result contract, manifest 0.5.0 with kit and placements 1.2.0; Atlas blueprint 0.26.0 with planning reservations 2.1.0; browser fetch and Web Crypto. This box creates no renderer or geometry.
