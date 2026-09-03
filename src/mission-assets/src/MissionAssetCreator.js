import { canonicalJson, payloadReference } from "./canonical.js";
import { buildGeometry, declaredBounds, primitiveBounds, VARIANT_IDS } from "./geometry.js";
import { MissionAssetError } from "./MissionAssetError.js";
import { assertSchema } from "./schema.js";

const FAMILY_RULES = Object.freeze({
  document: {
    min: [0.08, 0.002, 0.08], max: [1.2, 0.12, 1.5],
    interactions: ["inspect", "read", "take"],
    surfaceKinds: ["fabric", "plastic", "metal"],
    slots: ["surface", "accent"], portable: true,
  },
  "data-drive": {
    min: [0.03, 0.01, 0.03], max: [0.5, 0.2, 0.5],
    interactions: ["inspect", "take", "use"],
    surfaceKinds: ["metal", "plastic"],
    slots: ["surface", "accent"], portable: true,
  },
  "evidence-container": {
    min: [0.15, 0.08, 0.12], max: [2.5, 1.5, 1.5],
    interactions: ["inspect", "open", "close", "store"],
    surfaceKinds: ["metal", "plastic", "wood"],
    slots: ["surface", "accent"], portable: false,
  },
  tool: {
    min: [0.08, 0.12, 0.04], max: [1.5, 2.2, 0.8],
    interactions: ["inspect", "take", "use"],
    surfaceKinds: ["metal", "plastic", "rubber"],
    slots: ["surface", "accent", "grip"], portable: true,
  },
  "control-terminal": {
    min: [0.3, 0.4, 0.2], max: [3, 3, 1.5],
    interactions: ["inspect", "use", "access", "hack", "sabotage"],
    surfaceKinds: ["metal", "plastic"],
    slots: ["surface", "accent", "display"], portable: false,
    requiredSlots: ["surface", "display"],
  },
  package: {
    min: [0.08, 0.05, 0.08], max: [2.5, 2, 2.5],
    interactions: ["inspect", "take", "open"],
    surfaceKinds: ["fabric", "plastic", "wood", "metal"],
    slots: ["surface", "seal"], portable: true,
  },
  table: {
    min: [0.5, 0.4, 0.4], max: [5, 1.3, 3],
    interactions: ["inspect", "place-item"],
    surfaceKinds: ["wood", "metal", "glass"],
    slots: ["surface", "accent"], portable: false,
  },
  chair: {
    min: [0.35, 0.5, 0.35], max: [1.5, 1.8, 1.5],
    interactions: ["inspect", "sit"],
    surfaceKinds: ["wood", "metal", "plastic", "fabric"],
    slots: ["surface", "accent", "upholstery"], portable: false,
  },
  shelf: {
    min: [0.3, 0.5, 0.15], max: [5, 4, 1.5],
    interactions: ["inspect", "store", "place-item"],
    surfaceKinds: ["wood", "metal", "glass"],
    slots: ["surface", "accent"], portable: false,
  },
  cabinet: {
    min: [0.35, 0.5, 0.25], max: [4, 3.5, 2],
    interactions: ["inspect", "open", "close", "store"],
    surfaceKinds: ["wood", "metal", "glass"],
    slots: ["surface", "accent"], portable: false,
  },
});

const SPECIAL_SLOT_KINDS = Object.freeze({
  display: ["ad-screen", "glass"],
  upholstery: ["fabric", "plastic"],
  grip: ["rubber", "plastic", "fabric"],
  seal: ["rubber", "plastic", "fabric", "metal"],
});

function fnv1a32(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function materialKind(key) {
  return key.split("/")[1];
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function actualGeometryBounds(primitives) {
  const bounds = primitives.map(primitiveBounds);
  return {
    min: {
      x: Math.min(...bounds.map((value) => value.min.x)),
      y: Math.min(...bounds.map((value) => value.min.y)),
      z: Math.min(...bounds.map((value) => value.min.z)),
    },
    max: {
      x: Math.max(...bounds.map((value) => value.max.x)),
      y: Math.max(...bounds.map((value) => value.max.y)),
      z: Math.max(...bounds.map((value) => value.max.z)),
    },
  };
}

function interactionAnchor(interaction, dimensions) {
  const { width, height, depth } = dimensions;
  let position = { x: 0, y: Math.min(height * 0.65, 1.25), z: depth / 2 };
  if (interaction === "sit") position = { x: 0, y: height * 0.45, z: 0 };
  if (interaction === "place-item") position = { x: 0, y: height, z: 0 };
  if (interaction === "store") position = { x: 0, y: height * 0.5, z: depth / 2 };
  return {
    anchorId: `interaction-${interaction}`,
    interaction,
    position,
    forward: { x: 0, y: 0, z: 1 },
    reachMeters: Math.min(2.25, Math.max(0.5, width * 0.5 + 0.35)),
  };
}

function clearancePurpose(interaction) {
  if (["access", "hack", "sabotage"].includes(interaction)) return "access";
  if (interaction === "sit") return "seat";
  if (["store", "place-item"].includes(interaction)) return "storage";
  if (["read", "use", "open", "close"].includes(interaction)) return "operate";
  return null;
}

function buildClearances(dimensions, requested, interactions) {
  const { width, height, depth } = dimensions;
  const dimensionsFor = (purpose) => ({
    width: Math.max(width + requested.sideMargin * 2, purpose === "seat" ? 0.9 : 0.8),
    height: Math.max(2, height + requested.overhead),
    depth: requested.approachDepth,
  });
  const make = (purpose) => {
    const size = dimensionsFor(purpose);
    return {
      clearanceId: `clearance-${purpose}`,
      purpose,
      center: { x: 0, y: size.height / 2, z: depth / 2 + size.depth / 2 },
      dimensions: size,
      rotationRadians: { x: 0, y: 0, z: 0 },
    };
  };
  const purposes = [...new Set(interactions.map(clearancePurpose).filter(Boolean))].sort();
  return [make("approach"), ...purposes.map(make)];
}

export class MissionAssetCreator {
  #materials;

  constructor(materialCatalog) {
    assertSchema("materialCatalog", materialCatalog);
    this.#materials = new Map();
    for (const entry of materialCatalog.entries) {
      const keys = [entry.key, ...(entry.aliases ?? [])];
      for (const key of keys) {
        if (this.#materials.has(key)) {
          throw new MissionAssetError("E_SCHEMA", `Material key or alias is duplicated: ${key}`, { key });
        }
        this.#materials.set(key, new Set(entry.variants));
      }
    }
  }

  create(request) {
    assertSchema("createRequest", request);
    const rule = FAMILY_RULES[request.family];
    this.#validateDimensions(request.family, request.dimensions, rule);
    this.#validateInteractions(request.family, request.requiredInteractions, rule);
    const slots = this.#validateMaterials(request.family, request.materials, rule);
    this.#validateClearance(request.family, request.dimensions, request.requiredInteractions, request.clearance);

    const variants = VARIANT_IDS[request.family];
    const variantIndex = fnv1a32(`${request.seed}:${request.family}:${request.assetId}`) % variants.length;
    const primitives = buildGeometry(request.family, request.dimensions, variantIndex, slots);
    const bounds = declaredBounds(request.dimensions);
    const collisionParts = primitives.map((primitive) => ({
      partId: `collision-${primitive.primitiveId}`,
      bounds: primitiveBounds(primitive),
    }));
    const payload = {
      contractVersion: "1.0",
      assetId: request.assetId,
      purpose: request.purpose,
      family: request.family,
      seed: request.seed,
      variantId: variants[variantIndex],
      dimensions: clone(request.dimensions),
      coordinateFrame: { units: "meters", upAxis: "+Y", frontAxis: "+Z" },
      scale: { x: 1, y: 1, z: 1 },
      pivot: { x: 0, y: 0, z: 0 },
      groundContactOrigin: { x: 0, y: 0, z: 0 },
      geometry: { bounds, primitives },
      materials: clone(request.materials),
      collision: { kind: "compound-aabb", bounds: clone(bounds), parts: collisionParts },
      interactionAnchors: request.requiredInteractions.map((interaction) => interactionAnchor(interaction, request.dimensions)),
      clearances: buildClearances(request.dimensions, request.clearance, request.requiredInteractions),
      portable: rule.portable,
    };
    const assembly = { ...payload, payloadRef: payloadReference(request.assetId, payload) };
    this.verifyAssembly(assembly);
    return freeze(assembly);
  }

  verifyAssembly(assembly) {
    assertSchema("assetAssembly", assembly);
    const { payloadRef, ...payload } = assembly;
    const expectedRef = payloadReference(assembly.assetId, payload);
    if (!sameValue(payloadRef, expectedRef)) {
      throw new MissionAssetError("E_HASH", `Payload reference does not match ${assembly.assetId}`, {
        expected: expectedRef,
        actual: payloadRef,
      });
    }
    const expectedBounds = declaredBounds(assembly.dimensions);
    const actualBounds = actualGeometryBounds(assembly.geometry.primitives);
    if (!sameValue(assembly.geometry.bounds, expectedBounds) || !sameValue(actualBounds, expectedBounds)) {
      throw new MissionAssetError("E_DIMENSIONS", `Geometry does not fit declared dimensions for ${assembly.assetId}`, {
        declared: expectedBounds,
        actual: actualBounds,
      });
    }
    if (!sameValue(assembly.collision.bounds, expectedBounds)) {
      throw new MissionAssetError("E_DIMENSIONS", `Collision does not fit declared dimensions for ${assembly.assetId}`);
    }
    const assignedSlots = new Set(assembly.materials.map((material) => material.slot));
    for (const primitive of assembly.geometry.primitives) {
      if (!assignedSlots.has(primitive.materialSlot)) {
        throw new MissionAssetError("E_MATERIAL", `Primitive ${primitive.primitiveId} has no material assignment`, {
          materialSlot: primitive.materialSlot,
        });
      }
    }
    this.#validateMaterials(assembly.family, assembly.materials, FAMILY_RULES[assembly.family]);
    this.#validateInteractions(
      assembly.family,
      assembly.interactionAnchors.map((anchor) => anchor.interaction),
      FAMILY_RULES[assembly.family],
    );
    return assembly;
  }

  #validateDimensions(family, dimensions, rule) {
    const values = [dimensions.width, dimensions.height, dimensions.depth];
    if (values.some((value, index) => value < rule.min[index] || value > rule.max[index])) {
      throw new MissionAssetError("E_DIMENSIONS", `${family} dimensions are outside its supported exact-fit range`, {
        dimensions,
        min: { width: rule.min[0], height: rule.min[1], depth: rule.min[2] },
        max: { width: rule.max[0], height: rule.max[1], depth: rule.max[2] },
      });
    }
  }

  #validateInteractions(family, interactions, rule) {
    const invalid = interactions.filter((interaction) => !rule.interactions.includes(interaction));
    if (invalid.length > 0) {
      throw new MissionAssetError("E_INTERACTION", `${family} does not support the requested interactions`, {
        invalid,
        supported: rule.interactions,
      });
    }
    if (interactions.includes("close") && !interactions.includes("open")) {
      throw new MissionAssetError("E_INTERACTION", "close requires an authored open interaction", { family });
    }
  }

  #validateMaterials(family, materials, rule) {
    const slots = new Set();
    for (const material of materials) {
      if (slots.has(material.slot)) {
        throw new MissionAssetError("E_SCHEMA", `Material slot is duplicated: ${material.slot}`, { slot: material.slot });
      }
      slots.add(material.slot);
      if (!rule.slots.includes(material.slot)) {
        throw new MissionAssetError("E_MATERIAL", `${material.slot} is not a visible slot on ${family}`, {
          slot: material.slot,
          family,
        });
      }
      const variants = this.#materials.get(material.key);
      if (!variants || !variants.has(material.variantId)) {
        throw new MissionAssetError("E_MATERIAL", `Material key and variant do not resolve: ${material.key}#${material.variantId}`, {
          key: material.key,
          variantId: material.variantId,
        });
      }
      const allowedKinds = SPECIAL_SLOT_KINDS[material.slot] ?? rule.surfaceKinds;
      if (!allowedKinds.includes(materialKind(material.key))) {
        throw new MissionAssetError("E_MATERIAL", `${material.key} is incompatible with ${family}.${material.slot}`, {
          allowedKinds,
        });
      }
    }
    for (const requiredSlot of rule.requiredSlots ?? ["surface"]) {
      if (!slots.has(requiredSlot)) {
        throw new MissionAssetError("E_MATERIAL", `${family} requires material slot ${requiredSlot}`, { requiredSlot });
      }
    }
    return slots;
  }

  #validateClearance(family, dimensions, interactions, clearance) {
    let minimumApproach = 0.75;
    if (interactions.includes("sit")) minimumApproach = Math.max(minimumApproach, 0.9);
    if (interactions.includes("open") && ["cabinet", "evidence-container"].includes(family)) {
      minimumApproach = Math.max(minimumApproach, Math.min(2, dimensions.depth));
    }
    if (clearance.approachDepth < minimumApproach || clearance.sideMargin < 0.2 || clearance.overhead < 0.1) {
      throw new MissionAssetError("E_CLEARANCE", `${family} clearance is too small for its authored interactions`, {
        minimum: { approachDepth: minimumApproach, sideMargin: 0.2, overhead: 0.1 },
        actual: clearance,
      });
    }
  }
}
