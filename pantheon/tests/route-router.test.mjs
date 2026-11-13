import { test } from "node:test";
import assert from "node:assert/strict";
import { route, routeReview, modelFor, familyChange, SEAT_FACTS, KNOWN_NEEDS, UNMEASURED } from "../src/route/router.mjs";

test("an unknown need is REFUSED, not silently ignored", () => {
  const r = route({ needs: ["best_at_code"] });
  assert.equal(r.ok, false);
  assert.match(r.why, /unknown need/);
  assert.match(r.why, /has not measured/, "the refusal must say why the need is unsupported");
  assert.deepEqual(r.unknown, ["best_at_code"]);
});

// The rule this router exists to enforce honestly: it must not claim a quality ranking.
test("quality is explicitly listed as unmeasured and is not routable", () => {
  assert.ok(UNMEASURED.some(u => /better code/i.test(u)));
  for (const need of ["best_model", "smartest", "fastest_quality"]) {
    assert.equal(route({ needs: [need] }).ok, false, `${need} must not be routable`);
  }
  assert.equal([...KNOWN_NEEDS].some(n => /best|smart|quality/i.test(n)), false,
    "no known need may encode a quality judgement");
});

test("server continuity filters to the seats that actually have it", () => {
  const r = route({ needs: ["server_continuity"], count: 2 });
  assert.equal(r.ok, true);
  for (const s of r.picked) assert.equal(SEAT_FACTS[s].continuity, "server");
  const dropped = r.considered.filter(c => !c.kept).map(c => c.seat);
  assert.ok(dropped.includes("agy_google") && dropped.includes("anthropic"),
    "replay seats must be dropped and named");
  for (const c of r.considered.filter(x => !x.kept)) assert.match(c.reason, /lacks/);
});

// The one preference with evidence: independent subscriptions mean cross-vendor fan-out does not
// contend, so two picks must not come from one pool while another pool is free.
test("picks spread across quota pools before reusing one", () => {
  const r = route({ count: 3 });
  assert.equal(r.ok, true);
  const pools = r.picked.map(s => SEAT_FACTS[s].quota_pool);
  assert.equal(new Set(pools).size, 3, "three picks must come from three different pools");
  assert.equal(r.contention, null);
});

// Contention cannot occur with the real table (four seats, four pools), so it is exercised with
// injected facts. Writing this test is what surfaced the duplicate-seat bug: naming "openai"
// twice inflated the eligible count while the pick loop skipped the repeat, so route returned
// ONE seat and still reported ok:true.
test("contention is REPORTED when two distinct seats share a pool, never hidden", () => {
  const facts = {
    a: { vendor: "v", continuity: "server", quota_pool: "shared", models: { default: "m-a" } },
    b: { vendor: "v", continuity: "server", quota_pool: "shared", models: { default: "m-b" } },
  };
  const r = route({ count: 2, facts });
  assert.equal(r.ok, true);
  assert.deepEqual(r.picked, ["a", "b"]);
  assert.match(r.contention, /share a quota pool/);
});

test("a duplicated seat name never inflates the count into a short pick", () => {
  const r = route({ count: 2, seats: ["openai", "openai"] });
  assert.equal(r.ok, false, "one seat listed twice is one seat, not two");
  assert.match(r.why, /only 1 eligible|only 1 of 2/);
});

test("independent_quota excludes a seat sharing a pool with an avoided seat", () => {
  const r = route({ needs: ["independent_quota"], avoid: ["openai"], count: 1 });
  assert.equal(r.ok, true);
  assert.notEqual(SEAT_FACTS[r.picked[0]].quota_pool, "openai");
  const oa = r.considered.find(c => c.seat === "openai");
  assert.equal(oa.kept, false);
  assert.match(oa.reason, /contend/);
});

test("asking for more seats than are eligible fails loudly with the reasons", () => {
  const r = route({ needs: ["strongest_model"], count: 9 });
  assert.equal(r.ok, false);
  assert.match(r.why, /only \d+ eligible/);
  assert.ok(Array.isArray(r.considered), "the caller must be able to see why each seat was dropped");
});

test("every route states its basis so pool-spreading is not read as a capability claim", () => {
  const r = route({ count: 2 });
  assert.match(r.basis, /NOT on model quality/);
});

test("model tiers resolve, and fall back rather than inventing an id", () => {
  assert.equal(modelFor("anthropic", ["strongest_model"]), "claude-opus-5");
  assert.equal(modelFor("anthropic", ["strong_model"]), "claude-sonnet-5");
  // Raised from haiku on 2026-09-28; see SEAT_FACTS.anthropic.models for why.
  assert.equal(modelFor("anthropic"), "claude-sonnet-5");
  // google declares no strong tier: must fall back to its default, not fabricate one.
  assert.equal(modelFor("agy_google", ["strongest_model"]), SEAT_FACTS.agy_google.models.default);
});

// Evidence §U: cross-vendor review found two real defects that same-author tests missed.
test("review routing never assigns a reviewer from the producer's own vendor", () => {
  const pairs = routeReview(Object.keys(SEAT_FACTS));
  assert.equal(pairs.length, 4);
  for (const p of pairs) {
    assert.ok(p.reviewer, `no reviewer found for ${p.producer}: ${p.why}`);
    assert.notEqual(SEAT_FACTS[p.reviewer].vendor, SEAT_FACTS[p.producer].vendor,
      `${p.reviewer} shares a vendor with ${p.producer}`);
  }
});

test("review routing reports honestly when no cross-vendor reviewer exists", () => {
  const pairs = routeReview(["openai"], ["openai"]);
  assert.equal(pairs[0].reviewer, null);
  assert.match(pairs[0].why, /only 0 eligible|unknown/);
});

test("a seat with no recorded facts is dropped by name", () => {
  const r = route({ count: 1, seats: ["nope"] });
  assert.equal(r.ok, false);
  assert.match(r.considered.find(c => c.seat === "nope").reason, /no facts recorded/);
});

// Documented constraint: "Persisted reasoning can be reused only within the same model family...
// When you switch model families, the API omits incompatible reasoning."
test("re-routing a live seat within a family is safe; across families is not", () => {
  assert.equal(familyChange("gpt-6-luna", "gpt-6-sol").safe, true);
  assert.match(familyChange("gpt-6-luna", "gpt-6-sol").why, /same family/);
  const cross = familyChange("claude-haiku-4-5-20251001", "claude-opus-5");
  assert.equal(cross.safe, false, "haiku-4-5 and opus-5 are different families");
  assert.match(cross.why, /omits incompatible reasoning/);
  assert.equal(familyChange("gpt-6-sol", "gpt-6-sol").safe, true, "no change is always safe");
});

test("an unknown model family is treated as unsafe rather than assumed compatible", () => {
  const r = familyChange("gpt-6-sol", "some-future-model");
  assert.equal(r.safe, false);
  assert.equal(r.unknown, true);
  assert.match(r.why, /treat a switch as unsafe/);
});

// Found by an independent code-quality review (precision-coder): MODEL_FAMILY's xai entry kept the
// pre-fix spelling ("grok-4.20-multi-agent") six lines below where 8bee920 fixed the same model's
// SEAT_FACTS.xai.models.strong to the documented id ("grok-4.20-multi-agent-0309") -- so every real
// reseat onto xai's strong model was reported as an unknown-family switch, wrongly.
test("xai's strong model resolves to a known family, using SEAT_FACTS' own model id", () => {
  const r = familyChange(SEAT_FACTS.xai.models.default, SEAT_FACTS.xai.models.strong);
  assert.ok(!r.unknown, `${SEAT_FACTS.xai.models.strong} must be a recorded family, not unknown`);
  assert.equal(r.safe, true, "grok-4.6 and grok-4.20-multi-agent-0309 are both grok-4");
});
