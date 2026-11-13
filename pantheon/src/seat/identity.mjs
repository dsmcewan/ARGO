// A seat is an identity, not a process. cwd is part of that identity because every vendor's
// resume is directory-scoped (evidence B item 6b) - dropping it silently merges two seats.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const REQUIRED = ["vendor", "purpose", "cwd"];

export function seatKey(seat) {
  for (const f of REQUIRED) {
    if (!seat?.[f]) throw new Error(`seatKey: missing required field "${f}"`);
  }
  // JSON canon: unambiguous under any path content, no delimiter to collide with.
  const canon = JSON.stringify([seat.vendor, seat.purpose, resolve(seat.cwd)]);
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

// A vendor's identifier is part of seatKey's hash, so renaming one orphans every seat/history file
// recorded under the old name -- found by an independent review of the 2026-09-28 "google"/"agy"
// -> "agy_google" rename (a5fade49097a8c183), which reproduced real conversation loss against
// files already on this machine. Every rename this project makes gets an entry here, current
// vendor -> the name(s) it used to answer to, so a READ can still find that state. Nothing writes
// under an old name again -- the next save lands at the current key, and the file there heals on
// its own.
export const VENDOR_ALIASES = {
  agy_google: ["google", "agy"],
};

/** The keys this seat's identity used to hash to, oldest renames included, never the current one. */
export function seatKeyAliases(seat) {
  const aliases = VENDOR_ALIASES[seat.vendor] ?? [];
  return aliases.map(vendor => seatKey({ ...seat, vendor }));
}

// Provenance rank, adopted from OpenRig's session-registry (evidence O3). Any fact assembled
// from signals of unequal trust needs this; seat identity is exactly such a fact.
// `sdk` is the vendor's own structured return value (a Responses id read off the response
// object), which is strictly stronger evidence than a hook observing the CLI, a string scraped
// from terminal output, or an id we minted ourselves. It tops the order for that reason.
export const RANK = { sdk: 5, hook: 4, scrape: 3, operator: 2, adoption: 1 };

export function rankOf(source) {
  const r = RANK[source];
  if (r === undefined) throw new Error(`rankOf: unknown provenance "${source}"`);
  return r;
}

export function mergeIdentity(existing, incoming) {
  rankOf(incoming.source);
  if (!existing) return { ...incoming, changed: true };
  if (rankOf(incoming.source) < rankOf(existing.source)) {
    return { ...existing, changed: false };
  }
  return { ...incoming, changed: true };
}
