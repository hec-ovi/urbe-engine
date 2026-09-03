# Engine hydrology adapter

`HydrologyAdapter.build(blueprint, { factory, bindings })` returns `null` for a legacy blueprint or a detached runtime for an Atlas water plan. Add `runtime.group` to the scene, call `runtime.update({ elapsedSeconds })`, pass `runtime.handoff.groundExclusions` and `runtime.handoff.crossings` to their host owners, then call `runtime.dispose()` when the world closes.

The adapter requires an explicit materials-database binding for each Atlas water material key. It has no visual fallback and creates no water collider. See [CONTRACT.md](CONTRACT.md) for the payloads and closed errors.
