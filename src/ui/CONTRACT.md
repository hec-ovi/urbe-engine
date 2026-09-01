# CONTRACT: ui (engine inner box)

Purpose: every screen the player sees over the game, as plain DOM components that are handed values and report intents through callbacks; no game logic, no scene code.

Layout: `views/` are full panels and the overlays that assemble them, `widgets/` are the small HUD pieces and popups, `components/` are shared primitives and every stylesheet. Each class exposes `element` (its root node); inputs are `set*` methods or constructor props, outputs are constructor callbacks.

## GameView (views/GameView.js)
The whole game overlay. `mount( parent )` appends it.
- props (all optional): `onResume()`, `onCloseDialog()`, `onSend( text )`, `onOpen( name )`, `onClose()`, `onLeave()`, `onSettingChange({ key, value })`, `onHangUp()`, `onSummaryClose()`
- methods: `open( name )`, `close()`, `toggle( name )` with name one of `QUESTS`, `MAP`, `INVENTORY`, `CODEX`, `SETTINGS`, `CONTROLS`; `setPaused( bool )` shows the pause screen and the tab bar together (the bar is hidden while playing and shown while paused or while a panel is open); `step( text )`, `ready()`, `fail( message )` drive the loading surface
- children the game feeds directly: `clock`, `prompt`, `readout`, `stats`, `minimap`, `pause`, `avatar`, `call`, `toast`, `dialog` (ChatPanel), `summary`, `map`, `inventory`, `quests`, `codex`, `settings`, `controls`, `tabs`, `panels`

## PanelHost (views/PanelHost.js)
One panel over the game at a time.
- props: `views: { NAME: view }`, `onOpen( name )`, `onClose()`
- methods: `open( name )`, `close()`, `toggle( name )`; `current` is the open name or null
- a view is `{ element, shown?() }`; `shown` runs once the view is on screen
- Escape closes while a panel is open; opening one closes the one before

## Views (one full panel each; every one takes `onClose()`)
- **MapView**: `setMap({ bounds: { min: [x,z], max: [x,z] }, roads: [{ path: [[x,z]], width }], blocks: [[[x,z]]], stations?: [{ point: [x,z], name }], markers?: [{ point: [x,z], label }] })`, `setVenues([{ point: { x, z }, open }])`, `setPlayer( position, heading )` (heading in radians, the player looks along (-sin, -cos)), `centre()`, `shown()`. Drag pans, wheel zooms, north up, legend, player marker; the canvas redraws only on pan, zoom or a data change; follows the player until the first drag.
- **MinimapView** (HUD corner, always on): `setMap( map )` same shape without stations or markers, `setVenues( venues )`, `update( position, heading )` each frame, `toggle()`, `setVisible( bool )`
- **InventoryView**: `setItems([{ id, name, kind, description, place }])` in slot order over 30 slots, `select( index )` (-1 clears); clicking a slot selects it and shows its detail
- **QuestsView**: `setQuests([{ id, title, text, state: 'active' | 'done' | 'failed', steps: [{ text, done }] }])`, `select( id )`; empty reads "no quest yet"
- **CodexView**: `setEntries([{ id, title, category, text }])` grouped by category, `select( id )`; empty reads "nothing recorded yet"
- **SettingsView**: props `onChange({ key, value })`; `setValues({ quality, fog, exposure, crowd })`. Fields: `quality` select (`low`, `medium`, `high`, `ultra`), `fog` range 0..0.003, `exposure` number, `crowd` number. Numeric values arrive as numbers.
- **ControlsView**: `setBindings([{ action, keys: [string] }])`; empty reads "no bindings yet"
- **BuildingView**, **ExperimentView**: the building viewer and scale experiment overlays (props in each file)

## Widgets
- **TabBar**: props `onSelect( name )`, `onLeave()`; `setActive( name | null )`. Seven entries in order with their key letters: QUESTS J, MAP M, INVENTORY I, CODEX X, SETTINGS O, CONTROLS ?, LEAVE N. Keys are labels: the game binds them and calls `open`.
- **ChatPanel**: props `onSend( text )`, `onClose()`; `setNpc({ name, role })`, `setProfile({ facts: [[key, value]], now, routine: [line] } | null)`, `addMessage({ from: 'npc' | 'player', name, text })`, `setTranscript( messages )`, `show( conversation | null )` (a simulation `{ instance, behavior }` becomes name, profile and an empty transcript; null hides), `setVisible( bool )`. Header with the name and Esc, the transcript, the input "say something" with a send button; Enter sends, Escape in the input closes, blank text is never sent.
- **AvatarCard** (top left): `setAvatar({ name, portraitUrl | canvas, bar })` with bar in 0..1 over 12 segments, `setVisible( bool )`; hidden until the first call
- **VideoCallPanel**: props `onHangUp()`; `setStream( videoOrCanvas )`, `setName( name )`, `setVisible( bool )`
- **MissionToast**: `show({ title, text })` slides in under the clock, holds, fades out and removes itself (about 4.4 s)
- **MissionSummary**: props `onClose()`; `show({ title, text, outcome: 'done' | 'failed', steps: [{ text, done }] })`, `setVisible( bool )`; continue and Esc both report the close
- **HudClock**: `update( time, place )`, `setState( 'dawn' | 'day' | 'dusk' | 'night' )`
- **InteractPrompt**: `update( text | null )`
- **LocationReadout**: `update( position, district, parcel )`, `setAbout( paths )`
- **DebugStats**: `update( stats )`
- **PauseMenu**: props `onResume()`; `setVisible( bool )`

## Components
`dom.el`, `Icon.icon( name )`, `KeyCap.keyCap( text )`, `PanelHeader` (title, key hint, Esc button), `EmptyState.emptyState( text )`, `SettingField`, `Button`, `SelectField`. Stylesheets: `game.css` (palette and HUD chrome), `tabbar.css`, `panels.css`, `views.css`, `chat.css`, `mission.css`, `styles.css` (viewer and experiment overlays).

## Invariants
- Presentation only: nothing here reads game state or touches the scene. The game overlay (GameView and everything it mounts) imports nothing from outside `src/ui`; ExperimentView alone reads the scale experiment's option lists.
- No rounded corners anywhere: no `border-radius` in any stylesheet.
- The tab bar always shows each entry's key letter, and is only on screen while paused or while a panel is open.
- One full panel at a time; Escape closes it.
- Canvas maps redraw on pan, zoom or data change, never per frame on their own.

## Tests and preview
`*.test.js` beside each view and widget, Testing Library plus user-event on jsdom (`// @vitest-environment jsdom`), one per declared input, output and event. `test-helpers/canvas.js` gives jsdom a recording 2d context.
`preview.html` shows the whole overlay with sample data and no game behind it: `npm run dev`, then `/src/ui/preview.html`.

## Depends on
Nothing outside this folder. The game (`src/game/CONTRACT.md`) is the caller.
