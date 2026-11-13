import { test } from "node:test";
import assert from "node:assert/strict";
import { overlapFactor, runSwarm } from "../src/swarm/layered.mjs";

// THE DEFECTS, 2026-09-27 re-review, ranks 5 and 14. overlapFactor was fed only the OK seats' durations,
// so a layer where three of four seats failed at once scored efficiency 1.00 for the survivor; and
// max/wall cannot tell seats that ran together from seats that were dispatched together and then served
// one after another. Every seat counts now, and intervals expose serialisation that durations hide.

test("a mostly-failed layer says so instead of reporting perfect concurrency for the survivor", () => {
  const r = overlapFactor({ wallMs: 8000, total: 4, ok: 1,
    intervals: [{ started: 0, ended: 8000 }, { started: 0, ended: 100 }, { started: 0, ended: 100 }, { started: 0, ended: 100 }] });
  assert.equal(r.coverage, 0.25);
  assert.match(r.caveat, /3 of 4 seat\(s\) failed/);
  assert.equal(r.serialMs, 8300, "failed seats' time is counted, not excluded");
});

test("seats served one after another are reported as such, whatever the dispatch looked like", () => {
  const serial = overlapFactor({ wallMs: 6000, total: 3, ok: 3,
    intervals: [{ started: 0, ended: 2000 }, { started: 2000, ended: 4000 }, { started: 4000, ended: 6000 }] });
  assert.equal(serial.unionMs, 6000);
  assert.equal(serial.concurrency, 1, "no two seats ever overlapped");
  assert.match(serial.caveat, /one after another/);

  const parallel = overlapFactor({ wallMs: 2000, total: 3, ok: 3,
    intervals: [{ started: 0, ended: 2000 }, { started: 0, ended: 2000 }, { started: 0, ended: 2000 }] });
  assert.equal(parallel.unionMs, 2000);
  assert.equal(parallel.concurrency, 3);
  assert.equal(parallel.efficiency, 1);
  assert.equal(parallel.caveat, null, "a genuinely parallel, fully covered layer has nothing to caveat");
});

test("the duration-only form still works for callers without intervals", () => {
  const r = overlapFactor({ wallMs: 100, durations: [100, 50] });
  assert.equal(r.idealMs, 100); assert.equal(r.serialMs, 150); assert.equal(r.unionMs, null); assert.equal(r.coverage, 1);
});

test("runSwarm measures every seat's interval, failed ones included, and carries coverage into the layer report", async () => {
  const layers = {};
  await runSwarm({
    question: "Q?", seats: ["a", "b", "c", "d"], allowParticipantJudge: true,
    onLayer: (name, rep) => { layers[name] = rep; },
    runSeat: async (seat) => {
      await new Promise(r => setTimeout(r, seat === "a" ? 60 : 5));
      if (seat !== "a") throw new Error(`${seat} 429`);
      return { ok: true, text: "a-answer", ms: 60 };
    },
  });
  const ex = layers.explore;
  assert.equal(ex.coverage, 0.25);
  assert.match(ex.caveat, /3 of 4/);
  for (const r of ex.results) {
    assert.ok(Number.isFinite(r.started) && Number.isFinite(r.ended) && r.ended >= r.started, `interval for ${r.seat}`);
  }
  assert.ok(ex.serialMs > 0);
});

// In-session probe: inconsistent inputs produced a negative union and ratios above 1.
test("inconsistent timings are clamped and named, not reported as ratios above 1", () => {
  const neg = overlapFactor({ wallMs: 100, intervals: [{ started: 50, ended: 10 }], total: 1, ok: 1 });
  assert.equal(neg.unionMs, 0); assert.equal(neg.serialMs, 0);
  const short = overlapFactor({ wallMs: 50, intervals: [{ started: 0, ended: 100 }], total: 1, ok: 1 });
  assert.equal(short.efficiency, 1); assert.match(short.caveat, /timings disagree/);
  const over = overlapFactor({ wallMs: 100, intervals: [{ started: 0, ended: 100 }], total: 1, ok: 3 });
  assert.equal(over.coverage, 1); assert.match(over.caveat, /exceeds total/);
});

// In-session probe: a layer finishing inside one millisecond was reported as "no measured seats", coverage 0.
test("an instantaneous layer still counts its seats", () => {
  const r = overlapFactor({ wallMs: 0, intervals: [{ started: 5, ended: 5 }, { started: 5, ended: 5 }], total: 2, ok: 1 });
  assert.equal(r.coverage, 0.5);
  assert.match(r.caveat, /1 of 2 seat\(s\) failed/);
  for (const k of ["concurrency", "efficiency", "idealMs", "serialMs", "unionMs"]) assert.ok(Number.isFinite(r[k]), `${k} finite`);
});
