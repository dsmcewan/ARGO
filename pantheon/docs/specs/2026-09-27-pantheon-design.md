# Pantheon — design spec

**Date:** 2026-09-27 · **Status:** DRAFT, awaiting the user's review · **Author:** Claude Opus 5, this session
**Evidence base:** [`2026-09-27-evidence-base.md`](2026-09-27-evidence-base.md) — 320 lines, every claim carrying its `file:line`. Section letters below (B3, D5, L3 …) cite it.

---

## 0. One paragraph

Pantheon turns a set of OAuth-authed vendor CLIs into a **supervised team of durable seats**. A seat is a stable
address with a persisted vendor conversation id, a declared write set, and a declared capability record. Work is a
content-addressed DAG; the supervisor — never the model — holds every fencing token, hands a seat one node at a time,
and settles completion by rehashing the files on disk. It installs without writing a single file the user did not
name, and it ships the evaluation that says whether the team beat one strong session.

It is built on a gap, not against a competitor: terminal orchestration is solved (§14), and **verified persistence
and settlement is the piece missing from every harness surveyed.**

## 1. What this is not

- **Not a message bus.** That layer exists here already and has coordinated nothing: ~600 tasks across six boards,
  13 claim attempts, all 13 from one program talking to itself (C-section, item 6). Pantheon does not add a
  seventh board.
- **Not tmux-based.** OpenRig is built on tmux because native session lifecycle did not exist when it was written.
  It does now (B3, K3). tmux is an optional human-viewing convenience in Pantheon, never the authority. The cost of
  the other choice is now measured, not predicted: readiness there is decided by matching literal rendered TUI
  strings — `"No conversation found"`, `"Do you trust the contents of this directory?"`, a prompt-glyph regex, the
  resume-chooser wording — so any vendor banner or layout change breaks the state ladder silently until patched, and
  three open issues are already instances of that class (N4).
- **Not a 55-table daemon.** OpenRig carries ~55 tables across 85 migrations and ~65 API route groups (N1). Pantheon
  is not trying to match that surface; most of it exists to reconstruct facts that a structured event stream states
  directly.
- **Not a claim that swarms work.** Nothing in this workspace or in OpenRig shows a team beating one good session
  (E4). Pantheon treats that as the open question it is and measures it (§10).

## 2. The four claims, and what would falsify each

The user selected four axes. A claim with no falsifier is marketing, so each gets one.

| Claim | Falsified by |
|---|---|
| **Trustworthy operation** | Any file written outside `$PANTHEON_HOME` that the user did not name in config. Test: §9 |
| **Proven effectiveness** | A paired blind trial where the team does not beat one session, reported as such | 
| **Recovery and continuity** | A restart reported as *resumed* whose seat cannot be shown, by hash, to hold the context it held before (O4) |
| **Harness breadth** | A seat whose declared capabilities do not match its observed behaviour, or an added vendor that yields no additional uncontended throughput |

## 3. Core model

Four nouns. Everything else is machinery.

- **Seat** — a stable identity `(vendor, purpose, cwd)`. Owns a persisted vendor conversation id, a capability
  record (§4), and a sandbox posture. Survives process death; is not a process.
- **ContextBundle** — the exact material handed to a seat for a turn: brief, prior results, file excerpts,
  instructions. Canonicalized and content-addressed, so its hash **labels what the seat knew**. Bundles chain by
  `effectiveHash`, so a seat's context has verifiable *lineage*, not just a current value.
- **Turn** — one framed exchange with a seat, bound to exactly one ContextBundle hash. On a bidirectional seat: one
  NDJSON message in, a stream of events out. On a warm-resume seat: one resume-spawn.
- **WorkNode** — a unit of work with a **declared write set**, addressed by `specHash` and chained to its parents
  by `effectiveHash` (D2). Borrowed wholesale from merkle-dag.
- **Settlement** — a signed record that a node completed, bound to the `artifact_tree_hash` recomputed from the
  bytes on disk (D4). Never a seat's self-report.

### 3.1 The rule the whole design turns on

> **A seat never holds a fencing token.**

The existing board's fencing is correct (C4): status, `claimed_by`, `claim_id` and `generation` must all match, and
the lease is checked separately. It has still coordinated nothing, and the cause is not ceremony — the minimum is
two calls (C, item 4). The cause is that it asks a *language model* to carry three opaque tokens across turns of its
own context and to renew a lease on time. Models do that unreliably, and when they fail the error is correct and
useless (`stale_claim`, with no hint to scroll back).

So the supervisor claims, spawns, and settles. The seat receives a prompt and does work. Nothing to carry, nothing
to renew, nothing to remember — therefore nothing to get wrong. The correct fencing core gets used by the one
participant that can be trusted to execute a protocol.

## 4. The seat capability table

The spec's central data structure. Capabilities are **declared per seat and verified**, never assumed uniform.

```
seat: { vendor, purpose, cwd, model?, effort? }
capabilities: {
  resume:     "native" | "none"          # --resume / --conversation / -c
  stream_in:  "ndjson" | "none"          # can accept turn-per-line on stdin
  stream_out: "ndjson" | "json" | "text" # incremental deltas available?
  attach:     "native" | "none"          # detach/attach/respawn/stop/logs
  auth:       "oauth"                    # every seat today (L1)
  sandbox:    <argv fragment>            # the posture, explicit, per seat
}
```

Observed state as of 2026-09-27 (B3, K3):

| vendor | resume | stream_in | stream_out | attach | class |
|---|---|---|---|---|---|
| claude | native | ndjson | ndjson | **native** (`--bg/attach/respawn/stop/logs`) | live seat |
| agy | native | **ndjson** | ndjson | none | live seat |
| grok | native | none | ndjson | none | warm seat |
| codex | native | UNVERIFIED | ndjson (`exec --json`) | none | warm seat |

Two classes, honestly labelled:
- **Live seat** — bidirectional NDJSON. One long-lived child, fed turn-by-turn, emitting deltas. Mid-task progress
  is free. Delivery is acknowledged by a response event, which closes OpenRig's worst gap (A4).
- **Warm seat** — resume-spawn per turn. Nothing runs while idle, so nothing can wedge and crash-safety is free.

**Provenance rank on every identity and capability write, adopted from OpenRig (O3):** `hook > scrape > operator >
adoption`, where a lower-rank writer can never clobber a higher-rank one. Any fact assembled from signals of
unequal trust needs this, and seat identity is exactly such a fact.

**Acceptance check:** a conformance runner that, for each seat, executes the capability it declares and fails closed
if declared ≠ observed. A capability table nobody executes is the `routing-matrix.json` failure again — most rows
self-flagged unverified since 2026-07-23 (B10).

## 5. Transport

**CLI primary. SDK only as a capped overflow lane.** Reasons, each evidenced: session resume is a CLI feature (B3);
claude has no SDK lane by design and must *refuse* rather than invent argv (K2b); all four ride OAuth so the SDK
buys no auth advantage (L1); the SDK lane already pays a protobuf-conflict tax requiring separate venvs (B10).

`callSeat()` cannot be reused for live seats and must not be forced to: resolve fires only on `close`, the 300s
timer kills any long-lived child, `detached:true` returns no handle to reattach, and stdout is parsed once at exit
rather than framed per turn (B, item 6c). Warm seats keep the existing short-lived shape — it is the *correct*
shape for them. Live seats get a separate supervised spawn path.

## 6. Context addressing — what merkle-dag is for

The merkle-dag is here to **label and keep track of context.** That is its job in Pantheon, and it is the capability
no surveyed harness has.

The unanswerable question in every multi-agent system today is *what did this seat actually know when it answered?*
OpenRig gets closest with a `compaction_strategy` field per member and a collector writing token-usage telemetry
(A1, A5) — but that measures context *volume*, not context *identity*. Volume tells you a seat was at 60% of its
window. It cannot tell you which brief, which prior result, or which file revision it was reading, and therefore
cannot tell you whether two seats disagreed about a conclusion or merely saw different inputs.

Pantheon gives every ContextBundle a content address before it reaches a seat:

- **Label.** `artifactRef(bundle)` yields `sha256:<hex>`; `writeProposalArtifact` canonicalizes it to
  `.pantheon/artifacts/sha256_<hex>.json` and throws on collision (D3). The hash *is* the label — no mutable name
  keys it, which is this workspace's core invariant.
- **Lineage.** `effectiveHash` binds a bundle's spec hash to its sorted parent hashes (D2), so a bundle is a node in
  a chain rather than a loose blob. "This answer came from that brief plus those two prior results" becomes a path,
  not a recollection.
- **Recall that fails closed.** `readProposalArtifact` rehashes on read and returns `null` on mismatch (D3). A
  drifted bundle cannot be silently re-served — it is absent, not wrong.
- **Binding.** Each Turn records `(seat, vendor_conversation_id, bundle_hash)`. On resume, Pantheon can prove the
  restored seat is bound to the same context it had — which is what makes the continuity claim (§2) checkable
  instead of hopeful.

This is also what makes disagreement legible. Two seats that answered differently either saw different bundle
hashes — an input difference, not a disagreement — or saw the same hash, in which case the divergence is real and
worth adjudicating. That distinction is unavailable today, and council-style agreement scoring is unsound without
it.

### 6.1 What the binding specifically prevents

This is not hypothetical. OpenRig decides that a seat resumed by matching its rendered TUI
(`native-resume-probe.ts:113-121`): a prompt glyph plus `"Claude Code v"` or `"accept edits on"`, else a bare
`paneCommand === "claude"`. Every one of those is **equally true of a brand-new session.** A false *fresh* is
structurally prevented there — any non-resumed outcome rolls back to `awaiting-decision` — but a false *resumed* is
not: if `claude --resume <token>` quietly starts a new conversation without printing "No conversation found", the
operator is told the seat resumed (O4). The probe verifies liveness, not identity.

Binding each Turn to `(seat, vendor_conversation_id, bundle_hash)` makes that verdict checkable: a seat has resumed
when it can be shown to hold the bundle chain it held before, not when its banner looks familiar.

### 6.2 Conversation hashing — verifying what the seat actually has

The bundle hash proves what Pantheon *handed* a seat. It does not prove what the seat *holds*. Those are different
claims, and the second is the one that catches a silent restart — so Pantheon hashes the conversation too.

The conversations are already on local disk, in parseable JSONL, for at least two vendors (P1): `claude` keeps full
per-session transcripts under `~/.claude/projects/` (1170 of them, with `user` and `assistant` lines), and `codex`
keeps rollout logs under `~/.codex/sessions/` (208, with `response_item` and `turn_context` lines). `grok` and `agy`
persist something but their stores are not yet confirmed. So this reads a file that exists rather than inventing a
capability.

**The check.** At teardown, hash the normalized projection of the conversation to `H`. After restore, re-read the
vendor session file and require that it still contains the prefix hashing to `H`. A conversation that quietly
started over has no such prefix, so it **fails positively** — which is precisely what a TUI-liveness match cannot do
(§6.1, O4). "Resumed" stops being an inference about a banner and becomes a verified claim about content.

**Demonstrated, not assumed (P6).** `spike/conversation-chain.mjs` runs the check against two real transcripts on
disk — 189 and 96 turns, no model calls: a genuine resume extends the chain (grew 93), a different conversation is
rejected on `prefix hash mismatch`, a pruned thread on `shorter than recorded`, and a tampered mid-conversation turn
on `prefix hash mismatch`. 4/4, with **2 cases discriminated by the hash rather than by length.**

That last number is the one that matters, and it exists because the spike first passed for the wrong reason (P7):
the fresh-restart case was initially rejected as *shorter than recorded*, so the hash comparison never ran at all.
Green and vacuous. The suite now requires each case to be rejected for its **named reason** and exits non-zero if no
case exercised the hash. **An oracle that cannot say why it rejected cannot be shown to work** — which is the
standard §6.1 holds OpenRig's resume probe to, so it applies here first.

**Four constraints, all load-bearing (P4):**

1. **Detection is complete; restoration is partial.** Replay rebuilds an *equivalent* context. It does not re-enter
   server-side state — prompt cache (a rate-limit and latency cost, not a correctness one) and any thinking content
   not persisted locally. A rebuild stays labelled a rebuild.
2. **Hash a normalized projection, not raw bytes.** These are vendor-internal files with no stability contract.
   Canonical `(role, content, tool_calls)` survives cosmetic format churn while still catching content change;
   raw-byte hashing would invalidate every stored hash on a reformat.
3. **Chain per turn.** A conversation grows, so equality is the wrong relation and prefix/extension is the right
   one. A per-turn hash chained to its predecessor gives that for free, and `effectiveHash` already works this way
   (D2).
4. **Size.** A single live transcript here is ~2.1 MB and there are 1170 on disk. Store the normalized per-turn
   projection content-addressed; store full raw only at explicit checkpoints.

**Open data-handling decision (P5).** This means Pantheon holds a durable, hash-indexed copy of every conversation.
Proposed constraints: inside `$PANTHEON_HOME` only, never committed, never leaving the machine. Not settled
unilaterally — it is the user's call.

### 6.3 The exposure this reduces but does not remove

OpenRig's snapshots persist database rows only — never tmux scrollback, and never the model conversation, which
lives in the vendor's own store behind a token pointer (O5). If the vendor prunes or rotates that thread, the token
is dead and no snapshot recovers the history.

§6.2 reduces this materially rather than eliminating it. What remains: **a resume handle is still the vendor's to
revoke.** Pantheon can prove what the conversation was and rebuild an equivalent one, but it cannot compel a vendor
to re-enter a thread that vendor has discarded. So a dead pointer degrades to a labelled high-fidelity rebuild
instead of silent amnesia — which is a floor, not a fix, and the spec calls it that.

The residual risk is concentrated in the two seats whose local stores are unconfirmed (`grok`, `agy`). For those,
continuity claims must stay weaker until their stores are verified, per the declared-capability rule (§4).

### 6.4 Supporting components, none modified

Three existing components carry the rest:

| Need | Component | Why it already fits |
|---|---|---|
| **ContextBundles**, topology specs, seat snapshots | `proposal-ledger.mjs` artifact store (D3) | `writeProposalArtifact` canonicalizes arbitrary JSON to `sha256_<hex>.json`, throws on collision; read rehashes and returns `null` on mismatch |
| Append-only event log | `proposal-ledger` Ed25519 hash-chained log (D3) | already generic, not node-shaped |
| Conversation-chain hashes; context lineage; work DAG + scheduling | `merkle.mjs` + `orchestrate.mjs` (D2, D5) | `effectiveHash` chains bundles and work nodes alike; `runBuild` enforces write disjointness |
| Task fencing, leases, idempotency | the Python board core (C3, C4) | correct optimistic concurrency; rebuilding it would be strictly worse |

Discarded rather than extended: the six dead `.mjs` board modules, whose `postResult` fenced on session *name*
only (C1, C6).

**Split rule.** Content-addressed storage is for context and for anything else that keys a decision.
High-frequency liveness telemetry — a seat token-headroom sample taken every few seconds — keys nothing and must not
mint an immutable object per sample; it goes to cheap mutable scratch. The boundary does not bend in one direction:
a ContextBundle is never scratch, because the entire point is that it can be produced again later and rehashed.

## 7. Scheduling

`runBuild`'s guard, verbatim (D5):

> Write-disjoint batch (corruption guard): never run two workers that write the same file concurrently. Overlapping
> ready nodes are deferred to a later round (serial).

This is `swarm-write-dispositions`' HOLD/JOIN discipline made **mechanical instead of advisory**, and no other
multi-agent harness surveyed enforces it — they instruct agents to be careful. Write sets are **declared**
(`node.files`), never inferred, which is the honest contract: the planner says what it will touch.

**Second constraint, from OAuth (L3): the parallelism budget is per-vendor, and the pools are independent.**
Each vendor is its own paid subscription with its own rate limit (L1a), so no two vendors contend. Fan-out *across*
vendors is therefore genuinely parallel — four vendors are four uncontended pools. Fan-out *within* one vendor
serializes on that vendor limit. The scheduler admits a batch only if it is write-disjoint **and** within
per-vendor headroom, and it prefers spreading a ready frontier across vendors over stacking it on one. Every cap
that drops coverage is logged — silent truncation reads as "covered everything."

This is also the real argument for breadth, and it is economic rather than aesthetic: **an additional vendor is an
additional uncontended throughput pool.** That is what the two requested extra seats buy (§13.3), and it is why an
API-metered seat is a poor substitute for one carrying its own subscription.

## 8. Trust anchor

**Blocker inherited from merkle-dag, and Pantheon must not inherit it (D6).** Signature verification reads
`stored.authorized_signers[entry.key_id]` where `stored` *is the plan* (`ledger-gate.mjs:47`). A keyring facility
exists but `test-harness.mjs:68` states it "is no longer the trust path." Tampering is caught, because the signer
set is hashed into `plan_hash` — but *who may legitimately be listed* is unanchored, so a validly-authored plan can
name its own signers and pass. The trust root travels inside the artifact it authorizes.

Pantheon requirement: **the signer set is read from a keyring established at install and never authored by
Pantheon.** Otherwise settlement proves only that whoever wrote the plan agreed with themselves — the same failure
as a seat self-reporting success.

Reported to the user; **not fixed in TELOS by this spec.** That is a different project with its own acceptance
authority, and a drive-by change to a signing path belongs in its gate.

## 9. Install: zero uninvited mutation

The comparison baseline is OpenRig, which writes `~/.claude.json`, workspace `.claude/settings.local.json` and
`.mcp.json`, `~/.codex/config.toml`, `~/.tmux.conf`, seeds a skill into `~/.claude/skills`, pre-writes Codex trust
hashes, sets `permissions.defaultMode` to `acceptEdits`, and states this is "not a complete preservation or rollback
guarantee."

Pantheon writes **only** under `$PANTHEON_HOME`, plus files the user names in config. It handles **no credential at
all** on the primary lane — it inherits each CLI's OAuth state (L5). It sets no permission default and pre-trusts
nothing.

**Acceptance check, executable:** install and run a full rig under an isolated `HOME` with a filesystem audit
(mtime + content hash) over `$HOME` and the workspace taken before and after; any delta outside `$PANTHEON_HOME` and
the named files fails the test. This must run from a foreign cwd — a suite green in its own directory can be testing
the environment, which is exactly the bug found in `test-meta-driver.mjs` (H1).

## 10. Effectiveness: the eval is part of the product

The known-open item this workspace has carried without resolving: **no evidence a team beats one strong session**,
paired blind eval designed and never run (E4).

- **Denomination: rate-limit consumption and wall-clock, not per-token dollars.** Nothing on the primary lane is
  billed per token, so `cost_usd` is meaningless across the roster (L2) and a per-token dollar figure would be
  notional. The cost that *is* real is fixed and per-vendor: **one subscription per month, per seat-vendor.** So
  the decision the eval must inform is crisp — *is the Nth subscription worth its monthly fee?* — rather than an
  unfalsifiable question about whether the swarm was worth it.
- **Paired and blind:** same task, same fixture, team vs. one strong session; grader sees neither arm's identity.
- **The producer never grades.** A verifier runs a repro, holds a runnable oracle, or applies a distinct lens, and
  defaults to REFUTED when it cannot reproduce.
- **It must be able to return "the team lost."** An eval that cannot embarrass its own system measures nothing. The
  per-vendor ceiling (L3) is a specific way the team can lose and the design must detect it.

## 11. Live view (React)

A React surface over the supervisor's event stream, not a terminal scraper. It reads the same append-only event log
that settlement reads, so the UI and the ledger cannot disagree. Shows: the topology, each seat's class and declared
vs. observed capabilities, live turn deltas, the write-set map with current holds, per-vendor rate-limit headroom,
and the settlement record for each completed node. tmux/`claude attach` remain available for dropping into a raw
session; they are a view, never the authority.

## 12. Failure taxonomy

Named because the current stack conflates two of them and that conflation gets worse under OAuth (B9, F3, L4):

| Failure | Signal | Right action |
|---|---|---|
| Quota exhausted | vendor says so | wait / route to another vendor |
| Hung process / wedged but alive | process alive, **no stream deltas** inside the window | investigate; do **not** report as quota |
| Permission prompt | no output, timer expires | the opt-in bypass, scoped |
| Stale claim | fencing mismatch | supervisor bug — the seat never holds tokens (§3.1) |
| Settlement mismatch | disk hash ≠ signed hash | fail closed, keep the evidence |

Rows 2 and 3 share a signal, so they are distinguished by whether the vendor emitted *any* stream event before the
timeout — which is only possible on a streaming lane. A non-streaming seat cannot tell them apart, and the spec
says so rather than guessing.

**Wedged-but-alive is the row no surveyed harness can fill.** OpenRig has no computing-vs-looping discriminator: a
spinner or repeating redraw registers as `running`, indistinguishable from progress, and its nearest proxy works at
the task-obligation layer instead — a 300s sweep flagging work nobody claimed within 60 minutes (N5). Pantheon can
fill it structurally, because delta absence on a live process is a first-class signal rather than an inference from
rendered text.

**Rule adopted from OpenRig, stated explicitly: silence is not idleness.** Its `MOTION` signal may only *upgrade*
`idle`/`unknown` to `running` and may never manufacture `idle` from quiet, because a seat can think for a long time
without printing (N3). Pantheon keeps that asymmetry. An idle verdict requires positive evidence — a completed turn
event — never the absence of output.

## 13. Open questions

1. **Can an agy dispatch with no `--add-dir` write outside its workspace?** (F4) Unresolved — the probe was refused
   by `route-cli`'s need allowlist and was **not faked**. Top Google-seat question, since `--mode plan` is proven
   not to be read-only (F1) and gemini-cli is legacy so switching binaries is not the fix (J1, J2).
2. **Does codex accept turn-per-line stdin?** (K3) Decides whether it is a live or warm seat.
3. **Which two additional seats?** A machine change and a recurring subscription each, so the user decides. Ranked
   by what §7 says they actually buy — an uncontended pool:
   (a) **a new agentic CLI carrying its own OAuth subscription** — best: a fresh pool *and* native resume;
   (b) **API-only vendors via the SDK lane** — weakest: metered rather than subscription, and
       warm-resume-incapable, so it must be labelled as such in the capability table;
   (c) **agy non-Google models** — rejected: same binary, same pool, zero new throughput, and the adapter own
       header warns it collapses vendor independence against the claude seat.
   Written as parameterized slots so filling them is a data change, not a redesign.
4. **Are both OpenRig spec validators runtime-reachable?** (A2) Only matters if we borrow from its schema.

## 14. The missing piece, and what is already solved

Pantheon is not a reimplementation of OpenRig and does not compete with what OpenRig did well. OpenRig solved
**terminal orchestration**: how to boot a team of agent sessions, hold them somewhere durable, and give an operator
one place to look. It made that work under real constraints — the `load-buffer`/`paste-buffer` delivery path and the
temp-script wrapper for the pane input-length ceiling (A4) are the marks of someone who hit the hard edges and
handled them.

The piece nobody has built is the one underneath: **verified persistence and settlement.** No harness surveyed can
answer "did this seat actually do what it reported" from anything but the seat own report, and none enforces write
disjointness between concurrent agents — they instruct agents to be careful (D5, §7). That gap is what Pantheon is
for. It adds a missing layer to the field rather than replacing a member of it.

Where practice has already converged, Pantheon converges with it instead of inventing a worse variant.
`rejectUnknownTopologyKeys` (A1) hard-rejects unknown keys at all four nesting levels, and a spec that fails closed
on an unrecognized field is the principle this workspace reached independently in
`classify-by-structure-not-allowlist`: every recognized input gets exactly one bucket, and unbucketed means the
gate fails itself. That is convergent engineering. OpenRig is Apache-2.0, and where an implementation detail is
genuinely carried across, it carries attribution in the source file that carries it.


---

## DECISION REVERSAL — SDK transport (user, 2026-09-27)

"I'd rather go sdk." This supersedes the CLI-transport decision in section C. That decision was
never blocked by auth: my claim that the SDKs are API-key-only was wrong and is retracted in
evidence T1.

### What this deletes

Most of the hard part. `src/context/locate.mjs` and the per-vendor projectors exist for exactly
one reason: with CLI transport the conversation lives in a file the VENDOR owns, in a format the
vendor may change, in a directory we have to go find. That is where every Critical in this
project came from — C1 mtime selection, C2 date-nesting, C3 the lossy sanitizer, and today's two
silent zero-turn projectors.

With SDK transport we hold the conversation. The chain hashes what we sent and what came back, at
the moment it happens. No store location, no percent-encoded buckets, no SQLite, no format
archaeology, no resolution-by-identity — because identity is no longer something to recover.

Keep locate + the projectors, but demote them: they become the ADOPTION path only, for binding a
seat to a conversation a human already started in a CLI. That is a real feature and the work
stands; it is no longer load-bearing for a normal turn.

### What replaces resume

Vendor-side continuity instead of a resume flag:
- OpenAI / xAI: Responses API, `previous_response_id`, responses stored by default.
- Antigravity: the SDK's `Agent` manages session lifecycle behind an async context manager.
- Anthropic: caller-held message history.

The conversation hash chain stays, and gets STRONGER: it now covers material we hold rather than
material we re-read from a vendor file, so a resume is proven against what we actually sent.

### What must be re-verified before this is safe to build on

1. Streaming shape per SDK for the live view (all four stream; the event vocabularies differ).
2. Whether the zero-runtime-dependency policy survives. It does not, as literally stated: an SDK
   is a dependency. That policy needs an explicit amendment rather than quiet erosion.

Nothing gates the build.

### Billing — NOT an open question, and not mine to raise

An earlier revision of this section made "does the public API host accept the subscription OAuth
token" the gating item, on the theory that SDK seats might open a second metered bill. The user
struck it: their seats bill their subscriptions, which they can see and this project cannot.

The reasoning behind that gate was also wrong in its specifics. I described the Vertex/ADC path,
where OAuth bills a GCP project, and presented it as though it were the user's configuration
without establishing that it was. It is one available path, not theirs.

Recorded here because it is the second time in one session that I turned an unchecked assumption
about auth and billing into a stated constraint on the design (see evidence T1 for the first).
Both times the constraint was invented and the user had to remove it. The operative rule for this
project: the account holder observes billing directly; the design does not infer it, and does not
make an inferred bill a blocker.
