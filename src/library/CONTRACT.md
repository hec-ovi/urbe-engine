# CONTRACT: city and game library

## Purpose

Discovers, validates, loads and saves deterministic city and game descriptors under one output directory.

## Inputs

- `createLibrary(config = {})`: [schema/library-config.schema.json](schema/library-config.schema.json). `outDir` defaults to `out` and contains direct child directories `cities/<id>/city.json` and `games/<id>/game.json`.
- `discover(request = {})`, `listCities(request = {})`, `listGames(request = {})`: [schema/query.schema.json](schema/query.schema.json).
- `loadCity(reference)`, `loadGame(reference)`: [schema/descriptor-ref.schema.json](schema/descriptor-ref.schema.json).
- `saveCity(descriptor)`: [schema/city-descriptor.schema.json](schema/city-descriptor.schema.json). City descriptors are create-only.
- `saveGame(request)`: [schema/save-request.schema.json](schema/save-request.schema.json). A new or imported save uses `expectedRevision: null`. An update names the current revision and supplies the next one.

## Outputs

- `discover`: [schema/library-catalog.schema.json](schema/library-catalog.schema.json).
- `listCities`: [schema/city-catalog.schema.json](schema/city-catalog.schema.json).
- `listGames`: [schema/game-catalog.schema.json](schema/game-catalog.schema.json).
- `loadCity`: [schema/city-descriptor.schema.json](schema/city-descriptor.schema.json).
- `loadGame`: [schema/game-descriptor.schema.json](schema/game-descriptor.schema.json).
- `saveCity`: [schema/city-save-result.schema.json](schema/city-save-result.schema.json).
- `saveGame`: [schema/save-result.schema.json](schema/save-result.schema.json).
- Thrown `LibraryError`: [schema/library-error.schema.json](schema/library-error.schema.json).

## Events

None.

## Errors

Closed set: `E_INVALID_REQUEST`, `E_INVALID_ID`, `E_CITY_NOT_FOUND`, `E_GAME_NOT_FOUND`, `E_INVALID_DESCRIPTOR`, `E_REFERENCE_NOT_FOUND`, `E_REVISION_CONFLICT`, `E_EXISTS`, `E_UNSAFE_PATH`, `E_STORAGE`.

## Dependencies

None. City resources and quest bundles cross this boundary as checksummed file-reference envelopes.

## Invariants

- Discovery scans only direct child directories and orders descriptors by id using code-point order.
- Every read and write validates its schema and cross-record relations. One malformed record fails the operation.
- A city records every building and whether it can host an interior. A game references one existing city, matches its size and selects only eligible buildings. The city remains a shell-only artifact; selected interiors belong to the game.
- A game save carries its exact position and heading, current and discovered locations, quest and side-job progress, inventory, revision and elapsed play time.
- IDs cannot contain path separators. Resource URIs are relative to their descriptor directory and cannot contain empty, current or parent segments.
- Descriptor paths cannot be symbolic links. Save replacement is atomic within one filesystem.
- Save timestamps and revisions come from the request. JSON object keys are recursively sorted, arrays keep their authored order, indentation is two spaces and files end with one newline.

## How to modify this blackbox safely

Change `schema/` and this contract before changing the public surface in `index.js`. Keep filesystem code in `src/`, test through `index.js`, and run `npm test -- src/library/tests/library.test.js`.
