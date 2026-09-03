const round = (value) => Number(value.toFixed(6));

function box(primitiveId, width, height, depth, x, y, z, materialSlot = "surface") {
  return {
    primitiveId,
    kind: "box",
    position: { x: round(x), y: round(y), z: round(z) },
    rotationRadians: { x: 0, y: 0, z: 0 },
    size: { width: round(width), height: round(height), depth: round(depth) },
    materialSlot,
  };
}

function chooseSlot(slots, preferred) {
  return slots.has(preferred) ? preferred : "surface";
}

function documentGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const cover = variant === 0 ? 0.16 : 0.11;
  return [
    box("lower-cover", w, h * cover, d, 0, h * cover / 2, 0),
    box("document-stack", w * 0.96, h * (1 - cover * 2), d * 0.96, 0, h / 2, 0),
    box("upper-cover", w, h * cover, d, 0, h * (1 - cover / 2), 0),
    box(
      "document-clip",
      w * (variant === 0 ? 0.16 : 0.3),
      h * 0.08,
      d * 0.16,
      w * 0.3,
      h * 0.94,
      -d * 0.34,
      chooseSlot(slots, "accent"),
    ),
  ];
}

function dataDriveGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const connectorWidth = variant === 0 ? 0.22 : 0.28;
  const bodyWidth = 1 - connectorWidth;
  return [
    box("drive-shell", w * bodyWidth, h, d, -w * connectorWidth / 2, h / 2, 0),
    box(
      "drive-connector",
      w * connectorWidth,
      h * 0.58,
      d * 0.7,
      w * (0.5 - connectorWidth / 2),
      h / 2,
      0,
      chooseSlot(slots, "accent"),
    ),
    box("drive-ridge", w * 0.42, h * 0.08, d, -w * 0.12, h * 0.96, 0),
  ];
}

function evidenceContainerGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const lidHeight = variant === 0 ? 0.2 : 0.16;
  return [
    box("container-base", w, h * (1 - lidHeight - 0.04), d, 0, h * (1 - lidHeight - 0.04) / 2, 0),
    box("container-lid", w, h * lidHeight, d, 0, h * (1 - lidHeight / 2), 0),
    box(
      "container-latch",
      w * (variant === 0 ? 0.16 : 0.24),
      h * 0.18,
      d * 0.06,
      0,
      h * 0.74,
      d * 0.47,
      chooseSlot(slots, "accent"),
    ),
  ];
}

function toolGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const headHeight = variant === 0 ? 0.28 : 0.34;
  return [
    box(
      "tool-handle",
      w * (variant === 0 ? 0.22 : 0.3),
      h * (1 - headHeight),
      d * 0.42,
      0,
      h * (1 - headHeight) / 2,
      0,
      chooseSlot(slots, "grip"),
    ),
    box("tool-head", w, h * headHeight, d, 0, h * (1 - headHeight / 2), 0),
    box(
      "tool-head-accent",
      w * 0.2,
      h * headHeight,
      d,
      variant === 0 ? -w * 0.28 : w * 0.28,
      h * (1 - headHeight / 2),
      0,
      chooseSlot(slots, "accent"),
    ),
  ];
}

function controlTerminalGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const consoleHeight = variant === 0 ? 0.3 : 0.36;
  return [
    box("terminal-pedestal", w * 0.54, h * (1 - consoleHeight), d * 0.56, 0, h * (1 - consoleHeight) / 2, -d * 0.1),
    box("terminal-console", w, h * consoleHeight, d, 0, h * (1 - consoleHeight / 2), 0),
    box(
      "terminal-display",
      w * (variant === 0 ? 0.72 : 0.84),
      h * consoleHeight * 0.54,
      d * 0.035,
      0,
      h * (1 - consoleHeight * 0.46),
      d * 0.4825,
      "display",
    ),
    box("terminal-controls", w * 0.56, h * 0.045, d * 0.22, 0, h * (1 - consoleHeight + 0.04), d * 0.2, chooseSlot(slots, "accent")),
  ];
}

function packageGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const sealSlot = chooseSlot(slots, "seal");
  const bands = [
    box("package-shell", w, h, d, 0, h / 2, 0),
    box("package-long-band", w * 0.12, h, d, 0, h / 2, 0, sealSlot),
  ];
  if (variant === 0) bands.push(box("package-cross-band", w, h, d * 0.1, 0, h / 2, 0, sealSlot));
  else bands.push(box("package-edge-seal", w, h * 0.08, d, 0, h * 0.96, 0, sealSlot));
  return bands;
}

function tableGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const top = h * 0.12;
  const legW = Math.min(w * (variant === 0 ? 0.09 : 0.13), 0.14);
  const legD = Math.min(d * (variant === 0 ? 0.09 : 0.13), 0.14);
  const x = w / 2 - legW / 2;
  const z = d / 2 - legD / 2;
  const parts = [box("table-top", w, top, d, 0, h - top / 2, 0)];
  for (const [index, sx, sz] of [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]]) {
    parts.push(box(`table-leg-${index}`, legW, h - top, legD, sx * x, (h - top) / 2, sz * z, chooseSlot(slots, "accent")));
  }
  if (variant === 1) parts.push(box("table-stretcher", w - legW * 2, h * 0.08, legD, 0, h * 0.3, 0, chooseSlot(slots, "accent")));
  return parts;
}

function chairGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const seatY = h * (variant === 0 ? 0.45 : 0.48);
  const seatThickness = h * 0.1;
  const legW = Math.min(w * 0.1, 0.07);
  const legD = Math.min(d * 0.1, 0.07);
  const x = w / 2 - legW / 2;
  const z = d / 2 - legD / 2;
  const parts = [
    box("chair-seat", w, seatThickness, d, 0, seatY, 0, chooseSlot(slots, "upholstery")),
    box("chair-back", w, h - seatY, d * (variant === 0 ? 0.1 : 0.16), 0, seatY + (h - seatY) / 2, -d * (0.5 - (variant === 0 ? 0.05 : 0.08))),
  ];
  for (const [index, sx, sz] of [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]]) {
    parts.push(box(`chair-leg-${index}`, legW, seatY - seatThickness / 2, legD, sx * x, (seatY - seatThickness / 2) / 2, sz * z, chooseSlot(slots, "accent")));
  }
  if (variant === 0) parts.push(box("chair-back-rail", w * 0.82, h * 0.07, d * 0.1, 0, h * 0.78, -d * 0.45));
  return parts;
}

function shelfGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const side = Math.min(w * 0.07, 0.08);
  const slab = Math.min(h * 0.045, 0.06);
  const parts = [
    box("shelf-left", side, h, d, -w / 2 + side / 2, h / 2, 0, chooseSlot(slots, "accent")),
    box("shelf-right", side, h, d, w / 2 - side / 2, h / 2, 0, chooseSlot(slots, "accent")),
  ];
  const levels = variant === 0 ? 4 : 5;
  for (let index = 0; index < levels; index += 1) {
    const y = index === 0 ? slab / 2 : index === levels - 1 ? h - slab / 2 : h * index / (levels - 1);
    parts.push(box(`shelf-level-${index}`, w, slab, d, 0, y, 0));
  }
  return parts;
}

function cabinetGeometry({ width: w, height: h, depth: d }, variant, slots) {
  const wall = Math.min(w * 0.06, 0.08);
  const slab = Math.min(h * 0.04, 0.06);
  const doorDepth = Math.min(d * 0.08, 0.04);
  const parts = [
    box("cabinet-left", wall, h, d, -w / 2 + wall / 2, h / 2, 0),
    box("cabinet-right", wall, h, d, w / 2 - wall / 2, h / 2, 0),
    box("cabinet-bottom", w, slab, d, 0, slab / 2, 0),
    box("cabinet-top", w, slab, d, 0, h - slab / 2, 0),
  ];
  const doorCount = variant === 0 ? 1 : 2;
  for (let index = 0; index < doorCount; index += 1) {
    const doorWidth = (w - wall * 2) / doorCount;
    const x = -w / 2 + wall + doorWidth * (index + 0.5);
    parts.push(box(`cabinet-door-${index}`, doorWidth * 0.96, h - slab * 2, doorDepth, x, h / 2, d / 2 - doorDepth / 2, chooseSlot(slots, "accent")));
    parts.push(box(`cabinet-handle-${index}`, Math.min(doorWidth * 0.08, 0.04), h * 0.14, doorDepth, x + (index === 0 ? doorWidth * 0.32 : -doorWidth * 0.32), h * 0.55, d / 2 - doorDepth / 2, chooseSlot(slots, "accent")));
  }
  return parts;
}

const BUILDERS = Object.freeze({
  document: documentGeometry,
  "data-drive": dataDriveGeometry,
  "evidence-container": evidenceContainerGeometry,
  tool: toolGeometry,
  "control-terminal": controlTerminalGeometry,
  package: packageGeometry,
  table: tableGeometry,
  chair: chairGeometry,
  shelf: shelfGeometry,
  cabinet: cabinetGeometry,
});

export const VARIANT_IDS = Object.freeze({
  document: ["layered", "sealed"],
  "data-drive": ["blade", "block"],
  "evidence-container": ["hinged", "reinforced"],
  tool: ["long-head", "wide-head"],
  "control-terminal": ["sloped", "upright"],
  package: ["cross-band", "edge-band"],
  table: ["four-leg", "braced"],
  chair: ["rail-back", "panel-back"],
  shelf: ["four-tier", "five-tier"],
  cabinet: ["single-door", "double-door"],
});

export function buildGeometry(family, dimensions, variantIndex, materialSlots) {
  return BUILDERS[family](dimensions, variantIndex, materialSlots);
}

export function declaredBounds({ width, height, depth }) {
  return {
    min: { x: round(-width / 2), y: 0, z: round(-depth / 2) },
    max: { x: round(width / 2), y: round(height), z: round(depth / 2) },
  };
}

export function primitiveBounds(primitive) {
  const { position, size } = primitive;
  return {
    min: {
      x: round(position.x - size.width / 2),
      y: round(position.y - size.height / 2),
      z: round(position.z - size.depth / 2),
    },
    max: {
      x: round(position.x + size.width / 2),
      y: round(position.y + size.height / 2),
      z: round(position.z + size.depth / 2),
    },
  };
}
