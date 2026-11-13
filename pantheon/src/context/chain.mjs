// A conversation grows, so equality is the wrong relation and prefix/extension is the right one.
// Each link binds its turn to its predecessor, which gives prefix checking and tamper-evidence
// together (evidence P4c). Mirrors merkle-dag's effectiveHash shape (D2).
import { createHash } from "node:crypto";

const link = (prev, t) => createHash("sha256")
  .update(JSON.stringify({ prev, role: t.role, sha: t.sha, tools: t.tools ?? [] }))
  .digest("hex");

export function chainOf(turns) {
  const links = [];
  let prev = "genesis";
  for (const t of turns) { prev = link(prev, t); links.push(prev); }
  return links;
}

export function record(turns) {
  const c = chainOf(turns);
  return { head: c.at(-1) ?? "genesis", length: c.length };
}

// The check. Returns WHY it rejected, because an oracle that cannot say why cannot be shown to
// work - the lesson from the spike, which first passed for the wrong reason (evidence P7).
export function verifyExtends(liveTurns, recorded) {
  if (typeof recorded?.length !== "number") throw new Error("verifyExtends: record.length required");
  if (typeof recorded?.head !== "string") throw new Error("verifyExtends: record.head required");
  // An empty record is NOT a baseline. A transcript can legitimately project to zero turns - the
  // projector drops unparseable lines and turns with neither text nor tools - and an empty
  // baseline would accept every conversation on earth, which is a silent false-RESUMED: precisely
  // the failure this module exists to prevent. Callers with no baseline yet must skip
  // verification deliberately, not receive a free pass from it.
  if (recorded.length === 0) {
    return { ok: false, why: "recorded chain is empty; no baseline to verify against" };
  }
  if (liveTurns.length < recorded.length) return { ok: false, why: "shorter than recorded" };
  const live = chainOf(liveTurns);
  if (live[recorded.length - 1] !== recorded.head) return { ok: false, why: "prefix hash mismatch" };
  return { ok: true, grew: liveTurns.length - recorded.length };
}
