# Playable quest actions

`QuestSession` owns cast quest runtimes and saved progress. `QuestActions` turns their active non-dialog steps into renderer-neutral targets, then accepts one validated player action for one target.

```js
const actions = new QuestActions( quests );
const targets = actions.targets( { timeMin: clock.timeMin } );

const result = actions.perform( {
  targetKey: selected.targetKey,
  action: 'take',
  timeMin: clock.timeMin,
  playerPlaces: [ { kind: 'parcel', id: currentParcelId } ],
  focus: { visible: true, unobstructed: true, distanceMeters: 1.4 }
} );
```

Render `presentation.bindingAction` through the current input map. Apply `worldChanges` only after `ok` is true, and replace the inventory display with `result.inventory`. See [CONTRACT.md](CONTRACT.md) for the boundary and failure rules.
