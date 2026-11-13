import { test } from "node:test";
import assert from "node:assert/strict";
import { createBus, reduceSeats } from "../src/view/bus.mjs";

const ev = (seat, type, rest = {}) => ({ seat, type, at: Date.now(), ...rest });

test("a late subscriber is replayed from the buffer and then goes live", () => {
  const bus = createBus();
  bus.publish(ev("openai", "start"));
  bus.publish(ev("openai", "delta", { text: "a" }));
  const seen = [];
  bus.subscribe(e => seen.push(e));
  assert.equal(seen.length, 2, "everything already published must be replayed");
  bus.publish(ev("openai", "delta", { text: "b" }));
  assert.equal(seen.length, 3, "and then live events continue on the same subscription");
});

// The property that makes a browser reconnect safe: resume from the last seq seen, get only
// what came after. Without it, every reconnect re-renders the whole conversation.
test("subscribing from a seq replays only what came after it", () => {
  const bus = createBus();
  for (const t of ["a", "b", "c", "d"]) bus.publish(ev("openai", "delta", { text: t }));
  const seen = [];
  bus.subscribe(e => seen.push(e), { from: 2 });
  assert.deepEqual(seen.map(e => e.text), ["c", "d"]);
});

test("seq is strictly increasing across replay and live delivery", () => {
  const bus = createBus();
  bus.publish(ev("a", "delta", { text: "1" }));
  const seen = [];
  bus.subscribe(e => seen.push(e));
  bus.publish(ev("a", "delta", { text: "2" }));
  const seqs = seen.map(e => e.seq);
  assert.deepEqual(seqs, [1, 2], "the replayed event and the live one share one numbering");
});

// A bounded buffer that drops silently makes the replay a lie: the client sees a continuous
// stream with a hole in it and cannot know.
test("a subscriber that missed evicted history is TOLD, not silently short-changed", () => {
  const bus = createBus({ cap: 3 });
  for (let i = 0; i < 6; i++) bus.publish(ev("a", "delta", { text: String(i) }));
  const seen = [];
  bus.subscribe(e => seen.push(e), { from: 0 });
  assert.equal(seen[0].type, "gap", "the first thing a short-changed subscriber gets is the gap notice");
  assert.equal(seen[0].dropped, 3);
  assert.deepEqual(seen.slice(1).map(e => e.text), ["3", "4", "5"]);
});

test("the buffer is bounded and reports what it dropped", () => {
  const bus = createBus({ cap: 2 });
  for (let i = 0; i < 5; i++) bus.publish(ev("a", "delta", { text: String(i) }));
  const s = bus.stats();
  assert.equal(s.buffered, 2);
  assert.equal(s.dropped, 3);
});

// One broken consumer must not stop the others, and must not fail silently either.
test("a throwing subscriber is dropped and recorded, and delivery continues", () => {
  const bus = createBus();
  const good = [];
  bus.subscribe(() => { throw new Error("render blew up"); });
  bus.subscribe(e => good.push(e));
  bus.publish(ev("a", "delta", { text: "x" }));
  bus.publish(ev("a", "delta", { text: "y" }));
  assert.equal(good.length, 2, "the healthy subscriber keeps receiving");
  assert.match(bus.stats().lastError, /render blew up/, "the failure is recorded, not swallowed");
  assert.equal(bus.stats().subscribers, 1, "the broken subscriber is removed");
});

test("reduceSeats folds a stream into per-seat state", () => {
  const seats = reduceSeats([
    ev("openai", "start"),
    ev("openai", "delta", { text: "he" }),
    ev("openai", "delta", { text: "llo" }),
    ev("openai", "tool", { name: "grep" }),
    ev("openai", "tool", { name: "grep" }),
    ev("openai", "done"),
  ]);
  assert.equal(seats.openai.text, "hello");
  assert.deepEqual(seats.openai.tools, ["grep"], "tool names dedupe");
  assert.equal(seats.openai.status, "done");
  assert.equal(seats.openai.turns, 1);
});

// Appending across turns is the plausible-looking bug: turn 2 renders as a continuation of
// turn 1 and the operator reads one answer as though it were the other.
test("a new turn clears the previous turn's text rather than appending", () => {
  const seats = reduceSeats([
    ev("a", "start"), ev("a", "delta", { text: "first" }), ev("a", "done"),
    ev("a", "start"), ev("a", "delta", { text: "second" }),
  ]);
  assert.equal(seats.a.text, "second");
  assert.equal(seats.a.turns, 2);
  assert.equal(seats.a.status, "running");
});

test("two seats reduce independently", () => {
  const seats = reduceSeats([
    ev("a", "start"), ev("b", "start"),
    ev("a", "delta", { text: "A" }), ev("b", "delta", { text: "B" }),
    ev("a", "error", { text: "boom" }),
  ]);
  assert.equal(seats.a.status, "error");
  assert.equal(seats.a.error, "boom");
  assert.equal(seats.b.status, "running");
  assert.equal(seats.b.text, "B");
});

test("a done event carrying full text wins over accumulated deltas, but never truncates", () => {
  const longer = reduceSeats([ev("a", "start"), ev("a", "delta", { text: "hi" }), ev("a", "done", { text: "hi there" })]);
  assert.equal(longer.a.text, "hi there");
  const shorter = reduceSeats([ev("a", "start"), ev("a", "delta", { text: "hi there" }), ev("a", "done", { text: "hi" })]);
  assert.equal(shorter.a.text, "hi there", "a short terminal text must not discard what streamed");
});
