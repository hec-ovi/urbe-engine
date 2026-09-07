# CONTRACT: player

Purpose: converts captured input into first-person movement and aimed interactions.

## Inputs and outputs

- `Input(element)` uses an attached HTML element. [Input schema](schema/input.d.ts) defines state, movement axis, mouse delta and capture result. `requestLock()` returns whether the request was accepted; `pointerlockchange` confirms `locked` and invokes `onLockChange(locked)`. Repeated pending requests share one promise. Rejected or detached requests settle false and permit a later explicit click.
- `axis()` returns normalized camera-relative movement; `drainLook()` returns and clears mouse movement; `consume(code)` returns one press; `endFrame()` clears presses; `clear()` clears held movement and zoom. `exitLock()` releases capture; `dispose()` removes listeners.
- `PlayerController({body,camera,input})` consumes [Physics player body](../physics/CONTRACT.md), a Three.js camera and Input. `update(delta)` advances stance, collision-constrained movement and camera pose. `lookAt(point)` sets heading; `beginRide(position,heading)`, `carry(position,heading)` and `endRide(position)` consume authoritative world coordinates from [agents](../agents/CONTRACT.md).
- `Interactor` consumes [city doors](../city/CONTRACT.md), the controller, [agents](../agents/CONTRACT.md), [simulation](../sim/CONTRACT.md), optional elevators, [quests](../quests/CONTRACT.md), [investigations](../investigation/CONTRACT.md) and [door collision](../physics/CONTRACT.md). `update(delta,questState)` returns the aimed prompt or null. `activate(clock,action)` applies the selected action; `close(clock,reason)` ends conversation. `onConversation` carries the current conversation or null.

## Invariants

Capture refusal leaves controls released and produces no unhandled promise rejection. Movement and camera follow the physical body. Door pivots and colliders follow the same published travel. Aim selects the target in reach; near-equal aim favors the door.
