# Prop review

Shows the installed street models and their authored arrangements with Materials textures.

Open `/src/game/props/preview/` on the Engine development server. Select model gallery or service pockets, then daylight or night. The gallery uses PropModels; service pockets call Dressing on [review-world.json](review-world.json). Orbit by dragging, zoom with the wheel.

[ReviewView](views/CONTRACT.md) takes JSON labels and reports selections. The controller owns loading, materials, lighting and scene replacement. Depends on [Props](../CONTRACT.md) and the [material factory](../../../building/CONTRACT.md).
