import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSlots, ticketContainmentRefusal } from "../src/board/ticket-safety.mjs";

const base = {
  key: "multi", repo_root: "/home/colchis/Projects/fixture", title: "t", goal: "the whole change",
  copy: [], acceptance_cmd: "true", question: "q",
};

test("a singular slot/path ticket normalizes to one slot -- every existing ticket keeps working", () => {
  const slots = normalizeSlots({ ...base, slot: "out.txt", path: "src/out.txt" });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].slot, "out.txt");
  assert.equal(slots[0].path, "src/out.txt");
  assert.equal(slots[0].goal, "the whole change", "a single-slot ticket's goal is the ticket's goal");
});

test("path defaults to slot when only slot is given, as it always did", () => {
  const slots = normalizeSlots({ ...base, slot: "out.txt" });
  assert.equal(slots[0].path, "out.txt");
});

test("a slots[] ticket yields one entry per file, each with its own goal", () => {
  const slots = normalizeSlots({
    ...base,
    slots: [
      { slot: "alpha", path: "src/alpha.mjs", goal: "write alpha" },
      { slot: "beta", path: "src/beta.mjs", goal: "write beta" },
      { slot: "gamma", path: "src/gamma.mjs", goal: "write gamma" },
    ],
  });
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map(s => s.slot), ["alpha", "beta", "gamma"]);
  assert.equal(slots[1].goal, "write beta");
});

test("a slot may name its own model, so which openai rung builds it is decided per slot", () => {
  const slots = normalizeSlots({
    ...base,
    slots: [
      { slot: "alpha", path: "a.mjs", model: "gpt-6-astra" },
      { slot: "beta", path: "b.mjs", model: "gpt-6-sol" },
      { slot: "gamma", path: "c.mjs", model: "gpt-6-luna" },
      { slot: "delta", path: "d.mjs" },
    ],
  });
  assert.deepEqual(slots.map(s => s.model), ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", null]);
  assert.equal(slots[3].model, null, "a slot with no model falls back to the role's ladder");
});

test("a slot inherits the ticket's goal when it does not state its own", () => {
  const slots = normalizeSlots({ ...base, slots: [{ slot: "alpha", path: "a.mjs" }] });
  assert.equal(slots[0].goal, "the whole change");
});

test("duplicate slot keys are refused: two implementers on one slot is the corruption case", () => {
  assert.throws(() => normalizeSlots({
    ...base,
    slots: [{ slot: "same", path: "a.mjs" }, { slot: "same", path: "b.mjs" }],
  }), /duplicate/i);
});

test("two slots writing the same PATH are refused even under different slot keys", () => {
  assert.throws(() => normalizeSlots({
    ...base,
    slots: [{ slot: "alpha", path: "same.mjs" }, { slot: "beta", path: "same.mjs" }],
  }), /same path/i);
});

test("a ticket with neither slot nor slots is refused", () => {
  assert.throws(() => normalizeSlots({ ...base }), /slot/i);
});

test("containment checks EVERY slot's path, not just the first", () => {
  const why = ticketContainmentRefusal({
    ...base,
    slots: [{ slot: "ok", path: "fine.mjs" }, { slot: "bad", path: "../../../../etc/passwd" }],
  });
  assert.match(String(why), /escapes repo_root/);
});

test("a slot key that is not an identifier is refused -- it becomes a board key", () => {
  assert.throws(() => normalizeSlots({ ...base, slots: [{ slot: "../escape", path: "a.mjs" }] }),
    /identifier|slot/i);
});
