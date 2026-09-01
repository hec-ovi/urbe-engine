# engine: world assembly, renderer, gameplay

This is the merge box, owned by the orchestrator session. It fuses every layer's export into one playable world.

## Context (general, do not expand it)
This repo is the final layer of a larger build: a seeded, deterministic city world that ends as a playable 3D game. Eight sibling layers produce exports by contract; this box only consumes contracts and assets. Never read a sibling's code or tests, only its CONTRACT.md. Raw requirements are in docs/REQUIREMENTS.md, in the user's own words: they win over any summary here.

## Scope
- World assembly: take every layer's export by contract and fuse it into one world state with query functions (get the coffee shops, get the police stations, get the high tier residences, get the zones).
- Scale first, before any detail work: prove a three.js city with thousands of buildings, NPCs, cars, buses, trains, textures, tall towers and sky holds performance (instancing, LOD, impostors, streaming, culling). This is the single biggest risk of the project.
- Physics: real collisions, gravity, falls, crashes; a hit interrupts the animation and the rig behaves physically. Reference for collisions and car driving: https://github.com/depixeled-chris/gta7. Car driving is for a single user car (a reward), not traffic.
- Characters: Quaternius universal base characters, universal animation library, modular outfits (links in docs/REQUIREMENTS.md). The animation set (walk, sit, talk) lives here. Future runtime morphs (body and face variety) are noted, not built now.
- Talking animations on interaction, real NPC walking with character models, real dimensions, real door entries, real stairs.
- Sky: skybox style solution, one thing that solves it all.
- Rendering targets WebGPU (three.js WebGPURenderer path, fallback decided by research). Desktop distribution later as an Electron style bundle (Windows and the rest, browser-less, publishable as a full game): core code never couples hard to browser-only APIs; saves and file access go through an abstraction.
- Hosts the simulation runtime layer (the simulation box ships a library, this box runs it).
- Modes: orbit the city, or play it.
- Optional docker mode so the whole pipeline can run in one container. Optional, never a blocker.

## UI isolation (strict)
All UI lives under src/ui/ and nowhere else:
- src/ui/views/: inventory, mini map, settings, codex, main menu, game list (load, create, import, export), mission summary, main game view.
- src/ui/widgets/: chat conversation popup, NPC video conference popup, mission toast animation.
- src/ui/components/: buttons, icons, styles, shared primitives.
A zero-context agent must be able to restyle src/ui without touching contracts or anything else. Every new view is a view, every popup a widget.

## Known failure modes to design against
Empty gaps, materials showing the inverted back face, wrong 90 degree walls, no sidewalks, inverted controls, fake instanced interiors with no continuity, NPCs or player stuck in geometry.

## Depends on
Every sibling CONTRACT.md: ../atlas, ../connections, ../exterior, ../interior, ../materials, ../simulation, ../naming, ../quests

## Working order
1. Deep research first: 2026 state of the art on large scale three.js city rendering (instancing, LOD, impostors, streaming, crowd rendering), physics engines that fit, GLB asset pipelines. Compact conclusions to docs/RESEARCH.md.
2. Scale prototype with placeholder boxes before any real asset lands.
3. Assembly against sibling contracts as they stabilize, with fixtures meanwhile.
4. Keep CONTRACT.md and docs/INDEX.md current.

## Coordination
- Read docs/FEEDBACK.md at the start of every session.
- Write blockers and cross-layer questions to docs/ISSUES.md.

## Master requirements (background only)
docs/FULL-REQUIREMENTS.md holds the user's complete raw requirements for the whole project, so you see your surroundings. Read it once for awareness. It never widens your scope: what you build is defined by this file and docs/REQUIREMENTS.md only.
