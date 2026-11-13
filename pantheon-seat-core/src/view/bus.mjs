// In-process event bus for the live view.
//
// Two consumers with different needs, and conflating them is the usual bug: a browser that
// connects mid-turn must see what already happened, while a browser connected throughout must
// not see it twice. So every event gets a monotonic sequence number, late subscribers are
// replayed from the buffer, and the SAME numbering continues live — the client dedupes on `seq`
// and the two paths cannot double-render.
//
// The buffer is bounded. An unbounded one turns a long-running harness into a memory leak that
// only shows up after hours, and dropping the oldest events silently would make the replay a
// lie, so a subscriber that missed the window is TOLD it missed.

const DEFAULT_CAP = 2000;

export function createBus({ cap = DEFAULT_CAP } = {}) {
  const buffer = [];
  const subscribers = new Set();
  let seq = 0;
  let dropped = 0;

  const publish = event => {
    const e = { ...event, seq: ++seq };
    buffer.push(e);
    while (buffer.length > cap) { buffer.shift(); dropped++; }
    for (const fn of subscribers) {
      // One broken subscriber must not stop delivery to the others, and must not be silent
      // about it either: it is removed and the reason is attached to the bus for reporting.
      try { fn(e); } catch (err) { subscribers.delete(fn); lastError = String(err?.message ?? err); }
    }
    return e;
  };

  let lastError = null;

  const subscribe = (fn, { from = 0 } = {}) => {
    // Replay first, then go live. Anything the buffer has already evicted is reported rather
    // than quietly skipped, so a view can say "history truncated" instead of showing a gap it
    // cannot see.
    const earliest = buffer.length ? buffer[0].seq : seq + 1;
    if (from + 1 < earliest) {
      fn({ type: "gap", seq: 0, at: Date.now(), seat: null,
           text: `history truncated: ${earliest - from - 1} earlier event(s) dropped`,
           dropped: earliest - from - 1 });
    }
    for (const e of buffer) if (e.seq > from) fn(e);
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };

  return {
    publish,
    subscribe,
    stats: () => ({ seq, buffered: buffer.length, dropped, subscribers: subscribers.size, lastError }),
    snapshot: () => [...buffer],
  };
}

// Fold an event stream into per-seat state a view can render directly. Kept here rather than in
// the browser so the same reduction is testable in node, and so the server can answer "what is
// each seat doing right now" without replaying everything client-side.
export function reduceSeats(events, into = {}) {
  const seats = { ...into };
  for (const e of events) {
    if (!e.seat) continue;
    const s = seats[e.seat] ?? (seats[e.seat] = {
      seat: e.seat, status: "idle", text: "", tools: [], turns: 0, startedAt: null, lastAt: null, error: null,
    });
    s.lastAt = e.at;
    switch (e.type) {
      case "start":
        // A new turn replaces the previous turn's text rather than appending to it. Appending
        // is the obvious-looking choice and makes turn 2 render as a continuation of turn 1.
        s.status = "running"; s.text = ""; s.tools = []; s.startedAt = e.at; s.error = null; s.turns++;
        break;
      case "delta": s.text += e.text ?? ""; break;
      case "tool": if (e.name && !s.tools.includes(e.name)) s.tools.push(e.name); break;
      case "done": s.status = "done"; if (typeof e.text === "string" && e.text.length > s.text.length) s.text = e.text; break;
      case "error": s.status = "error"; s.error = e.text ?? "error"; break;
    }
  }
  return seats;
}
