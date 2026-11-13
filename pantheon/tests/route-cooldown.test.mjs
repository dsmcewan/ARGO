import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shutPools, recordRefusal, recordSuccess, coolOffS, COOLDOWN_BASE_S, COOLDOWN_CAP_S }
  from "../src/route/cooldown.mjs";

// WHAT THIS IS FOR. run-item.mjs builds `deadPools = new Set()` INSIDE each role turn, so the
// knowledge that a pool is shut dies at the end of that turn: the scouts cannot tell the planner,
// and the next run starts blind. On 2026-09-28 that cost the same ten minutes twice in a row --
// LEXI's drafting leg spent 588s discovering the anthropic hose was shut, handed the ticket to
// pantheon, and pantheon's planner then rediscovered the identical fact by spending its own calls.
// A refusal is evidence. This file is where that evidence is allowed to survive the turn.

const here = () => mkdtempSync(join(tmpdir(), "cooldown-"));

test("a refusal with no retry-after shuts the pool for a bounded, escalating interval", () => {
  const dir = here();
  // A subscription-side 429 carries no retry-after and no ratelimit headers: there is no interval
  // to wait for, so one has to be chosen. Escalating, because a pool that refuses twice running is
  // not going to be ready on the same schedule as one that refused once.
  const first = recordRefusal("anthropic", { dir, now: 1000 });
  assert.equal(first.streak, 1);
  assert.equal(first.until, 1000 + COOLDOWN_BASE_S);

  const second = recordRefusal("anthropic", { dir, now: 2000 });
  assert.equal(second.streak, 2);
  assert.equal(second.until - 2000, COOLDOWN_BASE_S * 2);
});

test("the interval is capped, so a bad hour cannot wedge a vendor for a day", () => {
  const dir = here();
  let rec;
  for (let i = 0; i < 20; i++) rec = recordRefusal("anthropic", { dir, now: 0 });
  assert.equal(rec.until, COOLDOWN_CAP_S, "a long streak still tops out at the cap");
  assert.ok(COOLDOWN_CAP_S <= 3600, "an hour is already a long time to refuse to look");
});

test("a retry-after is obeyed exactly rather than guessed past", () => {
  const dir = here();
  // When the vendor DOES say when to come back, inventing a longer interval throws away the one
  // piece of real information in the refusal.
  const rec = recordRefusal("openai", { dir, now: 500, retryAfterS: 7 });
  assert.equal(rec.until, 507);
  assert.equal(coolOffS({ streak: 1, retryAfterS: 7 }), 7);
});

test("shutPools reports what is shut NOW, and an expired record is a probe, not a wall", () => {
  const dir = here();
  recordRefusal("anthropic", { dir, now: 1000 });
  assert.deepEqual([...shutPools({ dir, now: 1000 })], ["anthropic"]);
  assert.deepEqual([...shutPools({ dir, now: 1000 + COOLDOWN_BASE_S - 1 })], ["anthropic"]);
  // The moment it expires the pool is offered again. That single call is the probe: if the pool
  // recovered we find out immediately, and if it did not the streak escalates. Never a hard wall.
  assert.deepEqual([...shutPools({ dir, now: 1000 + COOLDOWN_BASE_S })], []);
});

test("a success clears the record, so one good call ends the cooldown and the streak", () => {
  const dir = here();
  recordRefusal("anthropic", { dir, now: 0 });
  recordRefusal("anthropic", { dir, now: 0 });
  recordSuccess("anthropic", { dir });
  assert.deepEqual([...shutPools({ dir, now: 1 })], []);
  // And the streak is gone: the NEXT refusal starts at the base interval rather than resuming an
  // escalation from an hour ago, which would punish a pool for history it has already disproved.
  assert.equal(recordRefusal("anthropic", { dir, now: 0 }).streak, 1);
});

test("a stale record is ignored even if its `until` is far in the future", () => {
  const dir = here();
  recordRefusal("anthropic", { dir, now: 0 });
  // Guards the clock jump and the forgotten file: a record nobody has touched in hours is not
  // evidence about now. Without this, one bad write could hide a vendor indefinitely.
  assert.deepEqual([...shutPools({ dir, now: 10, maxAgeS: 3600 })], ["anthropic"]);
  assert.deepEqual([...shutPools({ dir, now: 999999, maxAgeS: 3600 })], []);
});

test("a corrupt or unreadable store FAILS OPEN, because a broken cache must not stop the pipeline", () => {
  const dir = here();
  writeFileSync(join(dir, "model-cooldowns.json"), "{ this is not json");
  assert.deepEqual([...shutPools({ dir, now: 0 })], [],
    "an unparseable store means we know nothing, which means nothing is shut");
  // And it must still be repairable in place rather than staying broken forever.
  const rec = recordRefusal("anthropic", { dir, now: 0 });
  assert.equal(rec.streak, 1);
  assert.deepEqual([...shutPools({ dir, now: 0 })], ["anthropic"]);
});

test("writing leaves no partial file behind for another process to read", () => {
  const dir = here();
  // Two processes share this file -- pantheon writes it, LEXI reads it -- so a reader must never
  // catch a half-written store. Write-temp-then-rename is what makes the swap atomic.
  recordRefusal("anthropic", { dir, now: 0 });
  const leftovers = readdirSync(dir).filter(f => f !== "model-cooldowns.json");
  assert.deepEqual(leftovers, [], `temp files left behind: ${leftovers.join(", ")}`);
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, "model-cooldowns.json"), "utf8")));
});

test("pools are independent: one lab refusing says nothing about another", () => {
  const dir = here();
  recordRefusal("anthropic", { dir, now: 0 });
  assert.deepEqual([...shutPools({ dir, now: 1 })], ["anthropic"],
    "openai must not be tarred with anthropic's refusal -- that is the entire point of a fallback");
});
