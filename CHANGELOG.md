# Changelog

0.27.5: the story is written again against the interiors that opened, so every place it names is a building the player can walk into.

0.27.4: a room reads as a room. A room stays in view by its own extent, so a sales floor 26 m across keeps its light, its air and its indoor exposure wherever the player stands in it. Its fill is computed from the surface it actually encloses, floor, ceiling and the walls around its outline and its holes, instead of from the sum of every face of every module's box. One pool of lights is shared out by what each room publishes: every room in view keeps one, and the room being stood in takes what the small ones around it cannot use. A line source facing a surface within 0.3 m stays in the fill, so the coves tucked under the soffit stop taking every rect slot and the wall joints get them. The lights of a room a floor never built join that floor's fill and haze and their room ids are reported. The indoor medium is derived from the corrected surface and sits under the radiance of the walls it hides. Interior relief has a budget: one caster, the brightest fixture of the room the player stands in, at the tiers that can pay a depth pass for it.

0.27.3: a cut storey plate comes back in the attribute types the plate published, and a shell's surfaces are made to share one layout before they merge, so a furnished building stands instead of failing the city's first shell admission. A bucket that will not merge costs that one material and is named, never the whole city.

0.27.2: a building that opens an interior stands one floor. Exterior's storey plates are cut back to the band outside the interior's own rooms, drawn and solid there, so a furnished floor is no longer two coplanar surfaces and the stair and lift wells are real holes through it; a plan that insets its top floor's rooms past its own wall carries a plate under that band, which is where the player fell through. A lift shaft closes itself: a landing is solid while its leaves are shut and the cab floor stands where the cab waits. A room downlight's cutoff stands past the surface it faces, so the floor under it is lit rather than black. The assembly's temperature ceiling is on by default, follows the die instead of the chassis probe, sits three degrees under the throttle point the driver publishes or 97 C where it publishes none, and decides on a held reading rather than a spike, never narrowing below two workers.

0.27.1: where a step happens is read from the bundle, which settles it at build time; the cast only says who stands there.

0.27.0: the quest layer plays for the player. The quest log's pick is the objective (the HUD, the minimap mark and the route follow it), every questline's open goto and talk keeps its own ring and its own cast, and a talk target wears a mark over its head that reads through the room. A conversation reaches the story on its first exchange or when the panel closes, goes to one questline, and says in the player's words why it moved nothing. The person a step is about holds their place after the talk, faces the player throughout, and is posted only while the runtime has that step open. The HUD and the quest log read one projection per step (words, person, place, why it is closed, when it opens), asked again every four seconds. A side job nobody has started reads as available. Crowd bodies keep their own identity when the cast search walks past them, a cast body that wandered off is put back, a marked area is scored by the crosshair, and continuity refusing a conversation costs one press instead of the frame.

0.26.12: furnished floors draw Interior's 0.32 module set, built through its library at every publish: one batch per `key#variant` slot from the factory with the module's tile-unit UVs drawn as authored, colliders by the published id prefixes (frames, fields, slabs, bands, lit joints and fitted furniture solid; spots, coves, strips, services and hung pieces not), rooms measured from every surface module at the reflectance of the slots it wears, and every cove joint at a wall's top or foot and every furniture lens reaching its room's fixtures.

0.26.11: the hero character stays resident for the run (both shapes read and warmed at load, maps sized to the tier, one dressed material per shape worn again by the next person), so a fall or a conversation uploads and links nothing.

0.26.10: a template deals its variations across its blocks (every block one variation, the template's own building the majority on every slot), and a floor step is offered only where the block's own lot stands the design at both counts.

0.26.9: the environment stands from construction and bakes under the loading counter, program keepers own their own triangle, released programs are named in the hitch line, and URBE_INTERIOR_DIR runs Interior from a pinned checkout.

0.26.8: the quest place reads as a place (route to the door, a mark and a HUD line with the venue name, distance and opening hours, the cast standing at the counter, entrances facing the street) and the first frame no longer stalls on WebGL2 (crowd baked in the load, programs pinned per object graph, no timer queries, named admission steps in the hitch log).

0.26.7: furnished rooms are lit: every module and furniture batch samples the room light pool with a per-copy fill, fixtures glow at the diffuser level shells use, downlights reach the floor, the indoor air carries the room's own radiance, the low tier holds three room slots, and the low tier keeps an environment probe.

0.26.6: a mixed template slot stands the family most of its lots accept, a lot that family cannot stand takes the family that fits it in its own materials, and plain stands only where no approved family fits the lot at its tier.

0.26.5: a template slot decides the whole building (family, floors, dressing class) for every block that uses it, a merge of two slots stands one building wherever it recurs, and a block's one variation is a merge or a floor step on one slot; the 1 km sample stands 373 kit buildings on 122 plans.

0.26.4: a business plan carries a blank ten-cell marquee over its entrance (Exterior 0.58.11) and the runtime letters the parcel's word on its cell pitch.

0.26.3: a plan is family, bays, floors and dressing class (tier, home or business); the venue word leaves the plan and is lettered per parcel at runtime on the plan's sign field from the shared letter atlas, one batch for the city.

0.26.2: a template slot shares the floor count most of its lots allow, and a lot whose envelope excludes it takes the nearest count it does allow.

0.26.1: a prop model this machine cannot serve costs only the placements that wanted it, reported as unresolved; the buildings beside them still stand and the game still starts.

0.26.0: family eligibility follows each family's own published minima, a template slot shares its design while every building stands the height its own lot allows, rich lots never take the plain generator where a family fits, a plan carries the parcel's programme and venue sign, and a landmark names an approved design its lot takes (garden-taper first).

0.25.14: the automatic interior pick opens the places the story names first, in story order, so a count that covers the main line opens exactly its locations.

0.25.13: the kept Connections pass plans against the buildings that stand (each kit parcel's plan ring in its frame and roof elevation), so every link end lands on the real facade, and a roof mast composes with its roof, so rooftop cables hang over their own building.

0.25.12: kit colliders stand on the building footprint with the entrance cut in the wall the door sits in, plus a low band where a plinth, steps or planters stand proud of it; the lot line no longer blocks the pavement.

0.25.11: a generated shell draws every mesh node it publishes too; a node name answers for moving door leaves and nothing else.

0.25.10: a compressed map that will not transcode falls back to its PNG master instead of leaving the surface flat, and a variant name the catalog does not publish is reported beside unresolved keys.

0.25.9: a kit plan draws every mesh node it publishes, bucketed by material; a node name never decides what is drawn (corporate-sectors recovers its 44,462 triangles of services, covers, cassettes, wings and screen).

0.25.8: a floor draws its own window returns beside the placement record its band shares.

0.25.7: cell admission runs under a frame budget while the city is drawn (no main-thread stretch over 100 ms, worst 911 ms before) and flat out while it loads; one budget paces plan decoding, shell baking, batch merges and props.

0.25.6: a furnished building is complete when every layout its floors name is on disk, so a two-floor building publishes into the manifest.

0.25.5: two-floor buildings are interior candidates, opening with ground and crown (Interior 0.31.6), and each floor draws its own window returns with the layout it shares.

0.25.4: the investigation frame accepts transit places, an authored source that throws is put down for the session instead of stopping the game, the fixture list is rebuilt without spreading it, and a catalog game starts with 200 walkers and 18 cars while city inspection keeps empty streets.

0.25.3: the shell stream reads two cells ahead and builds one at a time, a cell still reading steps aside for one whose files are here, and a plan blueprint is read once per city for every consumer.

0.25.2: a city batch never sweeps the shared store; `npm run gc` is the one sweep, run when no batch is drawing, so batches side by side keep each other's plans.

0.25.1: a material variant with its own tiling repeats at its own scale, so Materials 0.17.4 blade, comb, fixing and joint patterns land on their pitch.

0.25.0: building plans load on demand, read, checked and merged into the material batches the first time a cell stands on them, so the load is bounded by the window around the player and never by the plan set; a plan that cannot be read leaves its parcels as empty lots.

0.24.3: a reuse run binds a world's plans at the Exterior version that drew them, and automatic interior selection hands the assembler a count so a building Interior cannot furnish is skipped for the next candidate.

0.24.2: a kit parcel that opens a real interior draws its plan without the window scenery, the fake rooms being their own batch entry beside the entrance leaves.

0.24.1: the load reads world documents, street pieces, room catalogs, characters and cars together, warms one program per material and layout, and shows one counter for the whole load.

0.24.0: kit buildings are the approved family shells generated once per plan and instanced with their eligibility, and streets draw the shared 0.9.0 catalogue with per-instance tint, wear, scans and text.

0.23.0: every piece runtime draws one batch per material, and kit buildings share one blueprint per plan.

0.22.1: tests cover the contract surface once each, 420 cases in eleven seconds, and compressed maps fill their texture in place.

0.22.0: kit buildings plan once per block template with one variation per block, parcels are compact records over shared plans, kits and catalogs live once in the shared store, and a failed parcel becomes an empty lot instead of a failed city.

0.21.0: streets draw from the Streets piece kit and placements with cuboid colliders, interiors draw from shared modules and three layouts per building, and cities publish both catalogs beside the world.

0.20.0: ordinary parcels assemble from the Exterior piece kit as placement tables, the runtime draws them instanced with cuboid colliders and streams them by cell, the launcher defaults to a 3000 m city, and tests run on a quarter of the cores.

0.19.4: every city with a shell catalog streams by distance, and city loaders decode quantized, meshopt-compressed producer geometry.

0.19.3: city batches open a quarter of the cores; an optional temperature ceiling narrows the batch while the CPU runs hot.

0.19.2: loading work continues when the browser has stopped animation frames, and the building preview reports every stage it runs.

0.19.1: the building preview renders the game's own frame, through one shared night look and one shared set of shell surface rules.

0.19.0: Atlas district streets, emissive parking and marquee surfaces, median trees and street fixtures.

0.18.0: shell geometry batches preserve material bindings and per-surface lighting requirements.

0.18.0: tapered shell skylines, authored facade lights, reflective glazing and imported entrance planting.

0.18.0: source-bound native Streets generation, original GLB and material streaming with physical collision, preserved highway and station rendering, and 4 m clear exterior floor allocation.

0.17.17: agent-callable catalog and play interfaces; nearby Ground pages and shared prop batches; bounded static collision preparation; contract tests for loading, streaming, movement, story actions and saved state.
