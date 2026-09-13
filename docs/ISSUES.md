# Proposals and acceptance work

Interface choices require orchestrator coordination. Existing producer inputs and consumer outputs remain supported.

| Proposal | Why | Affected boxes |
| --- | --- | --- |
| Versioned complete-game envelope with asset hashes, naming, simulation inputs/state, capabilities and explicit free play; choose packaging and missing-resource recovery | Current JSON descriptors reference local models/textures; legacy loading can generate Connections or use sample/default content | Engine, Atlas, Connections/Links, Streets, Exterior, Interior, Materials, Simulation, Naming, Quests, Modeling |
| Prepared street/link/station/fixture/model assets with collision and streaming bounds; shared dimensions catalog | Engine still constructs geometry from current inputs and imports producer constants. Producer ownership and shared dimensions require an agreed consuming schema | Engine, Atlas, Streets, Connections/Links, Exterior, Interior, Materials, Modeling |
| Closed launcher/building dependency errors and one startup resource-error envelope with owner and resource identity | Current routes can pass through arbitrary dependency codes; startup has message-only failures. Required-material admission also differs between consumers | Engine and all producer error boundaries |
| Observed actor reconciliation and a persistent-person cap policy | Logical continuity lacks measured feet, pose, blocked arrival and connector occupancy; cap behavior and quest reservations are unresolved | Engine, Simulation, Interior, Quests |
| Per-floor role loops, vertical navigation and exact room/floor/object transforms | Current actor anchors and quest placement favor ground-floor entries; map route arrays flatten objective height | Engine, Interior, Simulation, Quests, Modeling |
| Player-owned car and subway journey/state contracts | Traffic does not implement owned driving or taxi seating; scheduled rides and terminal travel have different completion semantics. Bus/train scope remains an open user decision | Engine, Connections, Simulation, Quests |
| Water movement, injury/death persistence and impact recovery | Rendered water and session ragdolls do not define complete physics behavior | Engine, Atlas, Simulation, Quests |
| Durable text conversation, NPC calls/messages and speech policy | Current text transcript is session state; the LLM adapter buffers replies. TTS requirement and supported streaming protocol need coordination | Engine, Quests, Simulation, speech provider |
| Complete JSON view layouts and a map-rendering presentation port | Some views use code-defined fields; Map3DView creates scene geometry and a renderer. Credits, property and item-preview scope remains open | Engine presentation and gameplay |

## Performance acceptance

- Complete the requested 10 km by 10 km world, 20 clustered interiors, nearby 80-floor towers and actual 500 NPCs/500 cars. Capacity settings alone do not establish those counts. Keep current defaults until population policy is agreed.
- Agree hardware, browser/backend, resolution, frame/hitch targets, loading time and memory limits. Run normal cold load, walking, floor travel, conversations, transport and save/reload on both backends with source/content identity recorded.
- Measure aggregate work across Ground, props, shells, interiors, maps and actor updates. Individual cooperative slices do not establish a shared frame budget. Link and station geometry preparation still builds complete source groups; streamed producer assets are the proposed boundary.
- Verify render/collision readiness during fast movement and transport arrivals, eviction/disposal over repeated trips and shell source residency. Local contract tests do not establish GPU frame time or city-scale acceptance.
