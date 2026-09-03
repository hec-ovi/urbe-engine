import { createHash } from "node:crypto";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function payloadReference(assetId, payload) {
  const json = canonicalJson(payload);
  const digest = createHash("sha256").update(json, "utf8").digest("hex");
  return {
    uri: `urn:urbe:mission-asset:${assetId}:${digest}`,
    mediaType: "application/vnd.urbe.mission-asset+json",
    byteSize: Buffer.byteLength(json, "utf8"),
    checksum: `sha256:${digest}`,
  };
}
