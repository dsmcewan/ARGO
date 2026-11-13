// Containment for a ticket's path-shaped fields.
//
// WHY THIS EXISTS. A ticket used to be hand-written by the operator and read off disk by the CLI.
// It is now also drafted by a model, from a document another model wrote, and submitted over HTTP.
// The trust boundary moved; the validation did not follow it. Containment was checked on
// `repo_root` alone while the pipeline path-joins five more fields onto it, and each of these was
// a working escape, demonstrated by execution in review:
//
//   key         -> the output directory and the board root. A key of "../../../../x" wrote
//                  run.json and progress.jsonl outside the allowed root, and the API answered 202.
//   copy[]      -> cpSync out of the worktree; read a file outside the allowed root with a
//                  perfectly legal repo_root.
//   attach[]    -> the same primitive, except the file's CONTENTS are interpolated into the
//                  implementer AND reviewer prompts, both of which go over the wire to vendor
//                  APIs. `attach: ["../../../.ssh/id_rsa"]` exfiltrates that file to four labs.
//   source      -> readFileSync into the implementer prompt.
//   tests_file  -> readFileSync into both prompts.
//
// This lives in src/board/ rather than beside the HTTP helpers because the pipeline is an
// importable surface with three doors (the CLI, the build API, and anything else that imports
// runOpenItem). Checking only at the HTTP door leaves the other two open. The dependency direction
// stays view -> board, never the reverse.
import { isAbsolute, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

// `key` becomes a DIRECTORY NAME, so the board's own KEY_RE is not the right check for it: that
// one permits "/" because a slot key may be a path. This is the identifier shape -- no separators,
// no leading dot -- matching what http-safety.mjs enforces for the seat labels that become object
// keys, for the same underlying reason.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const RESERVED = new Set(["constructor", "prototype", "__proto__"]);

// Shared admission contract: accepting a ticket that the runner cannot execute burns a seat.
export function ticketRuntimeRefusal(ticket) {
  if(!Array.isArray(ticket?.copy))return 'ticket.copy must be an array';
  if(typeof ticket?.acceptance_cmd!=='string'||!ticket.acceptance_cmd.trim())return 'ticket.acceptance_cmd must be a non-empty string';
  try{normalizeSlots(ticket);}catch(error){return `ticket.slot/slots: ${error.message}`;}
  return null;
}

/** True when `candidate` is `root` itself or sits underneath it.
 *
 *  Not a string prefix test -- that would let "/Projects-evil" pass against "/Projects". Symlinks
 *  are resolved first, because resolve() does not follow them and a symlink inside the root
 *  pointing out of it would otherwise pass. A path that does not exist yet is compared
 *  as-resolved: it cannot be a symlink to anywhere if it is not there. */
export function isUnder(root, candidate) {
  const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };
  const r = real(root);
  const c = real(candidate);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

const PATH_FIELDS = ["source", "tests_file", "path"];
const PATH_LIST_FIELDS = ["copy", "attach"];

/**
 * The files one ticket asks for, one entry per implementer.
 *
 * A ticket used to name exactly one file (`slot` + `path`), which is why three implementers on one
 * ticket could only ever write the same file and need someone to pick a winner. That was never a
 * board constraint -- `artifact_slots` is a list in the schema, and the lease table maps each slot
 * to its own holder -- it was this runner's. Several implementers each owning a DIFFERENT slot are
 * not competing, so nothing has to choose between them.
 *
 * The singular form still works and means one slot, so every ticket written before this keeps
 * building exactly as it did.
 *
 * @returns {{slot: string, path: string, goal: string, source: string|null, model: string|null}[]}
 *   `model` is the per-slot choice of which rung builds it (e.g. gpt-6-astra vs gpt-6-sol vs
 *   gpt-6-luna); null means "use the role's ladder", so the decision can be deferred per slot
 *   rather than baked into the seating table.
 */
export function normalizeSlots(spec) {
  const raw = Array.isArray(spec?.slots) && spec.slots.length
    ? spec.slots
    : (spec?.slot !== undefined ? [{ slot: spec.slot, path: spec.path, goal: spec.goal, source: spec.source }] : null);
  if (!raw) throw new Error('ticket names no file: give "slot" (and optionally "path"), or a "slots" array');

  const seenSlots = new Set();
  const seenPaths = new Set();
  return raw.map((entry, i) => {
    const slot = entry?.slot;
    if (typeof slot !== "string" || !IDENTIFIER.test(slot) || RESERVED.has(slot)) {
      throw new Error(`slots[${i}].slot "${slot}" is not an identifier: it becomes a board key`);
    }
    const path = entry.path ?? slot;
    if (typeof path !== "string" || !path) throw new Error(`slots[${i}].path must be a non-empty string`);
    // Two implementers on one slot is the corruption case the per-slot lease exists to prevent;
    // refusing it here means the lease never has to arbitrate a conflict the ticket created.
    if (seenSlots.has(slot)) throw new Error(`duplicate slot "${slot}": two implementers cannot own one slot`);
    if (seenPaths.has(path)) throw new Error(`slots[${i}] writes the same path as an earlier slot: "${path}"`);
    seenSlots.add(slot);
    seenPaths.add(path);
    return {
      slot,
      path,
      goal: entry.goal ?? spec.goal,
      source: entry.source ?? null,
      model: entry.model ?? null,
    };
  });
}

/**
 * Where a ticket's run record and artifacts land. Exported because the build API has to tell a
 * caller where to look BEFORE the run finishes, and a caller polling for the outcome must not
 * have to reimplement this formula and drift from it.
 *
 * Safe to call at request time: it is a pure path computation, and `key` is validated as an
 * identifier before anything joins it (see ticketContainmentRefusal).
 */
export function outDirFor(ticket) {
  return resolve(ticket.repo_root, "outputs", "open-items", ticket.key);
}

/**
 * The reason to refuse this ticket, or null when its path-shaped fields are all contained.
 *
 * @param {object} ticket
 * @param {object} [o]
 * @param {string} [o.allowedRoot] - when set, `repo_root` must resolve to this directory or below
 *   it, and must be absolute. Omitted (the CLI's case, where the operator names the repo directly),
 *   repo_root is not constrained -- but every field joined ONTO it still is.
 */
export function ticketContainmentRefusal(ticket, { allowedRoot = null } = {}) {
  if (typeof ticket?.key !== "string" || !IDENTIFIER.test(ticket.key) || RESERVED.has(ticket.key)) {
    return `ticket.key "${ticket?.key}" is not an identifier: it becomes a directory name, so separators and leading dots are refused`;
  }

  if (allowedRoot !== null) {
    if (typeof ticket.repo_root !== "string" || !ticket.repo_root) {
      return "ticket.repo_root must be set: a build API cannot fall back to this repo's own root";
    }
    if (!isAbsolute(ticket.repo_root)) {
      // The API would resolve a relative value against process.cwd() and the pipeline against the
      // pantheon repo root. When those disagree, the one that decided it was safe is not the one
      // that builds there.
      return `ticket.repo_root "${ticket.repo_root}" must be an absolute path`;
    }
    if (!isUnder(allowedRoot, ticket.repo_root)) {
      return `ticket.repo_root "${ticket.repo_root}" is outside ${allowedRoot}`;
    }
  }

  // Fields joined onto repo_root are checked against it whether or not repo_root itself was
  // constrained: "stay inside the repo you named" holds for a CLI ticket too.
  const root = ticket.repo_root;
  if (typeof root !== "string" || !root) return null;   // no root to contain against; nothing joined

  const contained = (field, rel) => {
    if (typeof rel !== "string" || !rel) return `ticket.${field} entries must be non-empty strings`;
    if (isAbsolute(rel)) return `ticket.${field} "${rel}" must be relative to repo_root, not absolute`;
    if (!isUnder(root, resolve(root, rel))) return `ticket.${field} "${rel}" escapes repo_root`;
    return null;
  };

  for (const field of PATH_LIST_FIELDS) {
    const list = ticket[field];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return `ticket.${field} must be an array`;
    for (const rel of list) { const why = contained(field, rel); if (why) return why; }
  }
  for (const field of PATH_FIELDS) {
    if (ticket[field] === undefined || ticket[field] === null) continue;
    const why = contained(field, ticket[field]);
    if (why) return why;
  }
  // EVERY slot's path, not just the singular one. A multi-slot ticket that checked only its first
  // entry would be a containment hole wearing the shape of a fixed one.
  if (Array.isArray(ticket.slots)) {
    for (const [i, entry] of ticket.slots.entries()) {
      for (const field of ["path", "source"]) {
        if (entry?.[field] === undefined || entry?.[field] === null) continue;
        const why = contained(`slots[${i}].${field}`, entry[field]);
        if (why) return why;
      }
    }
  }
  return null;
}
