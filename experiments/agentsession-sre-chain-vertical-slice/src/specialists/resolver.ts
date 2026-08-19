import { createHash } from "node:crypto";
import {
  compileSpecialistActivationProfile,
  assertSpecialistCompatible,
  type SpecialistActivationProfile,
  type LoadedSpecialistDocument,
  type SpecialistLoaderOptions,
} from "./loader.ts";
import { parseSpecialistDocument } from "./schema.ts";

/**
 * Structural interface deliberately matching the stable public
 * `@jaggerxtrm/specialists/lib` SpecialistLoader#get(name) surface without
 * taking a package dependency in this bounded experiment.
 *
 * Production composition can inject:
 *   new SpecialistLoader({ projectDir: targetRepo })
 *
 * and therefore reuse Specialists' canonical package -> global -> repo merge
 * semantics while keeping XTRM's compile/runtime policy independent.
 */
export interface EffectiveSpecialistResolver {
  get(name: string): Promise<unknown>;
}

export interface EffectiveSpecialistProvenance {
  resolver: string;
  specialist_name: string;
  /** Optional top-layer/source hint from the upstream resolver. */
  source_hint?: string;
}

function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

/**
 * Compile an already-effective Specialist object. This is the preferred
 * production seam: upstream owns authoring-layer resolution; XTRM owns
 * validation, capability adaptation and activation semantics.
 */
export async function compileFromEffectiveResolver(
  resolver: EffectiveSpecialistResolver,
  provenance: EffectiveSpecialistProvenance,
  options: SpecialistLoaderOptions,
): Promise<SpecialistActivationProfile> {
  const raw = await resolver.get(provenance.specialist_name);
  const document = parseSpecialistDocument(raw, provenance.source_hint ?? `<${provenance.resolver}:effective>`);
  const canonical = stableJson(raw);
  const loaded: LoadedSpecialistDocument = {
    raw: raw as Record<string, unknown>,
    document,
    source: {
      path: provenance.source_hint ?? `<${provenance.resolver}:effective:${provenance.specialist_name}>`,
      sha256: createHash("sha256").update(canonical).digest("hex"),
      bytes: Buffer.byteLength(canonical),
    },
  };
  const profile = await compileSpecialistActivationProfile(loaded, options);
  assertSpecialistCompatible(profile);
  return profile;
}
