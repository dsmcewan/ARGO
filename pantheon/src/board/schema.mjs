// The board's grammar: what an entry may be, which level it lives on, who may write it, which slot
// it claims, and which of its fields are merkle links.
//
// LEVELS 0-6 ONLY. Leases, occupancy, heartbeats and spend were level 7 in the first cut of this
// schema and that was wrong: hashing runtime chrome into a node forks the same claim every turn,
// because "expires_at" moving changes the cid of a hypothesis that did not change. L7 now lives in
// runtime.mjs, outside the DAG, keyed by resource or by the commit cid it describes.
//
// FOUR THINGS THE SCHEMA DECIDES THAT PROSE CANNOT
//
// 1. LEVEL. `notes[]` is how a discuss seat takes over a coding ticket: if every write lands in one
//    untyped list, an essay is the same kind of object as a patch and the controller has no
//    predicate that separates them. A kind's level is fixed here; an entry claiming another is
//    refused.
//
// 2. SLOTTED vs ACCUMULATIVE. `supersedes` only means something for a kind with a current head.
//    Evidence has none: three repros of one bug are three facts, not three versions of one fact,
//    and letting the third supersede the first would delete evidence through a field designed for
//    revisions.
//
// 3. WHO MAY WRITE WHAT. A mode is a capability, not a label. `discuss` cannot write an artifact;
//    nothing whose author class is `seat` can write a decision at all.
//
// 4. WHAT IS A LINK. The fields that used to be `Id[]` are cids, so the store can refuse a
//    fabricated citation at put time instead of a later walk finding it. An evidence hash with no
//    object behind it is unverifiable; a link must resolve.
//
// TWO DELIBERATE DEPARTURES FROM THE SKETCH, both because a slot name must be STABLE:
//
//   * A work item carries `key` (a slug), not `item_id`. A slot name has to survive supersession
//     and an entry id cannot: superseding is the operation that mints a new id for the same slot.
//     `item:withSeatLock` stays put across five revisions; `item:<cid>` would be a new slot each
//     time, so the tree would grow one dead slot per edit.
//   * A critique's slot carries its author: `critique:<slot>@<vendor>`. With one shared
//     `critique:<slot>` head the second reviewer of an artifact silently erases the first, and
//     "critiques.approve >= 1" then counts whoever wrote last. Per-author slots keep both verdicts
//     addressable.
import { isCid, codecOf } from "./canon.mjs";

export const LEVELS = { 0: "ticket", 1: "evidence", 2: "hypotheses", 3: "plan", 4: "artifacts", 5: "critiques", 6: "decisions" };

export class BoardViolation extends Error {
  constructor(message, code) { super(message); this.code = code ?? "INVALID"; }
}
const bad = (code, msg) => { throw new BoardViolation(msg, code); };
const str = (v, what) => { if (typeof v !== "string" || !v) bad("FIELD", `${what} must be a non-empty string`); };
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/#-]{0,127}$/;
const key = (v, what) => {
  str(v, what);
  // A slot name is a map key and appears in ref paths and log lines. An unconstrained key can
  // collide with the "kind:key" or "@vendor" delimiters and address a slot it was not given.
  if (!KEY_RE.test(v) || v.includes("@")) bad("FIELD", `${what} "${v}" is not a valid slot key`);
};

export const MODES = new Set(["plan", "work", "integrate", "critique", "explore", "refute", "synthesize", "discuss"]);
export const VENDORS = new Set(["anthropic", "openai", "agy_google", "xai"]);
export const AUTHOR_KINDS = new Set([...VENDORS, "human", "controller"]);
export const VISIBILITY = new Set(["board", "isolated", "supervisor"]);
export const WORK_STATES = new Set(["ready", "leased", "active", "offered_review", "changes_requested", "done", "blocked", "cancelled"]);
export const EVIDENCE_KINDS = new Set(["repro", "search", "trace"]);

// Modes whose entire value is that participants cannot see each other. A board-visible entry from
// one of these during execution is the context-collapse failure, refused rather than warned about.
export const ISOLATED_MODES = new Set(["refute", "discuss", "explore"]);

// A mode's writable kinds. Everything absent is refused by name.
//
// No mode can write a `decision`, and no vendor class appears in decision.writers either. That is
// rule 7 taken at its word: a synthesize seat records its recommendation as a HYPOTHESIS whose
// parents are the isolated entries, and the controller turns that into a decision under a named
// rule -- or records a split. Self-election was live in this repo's own swarm this morning,
// defaulting the judge to a proposer; leaving a model able to author the decision row is the same
// hole with a schema around it.
export const MODE_WRITES = {
  plan:       new Set(["plan", "work_item", "hypothesis"]),
  work:       new Set(["artifact", "work_item", "repro", "trace", "hypothesis"]),
  integrate:  new Set(["artifact", "work_item", "repro", "trace"]),
  critique:   new Set(["critique", "repro", "trace"]),
  explore:    new Set(["repro", "search", "trace", "hypothesis"]),
  refute:     new Set(["hypothesis", "critique", "repro"]),
  synthesize: new Set(["hypothesis"]),
  discuss:    new Set(["hypothesis"]),
};

// link name -> "cid" (one) or "cid[]" (many), with the codec each must have.
const L1 = (codec, many = false) => ({ codec, many });
const LINEAGE = { derived_from: L1("entry", true), supersedes: L1("entry", true) };

export const KINDS = {
  ticket: {
    level: 0, slotted: true, slot: () => "ticket", writers: ["human", "controller"],
    links: { ...LINEAGE },
  },
  repro: {
    level: 1, slotted: false, writers: ["seat", "controller"],
    links: { ...LINEAGE, excerpt: L1("blob") },      // the output itself, not a hash of it
  },
  search: {
    level: 1, slotted: false, writers: ["seat", "controller"],
    links: { ...LINEAGE, excerpt: L1("blob") },
  },
  trace: {
    level: 1, slotted: false, writers: ["seat", "controller"],
    links: { ...LINEAGE, log: L1("blob") },
  },
  hypothesis: {
    level: 2, slotted: true, slot: p => `hypothesis:${p.key}`, writers: ["seat"],
    links: { ...LINEAGE, supports: L1("entry", true), contradicts: L1("entry", true) },
  },
  plan: {
    level: 3, slotted: true, slot: () => "plan", writers: ["seat", "human"],
    links: { ...LINEAGE },
  },
  work_item: {
    level: 3, slotted: true, slot: p => `item:${p.key}`, writers: ["seat", "controller", "human"],
    // `offer` is the candidate this item is offering for review: the artifact entries themselves,
    // on the branch named by payload.offer_ref.
    //
    // WITHOUT THIS THE BOARD DEADLOCKS. bound-review keeps an unreviewed artifact OFF the shipping
    // ref, so a controller reading only the shipping ref can never see the thing that needs
    // reviewing and can never schedule the first review. An offer is therefore a POINTER TO A FORK,
    // exactly as a pull request is, and the reviewer is sent to the branch.
    links: { ...LINEAGE, offer: L1("entry", true) },
  },
  artifact: {
    level: 4, slotted: true, slot: p => `artifact:${p.slot}`, writers: ["seat"],
    links: { ...LINEAGE, bytes: L1("blob") },        // the binding IS a link to the content
  },
  critique: {
    level: 5, slotted: true, slot: (p, a) => `critique:${p.target.slot}@${a.vendor}`, writers: ["seat", "human"],
    links: { ...LINEAGE, target: L1("blob") },       // bound to the bytes reviewed, not to "the file"
  },
  decision: {
    // Rule 7 at the schema level: no `seat` in writers.
    level: 6, slotted: true, slot: p => `decision:${p.key}`, writers: ["controller", "human"],
    links: { ...LINEAGE, considered: L1("entry", true) },
  },
};

export const PAYLOAD_VALIDATORS = {
  ticket(p) {
    str(p.title, "ticket.title"); str(p.goal, "ticket.goal");
    if (!Array.isArray(p.acceptance) || p.acceptance.length === 0) {
      // A ticket with no acceptance criterion can only be closed by an opinion.
      bad("FIELD", "ticket.acceptance must list at least one criterion");
    }
    for (const a of p.acceptance) {
      if (a.type === "tests") { str(a.cmd, "acceptance.cmd"); if (a.expect !== "exit0") bad("FIELD", "acceptance.expect must be exit0"); }
      else if (a.type === "file_exists") str(a.path, "acceptance.path");
      else if (a.type === "human_ack") str(a.prompt, "acceptance.prompt");
      else bad("FIELD", `unknown acceptance type "${a.type}"`);
    }
    for (const f of ["constraints", "forbidden"]) if (p[f] !== undefined && !Array.isArray(p[f])) bad("FIELD", `ticket.${f} must be an array`);
  },
  repro(p) { str(p.cmd, "repro.cmd"); if (!Number.isInteger(p.exit)) bad("FIELD", "repro.exit must be an integer"); },
  search(p) { str(p.query, "search.query"); if (!Array.isArray(p.urls)) bad("FIELD", "search.urls must be an array"); },
  trace(p) { str(p.test, "trace.test"); },
  hypothesis(p) {
    key(p.key, "hypothesis.key"); str(p.claim, "hypothesis.claim");
    if (!["open", "held", "rejected"].includes(p.status)) bad("FIELD", "hypothesis.status must be open|held|rejected");
  },
  plan(p) {
    if (!Array.isArray(p.steps) || p.steps.length === 0) bad("FIELD", "plan.steps must be a non-empty array");
    for (const s of p.steps) { key(s.item, "plan.steps[].item"); str(s.title, "plan.steps[].title"); }
  },
  work_item(p) {
    key(p.key, "work_item.key"); str(p.title, "work_item.title");
    if (!WORK_STATES.has(p.state)) bad("FIELD", `work_item.state must be one of ${[...WORK_STATES].join("|")}`);
    if (p.depends_on !== undefined && !Array.isArray(p.depends_on)) bad("FIELD", "work_item.depends_on must be an array of item keys");
    if (!Array.isArray(p.artifact_slots)) bad("FIELD", "work_item.artifact_slots must list the slots this item may write");
    if (p.preferred_mode !== undefined && !MODES.has(p.preferred_mode)) bad("FIELD", `unknown preferred_mode "${p.preferred_mode}"`);
    if (p.state === "blocked" && !p.block?.reason) bad("FIELD", "a blocked work_item must say why");
    if (p.offer_ref !== undefined) str(p.offer_ref, "work_item.offer_ref");
    if (p.state === "offered_review" && !p.offer_ref) {
      bad("FIELD", "an item in offered_review must name the branch it offers (offer_ref) so a reviewer can be sent to it");
    }
  },
  artifact(p) {
    key(p.slot, "artifact.slot"); str(p.path, "artifact.path");
    if (!Number.isInteger(p.rev) || p.rev < 1) bad("FIELD", "artifact.rev must be an integer >= 1");
    if (p.closes !== undefined && !Array.isArray(p.closes)) bad("FIELD", "artifact.closes must be an array of work item keys");
    if ("content_hash" in p) bad("DERIVED", "artifact.content_hash is the links.bytes cid; a second copy can disagree with it");
  },
  critique(p) {
    if (!p.target) bad("FIELD", "critique.target is required");
    key(p.target.slot, "critique.target.slot");
    if (!Number.isInteger(p.target.rev)) bad("FIELD", "critique.target.rev must be an integer");
    if ("hash" in p.target) bad("DERIVED", "critique.target.hash is the links.target cid; a second copy can disagree with it");
    if (!["approve", "request_changes", "abstain"].includes(p.verdict)) bad("FIELD", "critique.verdict must be approve|request_changes|abstain");
    if (!Array.isArray(p.findings)) bad("FIELD", "critique.findings must be an array");
    for (const f of p.findings) {
      if (!["block", "should", "nit"].includes(f.severity)) bad("FIELD", `unknown finding severity "${f.severity}"`);
      str(f.note, "finding.note");
    }
    // A verdict that contradicts its own findings is the shape a reviewer takes when it has been
    // talked round: it keeps the finding and downgrades the conclusion.
    if (p.verdict === "approve" && p.findings.some(f => f.severity === "block")) {
      bad("CONTRADICTION", "critique cannot approve while carrying a blocking finding");
    }
  },
  decision(p) {
    key(p.key, "decision.key"); str(p.question, "decision.question");
    if (!Array.isArray(p.options) || p.options.length < 2) bad("FIELD", "decision.options must offer at least two options");
    const ids = new Set(p.options.map(o => o.id));
    if (ids.size !== p.options.length) bad("FIELD", "decision.options have duplicate ids");
    const r = p.resolution;
    if (!r) bad("FIELD", "decision.resolution is required");
    if (["unanimous", "controller_rule"].includes(r.type)) {
      if (!ids.has(r.option)) bad("FIELD", `resolution names option "${r.option}", which is not on the ballot`);
      if (r.type === "controller_rule") str(r.rule, "resolution.rule");
    } else if (r.type === "split") {
      if (r.recorded !== true) bad("FIELD", "a split resolution must be recorded:true");
    } else if (r.type !== "human") bad("FIELD", `unknown resolution type "${r.type}"`);
    if (p.judge !== undefined && !["human", "controller"].includes(p.judge)) {
      bad("JUDGE_IS_VENDOR", `decision.judge must be human or controller, never a vendor (got "${p.judge}")`);
    }
  },
};

export function slotOf(kind, payload, author) {
  const spec = KINDS[kind];
  if (!spec) bad("KIND", `unknown kind "${kind}"`);
  return spec.slotted ? spec.slot(payload, author) : null;
}

/** Author class: `seat` defers to MODE_WRITES for which mode; human/controller are literal. */
export const authorClassOf = author =>
  (VENDORS.has(author?.vendor) ? "seat" : author?.vendor);

function validateLinks(kind, links) {
  const spec = KINDS[kind].links;
  for (const name of Object.keys(links)) {
    if (!spec[name]) {
      // An undeclared link is refused rather than carried: a link nobody declared cannot be
      // reasoned about by a projection, so it would travel into contexts no rule reviewed.
      bad("LINK", `kind "${kind}" has no link named "${name}" (declared: ${Object.keys(spec).join(", ")})`);
    }
  }
  for (const [name, { codec, many }] of Object.entries(spec)) {
    const v = links[name];
    if (v === undefined) continue;
    const list = many ? v : [v];
    if (many && !Array.isArray(v)) bad("LINK", `${kind}.links.${name} must be an array of cids`);
    if (!many && Array.isArray(v)) bad("LINK", `${kind}.links.${name} must be a single cid`);
    for (const cid of list) {
      if (!isCid(cid)) bad("LINK", `${kind}.links.${name} contains "${cid}", which is not a cid`);
      if (codecOf(cid) !== codec) bad("LINK", `${kind}.links.${name} must point at a ${codec}, got ${codecOf(cid)}`);
    }
  }
  for (const req of ["derived_from", "supersedes"]) {
    if (links[req] !== undefined && !Array.isArray(links[req])) bad("LINK", `links.${req} must be an array (empty is fine)`);
  }
  // Content-bearing kinds must actually carry their content.
  const mustHave = { repro: "excerpt", search: "excerpt", trace: "log", artifact: "bytes", critique: "target" };
  if (mustHave[kind] && links[mustHave[kind]] === undefined) {
    bad("LINK", `a ${kind} must link its ${mustHave[kind]}; an unlinked ${kind} asserts something nobody can check`);
  }
}

/**
 * Shape check for an entry node, before any board-state rule is consulted.
 * Returns the slot it claims (null for accumulative kinds).
 */
export function validateEntry(entry) {
  const { kind, level, author, payload, visibility, links = {} } = entry ?? {};
  const spec = KINDS[kind];
  if (!spec) bad("KIND", `unknown kind "${kind}"; the board has no untyped slot to fall back on`);
  if (level !== spec.level) bad("LEVEL", `kind "${kind}" lives on level ${spec.level}, not ${level}`);
  if (!VISIBILITY.has(visibility)) bad("FIELD", `visibility must be one of ${[...VISIBILITY].join("|")}`);
  if (!author || !AUTHOR_KINDS.has(author.vendor)) bad("AUTHOR", `author.vendor must be one of ${[...AUTHOR_KINDS].join("|")}`);
  const cls = authorClassOf(author);
  if (!spec.writers.includes(cls)) {
    bad(kind === "decision" && cls === "seat" ? "JUDGE_IS_VENDOR" : "AUTHOR",
      `a ${cls} may not write "${kind}" (writers: ${spec.writers.join(", ")})`);
  }
  if (cls === "seat") {
    str(author.seat_id, "author.seat_id");
    if (!MODES.has(author.mode)) bad("AUTHOR", `author.mode must be one of ${[...MODES].join("|")}`);
    if (!Number.isInteger(author.occupancy_gen) || author.occupancy_gen < 1) bad("AUTHOR", "author.occupancy_gen must be an integer >= 1");
    if (!MODE_WRITES[author.mode].has(kind)) {
      bad("MODE", `a seat in "${author.mode}" mode may not write "${kind}" (it may write: ${[...MODE_WRITES[author.mode]].join(", ")})`);
    }
    for (const f of Object.keys(author)) {
      // The author is an identity, not a banner. A prose field here would churn the cid of an
      // otherwise identical claim and break dedup.
      if (!["vendor", "seat_id", "mode", "occupancy_gen"].includes(f)) bad("AUTHOR", `author.${f} is not part of a seat's identity; runtime detail belongs in the side log`);
    }
    // A CLAIM from an isolated mode must be isolated. Structural rather than status-dependent: the
    // earlier form of this rule was "refuse a board-visible debate entry while the board is
    // executing", which makes the same entry legal or illegal depending on a clock, and leaves the
    // window open whenever the board happens to be between states.
    //
    // It applies to claims and verdicts, NOT to evidence. A repro is a fact and facts are shared; a
    // position is an argument and arguments stay on their fork until synthesis.
    if (ISOLATED_MODES.has(author.mode) && (kind === "hypothesis" || kind === "critique") && visibility !== "isolated") {
      bad("VISIBILITY", `a ${kind} written in "${author.mode}" mode must be visibility:"isolated", not "${visibility}"; ` +
        `debaters do not share a transcript until synthesize`);
    }
  }
  if (entry.confidence !== undefined && (typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1)) {
    bad("FIELD", "confidence must be a number in 0..1");
  }
  for (const f of Object.keys(entry)) {
    if (!["type", "kind", "level", "author", "payload", "visibility", "links", "confidence"].includes(f)) {
      bad("FIELD", `entry field "${f}" is not part of a hashed node (no ts, no seq, no id: those churn the cid or duplicate it)`);
    }
  }
  validateLinks(kind, links);
  if (!spec.slotted && (links.supersedes?.length ?? 0) > 0) {
    bad("SUPERSEDE", `"${kind}" is accumulative, not versioned: it has no head to supersede, and superseding would delete evidence`);
  }
  PAYLOAD_VALIDATORS[kind](payload ?? {});
  return slotOf(kind, payload, author);
}
