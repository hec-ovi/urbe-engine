# CONTRACT: ui (engine inner box)

Purpose: every screen the player sees over the game, as plain DOM components that are handed values and report intents through callbacks; no game logic, no scene code.

Layout: `views/` are full panels and the overlays that assemble them, `widgets/` are the small HUD pieces and popups, `components/` are shared primitives and every stylesheet. Each class exposes `element` (its root node); inputs are `set*` methods or constructor props, outputs are constructor callbacks.

## GameView (views/GameView.js)
The whole game overlay. `mount( parent )` appends it.
- props (all optional): `onResume()`, `onCloseDialog()`, `onSend( text )`, `onOpen( name )`, `onClose()`, `onLeave()`, `onSettingChange({ key, value })`, `onHangUp()`, `onSummaryClose()`, `onTransitSelect(value)`, `onTransitCancel()`, `menu` (the `MainMenuView` callbacks below)
- methods: `open( name )`, `close()`, `toggle( name )` with name one of `QUESTS`, `MAP`, `INVENTORY`, `CODEX`, `SETTINGS`, `CONTROLS`; `setPaused( bool )` shows the pause screen and the tab bar together (the bar is hidden while playing and shown while paused or while a panel is open); `step( text )`, `ready()`, `fail( message )` drive the loading surface
- `setObjective({ title, objective, state: 'active' | 'done' } | null)` updates the persistent gameplay objective; null or an object with no title and no objective hides it
- front-door methods: `showMainMenu()`, `hideMainMenu()`, `setLibrary(data)`, `setCreationState(data)`. While the menu is shown, gameplay UI is inert and hidden from assistive technology.
- children the game feeds directly: `clock`, `prompt`, `readout`, `stats`, `objective`, `minimap`, `pause`, `avatar`, `call`, `toast`, `dialog` (ChatPanel), `summary`, `transit`, `map`, `inventory`, `quests`, `codex`, `settings`, `controls`, `tabs`, `panels`, `mainMenu`

## MainMenuView (views/MainMenuView.js)
The full-screen front door. It owns display and selection state only. Storage, generation and game launch remain caller responsibilities.
- callbacks (all optional): `onContinue(gameId)`, `onSave(gameId)`, `onLoad(file)`, `onExportCity(cityId)`, `onGenerateCity(input)`, `onGenerateInstances(input)`, `onGenerateQuests(input)`, `onCreateGame(input)`
- methods: `show()`, `hide()`, `openLibrary('games' | 'cities')`, `createNew()`, `createFromCity(city)`, `setLibrary(data)`, `setCreationState(data)`. `show()` focuses the first enabled menu action; the open directory or creation surface is exposed as the current action.
- `setLibrary({ games, cities })`: both arrays are optional. A game may provide `{ id, name, cityName, theme, playable, mainSteps, sideJobs, interiors, location, position: [x,y,z], activeQuest: { title, objective }, inventory, locations }`. A city may provide `{ id, name, seed, size, status, buildings, interiorCount, districts, summary, availableBuildings }`.
- absent callbacks disable their corresponding control. The menu says when loading is not connected, and each creation stage says when its generator is not connected.
- `onLoad(file)` receives the browser `File` selected by the player. The input accepts JSON game files and clears after every selection.

## GameLibraryView (views/GameLibraryView.js)
The two local directories rendered by the front door.
- methods: `setLibrary({ games, cities })`, `showDirectory('games' | 'cities')`
- `mostRecentGame` returns the first playable game, or null
- game cards show current location and exact position, active quest and objective, recent locations, inventory and content counts
- city cards show generation identity and counts, then report setup or export intent through the callbacks supplied by `MainMenuView`

## NewGameView (views/NewGameView.js)
The four-stage creation surface. A later stage remains locked until the caller supplies the preceding artifact through `setCreationState`.
- Stage 1, City: reports `onGenerateCity({ name, seed, size })`, where size is `small`, `medium` or `large`. Name and seed are required.
- Stage 2, Interiors: reports `onGenerateInstances({ cityId, mode, count, buildingIds })`. Automatic mode defaults to 9 and accepts 9 through 24, reserving seven main-story locations and two unique side-job locations. Manual mode preserves explicit selection and requires 1 through 24 eligible buildings.
- Stage 3, Story and jobs: reports `onGenerateQuests({ cityId, interiorIds, mainBrief, sideJobs })`. Side jobs is 0 through 3 and defaults to 3. The main brief may be blank so the story can derive from the city.
- Stage 4, Playable game: reports `onCreateGame({ cityId, interiorIds, questId })` only after city, interiors and quests exist.
- methods: `reset()`, `beginWithCity(city)`, `setCreationState(update)`, `open(step)`
- `setCreationState` accepts any supplied part of `{ city, instances, quests, game, busy, error }`. The caller owns the artifacts and uses `busy` with one of `city`, `instances`, `quests`, `game` to lock duplicate actions.
- stage progress is a polite live status; the active pane exposes `aria-busy` while its caller action runs.

## PanelHost (views/PanelHost.js)
One panel over the game at a time.
- props: `views: { NAME: view }`, `onOpen( name )`, `onClose()`
- methods: `open( name )`, `close()`, `toggle( name )`; `current` is the open name or null
- a view is `{ element, shown?() }`; `shown` runs once the view is on screen
- Escape closes while a panel is open; opening one closes the one before
- the open view is an accessible dialog, receives focus, and becomes inert immediately when closed; focus returns to the outside control that opened it when that control remains visible

## Views (one full panel each; every one takes `onClose()`)
- **Map3DView** (the MAP panel): `setWorld({ bounds: { min: [x,z], max: [x,z] }, buildings: [{ ring: [[x,z]], height }], ground: [{ surface, polygon: [[x,z]] }] })` raises every building as a prism and lays the ground cover as plates; `setVenues([{ point: { x, z }, open }])`, `setRoute({ path: [[x,z]], label } | null)`, `setPlayer( position, heading )`, `centre()`; drag turns, wheel zooms, the frame renders only on a change; `shown()` creates the WebGL renderer sized to the stage.
- **MinimapView** (HUD corner, always on): `setMap( map )` same shape without stations or markers, `setVenues( venues )`, `setRoute({ path: [[x,z]], label } | null)`, `update( position, heading )` each frame, `toggle()`, `setVisible( bool )`
- **InventoryView**: `setItems([{ id, name, kind, description, place }])` in slot order over 30 slots, `select( index )` (-1 clears); clicking a slot selects it, exposes the pressed state, and shows its detail
- **QuestsView**: `setQuests([{ id, title, text, state: 'active' | 'done' | 'failed', steps: [{ text, done }] }])`, `select( id )`; the selected row exposes its pressed state; empty reads "no quest yet"
- **CodexView**: `setEntries([{ id, title, category, text }])` grouped by category, `select( id )`; the selected row exposes its pressed state; empty reads "nothing recorded yet"
- **SettingsView**: props `onChange({ key, value })`; `setValues({ quality, fog, exposure, crowd })`. Fields: `quality` select (`low`, `medium`, `high`, `ultra`), `fog` range 0..0.003, `exposure` number, `crowd` number. Numeric values arrive as numbers.
- **ControlsView**: `setBindings([{ action, keys: [string] }])`; empty reads "no bindings yet"
- **BuildingView**: the building viewer overlay; `setStatus(text)` reports preparation and the selected source, `showError(message)` puts a fatal failure on screen, and its controls report source and floor-slice changes.
- **ExperimentView**: the scale experiment overlay (props in the file).

## Widgets
- **LibraryCard**: renders one game or city archive row. Game actions report continue/save by game id; city actions report setup/export by city id. Missing handlers create disabled buttons.
- **CreationSteps**: `set(current, unlocked)` marks one of four creation stages current, completed or locked and reports enabled stage selection.
- **TabBar**: props `onSelect( name )`, `onLeave()`; `setActive( name | null )`. Seven entries in order with their key letters: QUESTS J, MAP M, INVENTORY I, CODEX X, SETTINGS O, CONTROLS ?, LEAVE N. Keys are labels: the game binds them and calls `open`. Panel buttons expose their pressed state.
- **ChatPanel**: props `onSend( text )`, `onClose()`; `setNpc({ name, role })`, `setProfile({ facts: [[key, value]], now, routine: [line] } | null)`, `addMessage({ from: 'npc' | 'player', name, text })`, `setTranscript( messages )`, `show( conversation | null )` (a simulation `{ instance, behavior }` becomes name, profile and an empty transcript; null hides), `setVisible( bool )`. Header with the name and Esc, the transcript, the input "say something" with a send button; Enter sends, Escape in the input closes, blank text is never sent.
- **AvatarCard** (top left): `setAvatar({ name, portraitUrl | canvas, bar })` with bar in 0..1 over 12 segments, `setVisible( bool )`; hidden until the first call
- **VideoCallPanel**: props `onHangUp()`; `setStream( videoOrCanvas )`, `setName( name )`, `setVisible( bool )`
- **MissionToast**: `show({ title, text })` slides in under the clock, holds, fades out and removes itself (about 4.4 s)
- **CurrentObjective**: `setObjective({ title, objective, state: 'active' | 'done' } | null)`; an active or completed objective stays quietly visible and opens QUESTS when activated, while null hides and clears it
- **MissionSummary**: props `onClose()`; `show({ title, text, outcome: 'done' | 'failed', steps: [{ text, done }] })`, `setVisible( bool )`; it opens as a named dialog focused on continue, and continue or Escape reports the close
- **HudClock**: `update( time, place )`, `setState( 'dawn' | 'day' | 'dusk' | 'night' )`
- **InteractPrompt**: `update( text | null )`
- **LocationReadout**: `update( position, district, parcel )`, `setAbout( paths )`
- **DebugStats**: `update( stats )` with `{ backend, tier, width, height, frameMs, gpuMs, drawCalls, triangles, lights, crowd, cars, interiors, materials, unresolved, hitches, worstMs }`; the first row names the backend, the tier and the render size, warned on the fallback backend; then how many material keys resolved, warned while any has not, and last whether the run has stalled and by how long, warned once it has
- **PauseMenu**: props `onResume()`; `setVisible( bool )`
- **TransitHud**: props `onSelect(value)`, `onCancel()`; `choose([{ id, label, value }])` opens an accessible service dialog with one focused button per candidate, Enter selects, and Escape or cancel reports cancellation. `close()` removes it, `open` reports its state, and `ride(text | null)` shows or clears the current line and next stop.

## Components
`dom.el`, `Icon.icon( name )`, `KeyCap.keyCap( text )`, `PanelHeader` (title, key hint, Esc button), `EmptyState.emptyState( text )`, `SettingField`, `Button`, `SelectField`, `MenuButton.menuButton`. Stylesheets: `game.css` (palette and HUD chrome), `tabbar.css`, `panels.css`, `views.css`, `chat.css`, `mission.css`, `launcher.css` (front door and creation stages), `styles.css` (viewer and experiment overlays).

## Invariants
- Presentation only: nothing here reads game state or touches the scene. The game overlay (GameView and everything it mounts) imports nothing from outside `src/ui`; ExperimentView alone reads the scale experiment's option lists.
- No rounded corners anywhere: no `border-radius` in any stylesheet.
- The tab bar always shows each entry's key letter, and is only on screen while paused or while a panel is open.
- One full panel at a time; Escape closes it.
- Maps redraw on pan, zoom, turn or data change, never per frame on their own.
- At narrow viewport widths, the front door compacts its navigation, the tab bar keeps all seven actions visible, and dialogs and panels remain inside the viewport.
- A city is a generated world artifact. A game is the final city plus its selected interiors, quests and playthrough. The UI never presents these as the same directory.
- Creation order is enforced in the UI: city, interiors, story and side jobs, playable game.

## Tests and preview
`*.test.js` beside each view and widget, Testing Library plus user-event on jsdom (`// @vitest-environment jsdom`), one per declared input, output and event. `test-helpers/canvas.js` gives jsdom a recording 2d context.
`preview.html` shows the whole overlay with sample data and no game behind it, starting on the game directory: `npm run dev`, then `/src/ui/preview.html`.

## Depends on
Nothing outside this folder. The game (`src/game/CONTRACT.md`) is the caller.
