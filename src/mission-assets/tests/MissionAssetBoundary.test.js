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

// One portable family, one fixed family with an extra slot, and the control
// terminal, which is the only family that also requires a display slot.
const FAMILY_CASES = [
  ["document", { width: 0.24, height: 0.018, depth: 0.32 }, ["inspect", "read", "take"], [material("surface", "cyberpunk/fabric/mid", "flat")]],
  ["chair", { width: 0.48, height: 0.92, depth: 0.52 }, ["inspect", "sit"], [material("surface", "cyberpunk/metal/mid", "paint"), material("upholstery", "cyberpunk/fabric/mid", "1")]],
  ["control-terminal", { width: 0.9, height: 1.35, depth: 0.55 }, ["inspect", "access", "hack"], [material("surface", "cyberpunk/metal/mid", "paint"), material("display", "cyberpunk/ad-screen/mid", "noir-cyan")]],
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
  it("replays identical input deterministically, with a stable variant and payload hash", () => {
    const first = new MissionAssetCreator(materialCatalog).create(terminalRequest);
    const second = new MissionAssetCreator(structuredClone(materialCatalog)).create(structuredClone(terminalRequest));
    const { payloadRef, ...payload } = first;
    const digest = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");

    expect(second).toEqual(first);
    expect(payloadRef.checksum).toBe(`sha256:${digest}`);
    expect(payloadRef.byteSize).toBe(Buffer.byteLength(canonicalJson(payload), "utf8"));
    expect(payloadRef.uri).toContain(digest);
    expect(matchesSchema("assetAssembly", first)).toBe(true);
    expect(first.variantId).toBe("upright");

    const changedSeed = structuredClone(terminalRequest);
    changedSeed.seed = 42018;
    changedSeed.assetId = "terminal.archive-east";
    expect(new MissionAssetCreator(materialCatalog).create(changedSeed).variantId).toBe("sloped");
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
    expect(asset.portable).toBe(family === "document");
  });

  it("rejects schema-invalid requests and catalogs, unresolved materials and unsupported interactions", () => {
    const placed = { ...structuredClone(terminalRequest), position: { x: 1, y: 0, z: 2 } };
    expectCode("E_SCHEMA", () => new MissionAssetCreator(materialCatalog).create(placed));

    const catalog = structuredClone(materialCatalog);
    catalog.entries[1].aliases = [catalog.entries[0].key];
    expectCode("E_SCHEMA", () => new MissionAssetCreator(catalog));

    for (const change of [
      (request) => { request.materials[0].key = "cyberpunk/metal/not-real"; },
      (request) => { request.materials[0].variantId = "not-real"; },
      (request) => { request.materials[0] = material("surface", "cyberpunk/fabric/mid", "flat"); },
    ]) {
      const request = structuredClone(terminalRequest);
      change(request);
      expectCode("E_MATERIAL", () => new MissionAssetCreator(materialCatalog).create(request));
    }

    const unsupported = structuredClone(terminalRequest);
    unsupported.requiredInteractions = ["sit"];
    expectCode("E_INTERACTION", () => new MissionAssetCreator(materialCatalog).create(unsupported));
    expectCode("E_INTERACTION", () => new MissionAssetCreator(materialCatalog).create(requestFor(
      "cabinet", { width: 0.9, height: 1.8, depth: 0.48 }, ["close"], [material("surface", "cyberpunk/wood/mid", "1")],
    )));
  });

  it("rejects dimensions and clearances it cannot physically support, and any payload that no longer describes the asset", () => {
    const tight = structuredClone(terminalRequest);
    tight.clearance = { approachDepth: 0.6, sideMargin: 0.15, overhead: 0.08 };
    expect(matchesSchema("createRequest", tight)).toBe(true);
    expectCode("E_CLEARANCE", () => new MissionAssetCreator(materialCatalog).create(tight));

    const narrow = structuredClone(terminalRequest);
    narrow.dimensions.width = 0.1;
    expect(matchesSchema("createRequest", narrow)).toBe(true);
    expectCode("E_DIMENSIONS", () => new MissionAssetCreator(materialCatalog).create(narrow));

    const creator = new MissionAssetCreator(materialCatalog);
    const tampered = structuredClone(creator.create(terminalRequest));
    tampered.purpose = "Tampered purpose";
    expectCode("E_HASH", () => creator.verifyAssembly(tampered));

    const rehashed = structuredClone(creator.create(terminalRequest));
    rehashed.collision.parts[0].bounds.max.x -= 0.01;
    const { payloadRef: ignored, ...payload } = rehashed;
    rehashed.payloadRef = payloadReference(rehashed.assetId, payload);
    expectCode("E_DIMENSIONS", () => creator.verifyAssembly(rehashed));
  });
});

describe("mission asset registry contract", () => {
  it("stores exact replay once, returns sorted filtered results and fails closed on collision or absence", () => {
    const registry = new MissionAssetRegistry(materialCatalog);
    const chair = requestFor(...FAMILY_CASES.find(([family]) => family === "chair"), "a-chair");
    const document = requestFor(...FAMILY_CASES.find(([family]) => family === "document"), "z-document");
    registry.create(document);
    registry.create(chair);
    expect(registry.create(structuredClone(document))).toBe(registry.get({ contractVersion: "1.0", assetId: document.assetId }));

    const result = registry.list({ contractVersion: "1.0", interaction: "inspect" });
    expect(result.assets.map((asset) => asset.assetId)).toEqual(["fixture.a-chair", "fixture.z-document"]);
    expect(matchesSchema("registryResult", result)).toBe(true);

    const collision = structuredClone(document);
    collision.seed += 1;
    expectCode("E_CONFLICT", () => registry.create(collision));
    expectCode("E_NOT_FOUND", () => registry.get({ contractVersion: "1.0", assetId: "asset.missing" }));
  });
});
