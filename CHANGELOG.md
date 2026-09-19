# Changelog

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
