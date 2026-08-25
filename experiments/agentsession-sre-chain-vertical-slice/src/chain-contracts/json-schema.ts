/**
 * JSON Schema projection of the authored-form contracts (xtrm-qcy.1
 * deliverable). Deterministic: same zod schema + options → identical
 * JSON Schema bytes.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { ChainSourceSchema } from "./chain-source.ts";
import { ChainDefinitionSchema } from "./chain-definition.ts";

export function chainSourceJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ChainSourceSchema, {
    name: "XtrmChainSource",
    target: "openApi3",
    $refStrategy: "root",
  }) as Record<string, unknown>;
}

export function chainDefinitionJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ChainDefinitionSchema, {
    name: "XtrmChainDefinition",
    target: "openApi3",
    $refStrategy: "root",
  }) as Record<string, unknown>;
}
