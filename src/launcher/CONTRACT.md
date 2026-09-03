# CONTRACT: browser launcher

Purpose: connect the isolated game front door to a catalog and generation API without putting persistence or world generation inside the UI.

## Inputs

- Constructor ports are browser capabilities rather than JSON payloads: `mount` is a DOM element, `api` implements every method below, `navigate(url)` receives a [playUrl](schema/launcher-api.schema.json#/$defs/playUrl), and `download(filename, payload)` receives a [downloadFilename](schema/launcher-api.schema.json#/$defs/downloadFilename) plus [exportResult](schema/launcher-api.schema.json#/$defs/exportResult). Browser navigation and download adapters are the defaults.
- `api.catalog()` takes no parameters and returns [schema/catalog.schema.json](schema/catalog.schema.json).
- `api.continueGame(id)` takes an [id](schema/launcher-api.schema.json#/$defs/id) and returns [continueResult](schema/launcher-api.schema.json#/$defs/continueResult).
- `api.exportGame(id)` and `api.exportCity(id)` take an [id](schema/launcher-api.schema.json#/$defs/id) and return [exportResult](schema/launcher-api.schema.json#/$defs/exportResult).
- `api.importGame(payload)` takes [importInput](schema/launcher-api.schema.json#/$defs/importInput) and returns [schema/catalog.schema.json](schema/catalog.schema.json).
- `api.generateCity(input)` takes [generateCityInput](schema/launcher-api.schema.json#/$defs/generateCityInput) and returns [generateCityResult](schema/launcher-api.schema.json#/$defs/generateCityResult).
- `api.generateInstances(input)` takes [generateInstancesInput](schema/launcher-api.schema.json#/$defs/generateInstancesInput) and returns [generateInstancesResult](schema/launcher-api.schema.json#/$defs/generateInstancesResult).
- `api.generateQuests(input)` takes [generateQuestsInput](schema/launcher-api.schema.json#/$defs/generateQuestsInput) and returns [generateQuestsResult](schema/launcher-api.schema.json#/$defs/generateQuestsResult).
- `api.createGame(input)` takes [createGameInput](schema/launcher-api.schema.json#/$defs/createGameInput) and returns [createGameResult](schema/launcher-api.schema.json#/$defs/createGameResult).

## Outputs

- `start()` mounts one `GameView`, clears its loading surface, opens its main menu, then loads and validates [schema/catalog.schema.json](schema/catalog.schema.json).
- Continue validates the returned play URL before sending it to `navigate(url)`.
- Game and city exports validate a JSON object before sending it to `download(filename, payload)`. Filenames end in `.urbegame.json` or `.urbecity.json`.
- Local game loading reads and parses the selected file, passes the JSON object to `api.importGame`, validates the returned catalog, then opens the games directory.
- Every generation action sets its stage busy, validates the API result, feeds the returned artifact to `GameView.setCreationState`, and clears busy. A new city invalidates downstream artifacts in the UI; a new interior set invalidates quests and the game.
- Creating a game refreshes the catalog when the result does not include one, then opens the games directory.

## Errors

- Missing constructor dependencies throw before anything mounts.
- Catalog, navigation, import and export errors remain on the main menu status line with `role="alert"`.
- City, interior, quest and game generation errors clear the busy stage and appear in the creation view's existing alert.
- Malformed API outputs fail closed before navigation, download or UI state changes.

## Invariants

- This layer owns orchestration only. It imports the UI contract and does not read game, assembly, quest, interior or Atlas implementation code.
- The API owns persistence and generation. The UI owns presentation. The launcher stores neither catalogs nor generated artifacts.
- One `start()` call mounts one view. Later calls do nothing.
- JSON files are parsed before they cross into the API. Invalid JSON never reaches `api.importGame`.
- No API rejection escapes an event listener as an unhandled promise rejection.

## How to modify this blackbox safely

Keep changes inside `src/launcher`. Update both schemas before changing API shapes, exercise actions through the real menu with user-event, and verify invalid input and rejected API calls do not navigate or download.

## Depends on

- `../ui/CONTRACT.md`
