import Ajv2020 from "ajv/dist/2020.js";
import valuesSchema from "../schema/values.schema.json";
import materialCatalogSchema from "../schema/material-catalog.schema.json";
import createRequestSchema from "../schema/create-request.schema.json";
import assetAssemblySchema from "../schema/asset-assembly.schema.json";
import assetLookupSchema from "../schema/asset-lookup.schema.json";
import registryQuerySchema from "../schema/registry-query.schema.json";
import registryResultSchema from "../schema/registry-result.schema.json";
import errorSchema from "../schema/error.schema.json";
import { MissionAssetError } from "./MissionAssetError.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const schema of [
  valuesSchema,
  materialCatalogSchema,
  createRequestSchema,
  assetAssemblySchema,
  assetLookupSchema,
  registryQuerySchema,
  registryResultSchema,
  errorSchema,
]) {
  ajv.addSchema(schema);
}

const validators = Object.freeze({
  materialCatalog: ajv.getSchema(materialCatalogSchema.$id),
  createRequest: ajv.getSchema(createRequestSchema.$id),
  assetAssembly: ajv.getSchema(assetAssemblySchema.$id),
  assetLookup: ajv.getSchema(assetLookupSchema.$id),
  registryQuery: ajv.getSchema(registryQuerySchema.$id),
  registryResult: ajv.getSchema(registryResultSchema.$id),
  error: ajv.getSchema(errorSchema.$id),
});

function describeErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    rule: error.keyword,
    message: error.message,
  }));
}

export function assertSchema(name, value) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown mission asset schema: ${name}`);
  if (validate(value)) return value;
  throw new MissionAssetError("E_SCHEMA", `${name} does not match its contract`, {
    errors: describeErrors(validate.errors),
  });
}

export function matchesSchema(name, value) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown mission asset schema: ${name}`);
  return validate(value);
}
