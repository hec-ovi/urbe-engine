import { canonicalJson } from "./canonical.js";
import { MissionAssetCreator } from "./MissionAssetCreator.js";
import { MissionAssetError } from "./MissionAssetError.js";
import { assertSchema } from "./schema.js";

export class MissionAssetRegistry {
  #creator;
  #assets = new Map();

  constructor(materialCatalog) {
    this.#creator = new MissionAssetCreator(materialCatalog);
  }

  create(request) {
    const asset = this.#creator.create(request);
    const existing = this.#assets.get(asset.assetId);
    if (existing && canonicalJson(existing) !== canonicalJson(asset)) {
      throw new MissionAssetError("E_CONFLICT", `Asset id already names a different assembly: ${asset.assetId}`, {
        assetId: asset.assetId,
      });
    }
    if (!existing) this.#assets.set(asset.assetId, asset);
    return existing ?? asset;
  }

  get(lookup) {
    assertSchema("assetLookup", lookup);
    const asset = this.#assets.get(lookup.assetId);
    if (!asset) {
      throw new MissionAssetError("E_NOT_FOUND", `Mission asset is not registered: ${lookup.assetId}`, {
        assetId: lookup.assetId,
      });
    }
    return asset;
  }

  list(query) {
    assertSchema("registryQuery", query);
    const assets = [...this.#assets.values()]
      .filter((asset) => query.family === undefined || asset.family === query.family)
      .filter((asset) => query.interaction === undefined || asset.interactionAnchors.some((anchor) => anchor.interaction === query.interaction))
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
    const result = { contractVersion: "1.0", assets };
    assertSchema("registryResult", result);
    return Object.freeze(result);
  }

  verify(assembly) {
    return this.#creator.verifyAssembly(assembly);
  }
}
