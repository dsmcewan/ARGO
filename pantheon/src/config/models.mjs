import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// THE ONE PLACE TO CHANGE A MODEL ID. src/sdk/adapter.mjs, src/role/seating.mjs and
// src/route/router.mjs all read model IDs from models.json via modelId() below, instead of each
// carrying their own copy of the spelling. The cautionary example this comment used to give had
// the two ids the WRONG WAY ROUND: docs.x.ai gives "grok-4.20-multi-agent" verbatim, and the
// "-0309" form was the invention. Corrected 2026-09-28. The duplication argument stands; the
// example was itself an instance of it, which is the only reason it survived this long.
//
// TO ADD OR CORRECT A MODEL: edit models.json only. Each vendor's object maps a short name (used
// as `modelId(vendor, name)`'s second argument at every call site) to the literal model-ID string
// the vendor's API expects. The short name is free-form and chosen for readability at the call
// site (e.g. "fable", "astra", "grok-4.7"); the value is never invented -- see
// docs/specs/2026-09-27-vendor-model-facts.md for where each one was verified.
//
// TO ADD A NEW VENDOR: add a top-level key here, then a matching key in ADAPTERS
// (src/sdk/adapter.mjs) and SEAT_FACTS (src/route/router.mjs) -- both of those still carry their
// own vendor-specific fields (auth, continuity, effort tables) that don't belong in this file,
// which is model-ID spelling ONLY.
//
// JSON carries no comments, so this file is JSON's explanation, not the config's -- if a citation
// or a "why this ID and not that one" belongs anywhere, it belongs in the vendor-model-facts doc
// above, referenced from here rather than duplicated.
export const MODELS = JSON.parse(readFileSync(join(HERE, "models.json"), "utf8"));

export function modelId(vendor, name) {
  const v = MODELS[vendor];
  if (!v) throw new Error(`modelId: unknown vendor "${vendor}"`);
  const id = v[name];
  if (!id) throw new Error(`modelId: unknown model "${name}" for vendor "${vendor}"`);
  return id;
}
