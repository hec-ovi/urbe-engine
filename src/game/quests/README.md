# Playable quest actions

`QuestSession` owns cast quest runtimes and saved progress. `QuestActions` projects every active target with stable quest, step and cast identities. `QuestGameplay` puts direct and fixed asset targets into the live centered interaction route, controls escorts, consumes fatal physics results, and observes complete passenger transit journeys.

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

Render `presentation.bindingAction` through the current input map. Apply `worldChanges` only after `ok` is true, and synchronize the inventory display from `result.inventory`. See [CONTRACT.md](CONTRACT.md) for the boundary and failure rules.

Item definitions stop at a parcel id, so a pickup uses its ground-floor entry or published access anchor. Fixed rescue, access, hacking and sabotage targets use their mission asset binding and exact interaction anchor. Transport supports public transit with one or zero controlled passengers.
