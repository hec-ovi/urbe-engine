---
name: investigation-scene-runtime
description: Assemble an authored incident into deterministic body, prop, decal and evidence placements, then apply persistent inspect and collect interactions.
triggers:
  - "assemble investigation scene"
  - "place authored evidence"
  - "persist investigation clues"
kind: gameplay-capability
---

# Investigation scene runtime

Read `CONTRACT.md` and the exact schemas before constructing a request.

1. Obtain the finished narrative incident and its explicit discoverable facts from the story and gameplay adaptation stages.
2. Resolve a measured interior room or bounded street region. Include every entrance, blocker and receiving surface in the location frame.
3. Resolve bodies, incident props and furniture through their creator contracts. Carry each model as a URI, media type, byte size, SHA-256 checksum, ground contact and measured posed dimensions.
4. Add only story-required evidence. Attach each evidence id to exactly one body, prop or decal. Mark portable evidence only when its visual is a portable prop.
5. Add surface damage only when the incident calls for it. Give each decal a receiving surface, measured size, explicit normal offset and PBR material key.
6. Declare evidence prerequisites and consequence events from the authored quest branch. Do not infer clues or outcomes from asset appearance.
7. Call `SceneAssembler.assemble`. Treat geometry or no-fit errors as adaptation failures that require a different measured location or authored layout.
8. Save `initialState`, then use `InvestigationRuntime.targets` and `perform` during play. Forward emitted events to the quest runtime and apply collected world changes once.

Run both investigation test files after a change. The scene is ready only when every evidence target is reachable, the exact request reproduces the exact assembly, surface details fit, and save restoration cannot award a consequence twice.
