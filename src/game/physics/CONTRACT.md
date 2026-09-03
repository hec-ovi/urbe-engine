# CONTRACT: game physics

Purpose: resolves world and player collision, measures vehicle contacts, and turns one exact Source character into an articulated Rapier body.

## Inputs

- `Physics.create()`: loads the pinned Rapier runtime and creates the fixed-step world.
- Static geometry: `Physics.addTrimesh(geometry)` and `WorldColliders` accept generated Three.js geometry in world coordinates.
- Player spawn: `new PlayerBody(physics, feet)` accepts the generated world position.
- Impact frame: `ImpactWorld.sync({ people, vehicles })` accepts live render projections. Each person has an id, `THREE.Vector3` position and optional fallen state. Each vehicle has an id, position, heading, pitch and speed in metres per second.
- Ragdoll impact: [schema/ragdoll-impact.schema.json](schema/ragdoll-impact.schema.json). `Ragdoll.create({ physics, root, impact })` also requires the live physics world and a full Source character root in its current authored pose.

## Outputs

- Measured impacts: [schema/impact-events.schema.json](schema/impact-events.schema.json). `ImpactWorld.drain()` returns stable person and vehicle ids plus the Rapier contact point and impulse. One person is reported once until released.
- Ragdoll summary: [schema/ragdoll-summary.schema.json](schema/ragdoll-summary.schema.json). The accepted Source rig becomes 15 dynamic bodies and 14 spherical joints with 70 kg total mass.
- Player body position and grounded state are live Three.js values consumed by the game controller.

## Errors

- `E_RAGDOLL_INPUT`: a physics world, frame or impact is missing or invalid.
- `E_RAGDOLL_RIG`: the character is not the audited Source skeleton or has an invalid body segment.
- `E_RAGDOLL_OUTPUT`: a produced impact or body summary violates its schema.
- `E_RAGDOLL_DISPOSED`: a disposed impact world or ragdoll is used.

## Dependencies

- `@dimforge/rapier3d-compat` for fixed-step collision and articulated bodies.
- [NPC agents](../agents/CONTRACT.md) for exact rendered identities, current Source pose and deterministic body selection.
- Generated world geometry from the game and assembly contracts.

## Invariants

- Physics advances at 1/60 second. Ground, structures and streamed floors use the same generated geometry that is rendered.
- Vehicle impact starts only from a Rapier sensor intersection at 2 m/s or faster. Distance guesses never trigger a fall.
- A fall starts from the person's current baked animation frame, removes that exact instanced slot and drives the same full Source skeleton. A proxy mesh or alternate skeleton is rejected.
- Ragdoll parts collide with generated world geometry and not with one another. The 15 body masses total 70 kg.
- One full fallen body may be resident at a time. A concurrent hit remains in crowd control and is rearmed for a later measured contact.
- Fallen people are excluded from talk targeting and crowd pushback while the dynamic colliders own their contact.
- A physical fall does not invent injury, death or simulation state. Persistent consequences require an explicit simulation contract.

## Verification

Run `npm test`. The public physics entrypoint is exercised against real Rapier contacts, world collision and a compatible Source skeleton.
