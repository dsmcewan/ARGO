# Scoped authored-knowledge runtime review

Reviewed immutable integration: `ba72fe06fef3ebf5a4c14c942a5a1c35d4f116c9` at `/workspace/ARGO/.worktrees/successor-review-runtime`. The first review ran at `648f9fae620f9692364e949fea8c0abe420fd22c`; all 19 knowledge implementation/content/client-boundary files compared byte-for-byte unchanged in the integrated candidate. Public entry points and requests were exercised again at the integrated commit. Both candidate checkouts remained clean.

**No blocking defect found in this scoped runtime review.** Fifteen independent portable probes passed at each immutable candidate. This is advisory native-peer review of authored knowledge, not a full release gate, a review of the other runtime lanes, cross-vendor certification, or approval to change Board/trust policy.

## What was verified

- The public `@argo/tempted-fates` helpers, `@argo/contracts` guards and `@argo/interventions` model agent are wired together. The helper compares the caller's pack with fixed bundled catalog/manifest/pack identities; caller-supplied catalog/pin fields and changed packs are refused.
- Melia's actual injected provider request contains the exact zero fee/deposit, five-obol replacement/repair cap, borrower-supplied one-obol oil lasting six exploration turns, explicit return agreement, and absence of compulsory service/oath. These are labelled `offer_policy` and `authored_actor_policy`, not accepted debt, custody transfer or fabricated ledger events.
- Source document bytes and inclusive excerpt locators verify against the pinned manifest. Changed source bytes fail. Output contains only selected source metadata and actor-owned policy; no whole campaign pack, private knowledge arrays, sample speeches, referee notes or variant truth appeared in the captured request.
- Activation is detached/frozen and prepared at the exact supplied current query. Registration rejects backdating. Reads reject another actor/world/branch, mismatched grant cursor/head, forged catalog/manifest/activation hashes, and acquisition after the queried sequence or time. Missing/empty binding yields no knowledge. Another NPC's actual request receives no Melia terms merely because it uses the same campaign.
- Getters, proxies, revoked proxies, sparse/oversized selections, cycles and over-budget text are refused without invoking caller traps.
- Legacy supplement 0.1 retains its exact original field set and packet version; adding `actor_knowledge` to it fails. The 0.2 request carries the new selected policy and uses a distinct version-bound cache identity. The final model instruction explicitly calls authored knowledge the actor's offer policy, not a completed bargain or shared world truth.
- Revocation during token counting prevents generation. Revocation or changed activation/content bindings during generation suppress the returned command. Future acquisition and expired/not-yet-valid policy fail before the provider call.
- Projection and request assembly did not mutate fixture pack/query/view/binding state or write authoritative history. The model path returns an untrusted speech proposal; this review used no authority writer and no paid provider.

## Trust and quality limits

The source/shape guards are not authentication. A shape-valid forged view can pass the generic view validator, while the exact pinned projection guard rejects its changed term; the probe verifies this distinction explicitly. The host must authenticate the query/grant issuer, persist activation, and verify ancestor membership for an older acquisition cursor. The JSON `basis` string and self-reported hashes cannot prove those duties. This extra activation/grant state is not reconstructed from the old ledger alone.

Captured requests establish which facts are delivered, not whether a live model will state every term faithfully, resist all instructions in quoted speech, produce satisfying dialogue or respond quickly. Providers were replaced with injected responses; no live quality/latency claim is made. Deployment, world migration, unrelated v1 repairs and the other runtime lanes were outside this review.

## Evidence and reproduction

Run `node runtime-probes.mjs <clean-checkout> <immutable-sha> <output-dir>` after installing the locked dependencies. The probe imports public package entry points and checks their resolved paths stay inside the candidate.

- [Final fifteen-check result](candidate-ba72fe0/result.json)
- [Actual knowledge provider request](candidate-ba72fe0/knowledge-request.json)
- [Legacy provider request](candidate-ba72fe0/legacy-request.json)
- [Reviewed/integrated source identity comparison](source-equality.json)
- [Portable probe](runtime-probes.mjs)
- [Artifact and source hashes](verification.json)

The initial probe result under `candidate-648f9fa/` preserves one review-fixture failure: the probe attempted to alter a correctly frozen activation. `runtime-probes.initial.mjs` retains that version. The fixture was corrected by cloning before mutation; both final runs passed. Earlier harness setup also needed asynchronous Git execution in the outer sandbox and the model-client's exported request subpath for CommonJS resolution. Neither change modified candidate code or weakened a candidate assertion.
