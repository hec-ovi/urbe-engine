# Saved native streets

Loads a saved street manifest and its verified asset bytes for Game.

## In and out

`openNativeStreetSource(options)` takes the [source options](schema/ports.d.ts): the world URL, Assembly's street reference, the loaded blueprint's original bytes/data and an optional fetch function. It returns a source with immutable [manifest](../../../../../streets/src/schema/native-result.ts), `readPiece(id, signal?)`, `retainedAtlas()` and `dispose()`.

`readPiece` returns exact SHA-256-checked bytes. The mesh consumer decodes and validates GLBs. The source caches no asset bytes. Piece bounds use city coordinates; the GLB node translation restores `piece.origin`, so consumers do not translate again.

`retainedAtlas()` returns a shallow rendering projection with only `delegated.remainingGroundIndices` and unreplaced module placements. It leaves the original blueprint untouched. Use this projection only for the retained Ground renderer. Planning, movement and gameplay use the complete original blueprint.

## Invariants

- The original blueprint bytes match Assembly's reference before the street manifest loads. The street manifest bytes match its reference. Its source hash follows `blueprintEncoding`: original JSON file bytes or UTF-8 `JSON.stringify` of the parsed blueprint.
- Native catalog and delegated highway/station hashes use UTF-8 `JSON.stringify`, preserving property/array order, with no whitespace or newline. Hashes are checked before freezing the parsed snapshot.
- Replacement and retained ground indices partition the complete original ground exactly. Every replacement has one declared owner. Replaced module planning covers require their module owner in the replacement list.
- Asset paths remain inside the bundle. Pieces have unique IDs, finite city bounds and complete hash/surface metadata. Features retain their declared bounds and footprints independently of asset residency.
- Disposal aborts reads and prevents further requests. Network and identity failures never select older geometry or a different catalog.

## Errors

`E_WORLD_STREETS`: invalid source options/reference, byte or structural hash mismatch, malformed JSON/metadata, invalid ownership/replacement data, invalid piece/feature bounds, unavailable asset, unknown piece, or disposed source. Details identify the failed field or resource. The original cause is retained.

## Dependencies

Streets native request/result contract; Atlas blueprint 0.22.0, 0.23.0 or 0.24.0 with reservations 1.0.0; browser fetch and Web Crypto. This box creates no renderer or geometry.
