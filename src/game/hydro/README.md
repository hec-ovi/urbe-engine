# Engine hydrology adapter

`HydrologyHost.install({ blueprint, factory, scene })` mounts an Atlas water plan in the playable scene. GameApp updates its deterministic normal-map motion with elapsed play time. A legacy blueprint returns an empty host and performs no material request or scene work.

The host loads Materials' `bindings/atlas-hydrology.json`. Lagoon, river and sea-coast variants resolve exactly, with no visual fallback or water collider. See [CONTRACT.md](CONTRACT.md) for the payloads and closed errors.
