# CONTRACT: quest animation coordination

## Purpose

Coordinates quest, dialogue, follow, crouch, and routine animations as one deterministic actor-state machine.

## Inputs

- Coordinator config: [schema/coordinator-config.schema.json](schema/coordinator-config.schema.json). Supplies the loaded Pro animation catalog and initial actor routines. Construction fails unless all required clip names exist.
- Command: [schema/command.schema.json](schema/command.schema.json). Accepts routine synchronization, one quest action, an atomic dialogue turn, completion, interruption, or routine resume.
- Restore state: [schema/snapshot.schema.json](schema/snapshot.schema.json). Must be a prior complete snapshot whose clips exist in the same loaded catalog.

## Outputs

- Command result: [schema/command-result.schema.json](schema/command-result.schema.json). Carries ordered playback transitions, lifecycle events, and the complete current snapshot.
- Serializable snapshot: [schema/snapshot.schema.json](schema/snapshot.schema.json). Carries actors plus grouped action state for save and restore.
- Clip requirements: [schema/requirements-report.schema.json](schema/requirements-report.schema.json). Identifies the Pro library and every exact clip required by this layer.

## Events

- `routine-synchronized` registers an actor or changes the routine that will resume after a temporary action.
- `quest-action-started` starts one validated action plan.
- `dialogue-turn-started` starts the speaker and every listener in one atomic command.
- `action-completed` ends an active action through any exit clip, then holds a neutral animation.
- `action-interrupted` immediately leaves an active action for a neutral animation and records the closed interruption reason.
- `routine-resumed` restores every participant to the latest synchronized routine and closes the grouped action.

## Errors

- `E_ANIMATION_INPUT`: an input fails schema validation or contains a duplicate actor.
- `E_ANIMATION_OUTPUT`: an internally produced output fails schema validation.
- `E_ANIMATION_CATALOG`: the Pro catalog, actor routine, or restored state lacks a required clip.
- `E_ANIMATION_ACTOR`: a command names an unregistered actor.
- `E_ANIMATION_CONFLICT`: an action id already exists or an actor is already in another action.
- `E_ANIMATION_ACTION`: an action id or action variant is unknown.
- `E_ANIMATION_STATE`: a lifecycle command or restored relationship conflicts with current state.

## Dependencies

- NPC agents contract for stable actor identity, current routine, follow state, and schedule resumption.
- Playable quest actions contract for accepted action and dialogue lifecycle events.
- The installed Quaternius Universal Animation Library Pro catalog. This layer consumes clip names and never modifies vendor assets.

## Invariants

- Actor identity and action identity are never inferred from display names or proximity.
- A dialogue turn starts its speaker and all listeners atomically. A conflict or missing actor changes nobody.
- Speaking uses `Idle_Talking_Loop` or `Sitting_Talking_Loop`. Listening uses `Idle_Loop` or `Sitting_Nodding_Loop` according to the synchronized routine posture.
- Pickup, read, observe, steal, work, deliver, follow, sit, idle, and crouch resolve to exact clips present in the purchased Pro pack.
- Crouch is an explicit action. It is never inferred from ordinary movement.
- One-shot actions advertise `clip-end` completion. Held actions advertise `explicit` completion.
- Completion and interruption preserve the action group until `resume-routine` restores every participant.
- Routine updates received during a quest action do not replace the active clip. The latest update becomes authoritative when the routine resumes.
- The same config, snapshot, and command sequence produces byte-equivalent JSON values and transition ordering.
- Inputs and outputs are schema validated and fail closed. Original GLB, glTF, FBX, texture, and Blender files remain untouched.

## How to modify this blackbox safely

Add a variant only when its exact clip exists in the audited Pro catalog. Update clip requirements, command schema, fixtures, lifecycle tests, and this contract together. Exercise entry, completion or interruption, save restore, and routine resume before exposing the variant to an adapter.
