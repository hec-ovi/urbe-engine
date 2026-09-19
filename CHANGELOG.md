# Changelog

0.24.1: the load reads world documents, plans, street pieces, room catalogs, characters and cars together, warms one program per material and layout, and shows one counter for the whole load.

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
