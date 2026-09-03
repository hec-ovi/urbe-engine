import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import materialCatalog from "../fixtures/material-catalog.valid.json";
import terminalRequest from "../fixtures/control-terminal.request.json";
import {
  canonicalJson,
  matchesSchema,
  MissionAssetCreator,
  MissionAssetRegistry,
  payloadReference,
} from "../src/index.js";

const FAMILY_CASES = [
  ["document", { width: 0.24, height: 0.018, depth: 0.32 }, ["inspect", "read", "take"], [material("surface", "cyberpunk/fabric/mid", "flat")]],
  ["data-drive", { width: 0.09, height: 0.025, depth: 0.04 }, ["inspect", "take", "use"], [material("surface", "cyberpunk/metal/mid", "paint")]],
  ["evidence-container", { width: 0.7, height: 0.35, depth: 0.5 }, ["inspect", "open", "close", "store"], [material("surface", "cyberpunk/metal/mid", "paint")]],
  ["tool", { width: 0.32, height: 0.65, depth: 0.14 }, ["inspect", "take", "use"], [material("surface", "cyberpunk/metal/mid", "paint"), material("grip", "cyberpunk/rubber/mid", "1")]],
  ["control-terminal", { width: 0.9, height: 1.35, depth: 0.55 }, ["inspect", "access", "hack"], [material("surface", "cyberpunk/metal/mid", "paint"), material("display", "cyberpunk/ad-screen/mid", "noir-cyan")]],
  ["package", { width: 0.45, height: 0.28, depth: 0.35 }, ["inspect", "take", "open"], [material("surface", "cyberpunk/wood/mid", "1"), material("seal", "cyberpunk/rubber/mid", "1")]],
  ["table", { width: 1.4, height: 0.76, depth: 0.8 }, ["inspect", "place-item"], [material("surface", "cyberpunk/wood/mid", "1")]],
  ["chair", { width: 0.48, height: 0.92, depth: 0.52 }, ["inspect", "sit"], [material("surface", "cyberpunk/metal/mid", "paint"), material("upholstery", "cyberpunk/fabric/mid", "1")]],
  ["shelf", { width: 1.1, height: 1.9, depth: 0.38 }, ["inspect", "store", "place-item"], [material("surface", "cyberpunk/metal/mid", "paint")]],
  ["cabinet", { width: 0.9, height: 1.8, depth: 0.48 }, ["inspect", "open", "close", "store"], [material("surface", "cyberpunk/wood/mid", "2")]],
];

function material(slot, key, variantId) {
  return { slot, key, variantId };
}

function requestFor(family, dimensions, requiredInteractions, materials, suffix = family) {
  return {
    contractVersion: "1.0",
    assetId: `fixture.${suffix}`,
    purpose: `Contract fixture for ${family}`,
    family,
    dimensions,
    materials,
    requiredInteractions,
    clearance: { approachDepth: 1.1, sideMargin: 0.3, overhead: 0.2 },
    seed: 91731,
  };
}

function expectCode(code, callback) {
  expect(callback).toThrow(expect.objectContaining({ name: "MissionAssetError", code }));
}

describe("mission asset creator contract", () => {
  it("replays identical input deterministically with a stable payload hash", () => {
    const first = new MissionAssetCreator(materialCatalog).create(terminalRequest);
    const second = new MissionAssetCreator(structuredClone(materialCatalog)).create(structuredClone(terminalRequest));
    const { payloadRef, ...payload } = first;
    const digest = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");

    expect(second).toEqual(first);
    expect(payloadRef.checksum).toBe(`sha256:${digest}`);
    expect(payloadRef.byteSize).toBe(Buffer.byteLength(canonicalJson(payload), "utf8"));
    expect(payloadRef.uri).toContain(digest);
    expect(matchesSchema("assetAssembly", first)).toBe(true);
  });

  it.each(FAMILY_CASES)("builds %s as an exact-fit material-backed assembly", (family, dimensions, interactions, materials) => {
    const asset = new MissionAssetCreator(materialCatalog).create(requestFor(family, dimensions, interactions, materials));
    const expectedBounds = {
      min: { x: -dimensions.width / 2, y: 0, z: -dimensions.depth / 2 },
      max: { x: dimensions.width / 2, y: dimensions.height, z: dimensions.depth / 2 },
    };

    expect(asset.dimensions).toEqual(dimensions);
    expect(asset.geometry.bounds).toEqual(expectedBounds);
    expect(asset.collision.bounds).toEqual(expectedBounds);
    expect(new Set(asset.geometry.primitives.map((primitive) => primitive.materialSlot)).has("surface")).toBe(true);
    expect(asset.geometry.primitives.every((primitive) => asset.materials.some((entry) => entry.slot === primitive.materialSlot))).toBe(true);
    expect(asset.interactionAnchors.map((anchor) => anchor.interaction)).toEqual(interactions);
    expect(asset.groundContactOrigin).toEqual({ x: 0, y: 0, z: 0 });
    expect(asset.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(asset.portable).toBe(["document", "data-drive", "tool", "package"].includes(family));
  });

  it("selects a stable named variant from the exact seed, family, and id", () => {
    const first = new MissionAssetCreator(materialCatalog).create(terminalRequest);
    const changedSeed = structuredClone(terminalRequest);
    changedSeed.seed = 42018;
    changedSeed.assetId = "terminal.archive-east";
    const second = new MissionAssetCreator(materialCatalog).create(changedSeed);

    expect(first.variantId).toBe("upright");
    expect(second.variantId).toBe("sloped");
  });

  it("rejects unresolved, wrong-variant, and family-incompatible materials", () => {
    const unknown = structuredClone(terminalRequest);
    unknown.materials[0].key = "cyberpunk/metal/not-real";
    expectCode("E_MATERIAL", () => new MissionAssetCreator(materialCatalog).create(unknown));

    const variant = structuredClone(terminalRequest);
    variant.materials[0].variantId = "not-real";
    expectCode("E_MATERIAL", () => new MissionAssetCreator(materialCatalog).create(variant));

    const incompatible = structuredClone(terminalRequest);
    incompatible.materials[0] = material("surface", "cyberpunk/fabric/mid", "flat");
    expectCode("E_MATERIAL", () => new MissionAssetCreator(materialCatalog).create(incompatible));
  });

  it("rejects unsupported or incomplete interaction declarations", () => {
    const invalid = structuredClone(terminalRequest);
    invalid.requiredInteractions = ["sit"];
    expectCode("E_INTERACTION", () => new MissionAssetCreator(materialCatalog).create(invalid));

    const closeWithoutOpen = requestFor(
      "cabinet",
      { width: 0.9, height: 1.8, depth: 0.48 },
      ["close"],
      [material("surface", "cyberpunk/wood/mid", "1")],
    );
    expectCode("E_INTERACTION", () => new MissionAssetCreator(materialCatalog).create(closeWithoutOpen));
  });

  it("rejects clearances that cannot support the declared operation", () => {
    const request = structuredClone(terminalRequest);
    request.clearance = { approachDepth: 0.6, sideMargin: 0.15, overhead: 0.08 };
    expect(matchesSchema("createRequest", request)).toBe(true);
    expectCode("E_CLEARANCE", () => new MissionAssetCreator(materialCatalog).create(request));
  });

  it("rejects dimensions outside a family's measured range", () => {
    const request = structuredClone(terminalRequest);
    request.dimensions.width = 0.1;
    expect(matchesSchema("createRequest", request)).toBe(true);
    expectCode("E_DIMENSIONS", () => new MissionAssetCreator(materialCatalog).create(request));
  });

  it("fails closed on schema-invalid requests and catalogs", () => {
    const request = { ...structuredClone(terminalRequest), position: { x: 1, y: 0, z: 2 } };
    expectCode("E_SCHEMA", () => new MissionAssetCreator(materialCatalog).create(request));

    const catalog = structuredClone(materialCatalog);
    catalog.entries[1].aliases = [catalog.entries[0].key];
    expectCode("E_SCHEMA", () => new MissionAssetCreator(catalog));
  });

  it("detects payload mutation during verification", () => {
    const creator = new MissionAssetCreator(materialCatalog);
    const asset = structuredClone(creator.create(terminalRequest));
    asset.purpose = "Tampered purpose";
    expectCode("E_HASH", () => creator.verifyAssembly(asset));
  });

  it("rejects collision parts that no longer describe the geometry even with a recomputed hash", () => {
    const creator = new MissionAssetCreator(materialCatalog);
    const asset = structuredClone(creator.create(terminalRequest));
    asset.collision.parts[0].bounds.max.x -= 0.01;
    const { payloadRef: ignored, ...payload } = asset;
    asset.payloadRef = payloadReference(asset.assetId, payload);
    expectCode("E_DIMENSIONS", () => creator.verifyAssembly(asset));
  });
});

describe("mission asset registry contract", () => {
  it("stores exact replay once and returns sorted filtered results", () => {
    const registry = new MissionAssetRegistry(materialCatalog);
    const table = requestFor(...FAMILY_CASES.find(([family]) => family === "table"), "z-table");
    const chair = requestFor(...FAMILY_CASES.find(([family]) => family === "chair"), "a-chair");
    registry.create(table);
    registry.create(chair);
    expect(registry.create(structuredClone(table))).toBe(registry.get({ contractVersion: "1.0", assetId: table.assetId }));

    const result = registry.list({ contractVersion: "1.0", interaction: "inspect" });
    expect(result.assets.map((asset) => asset.assetId)).toEqual(["fixture.a-chair", "fixture.z-table"]);
    expect(matchesSchema("registryResult", result)).toBe(true);
  });

  it("rejects an id collision and a missing lookup", () => {
    const registry = new MissionAssetRegistry(materialCatalog);
    registry.create(terminalRequest);
    const collision = structuredClone(terminalRequest);
    collision.seed += 1;
    expectCode("E_CONFLICT", () => registry.create(collision));
    expectCode("E_NOT_FOUND", () => registry.get({ contractVersion: "1.0", assetId: "asset.missing" }));
  });
});
