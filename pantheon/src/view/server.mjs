// Live-view server. Zero runtime dependencies beyond node: builtins — the SDKs are injected by
// the caller, so this module imports no vendor package and stays testable without one.
//
// Binds to 127.0.0.1 only. This process holds four vendors' credentials and can spend money on
// them; a harness that listens on 0.0.0.0 by default hands that to anything on the network, and
// "it was only for local development" is how that ships.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBus, reduceSeats } from "./bus.mjs";
import { originPolicy, json, badId } from "./http-safety.mjs";
import { sdkTurn } from "../sdk/seat-sdk.mjs";
import { ADAPTERS } from "../sdk/adapter.mjs";

const PAGE = fileURLToPath(new URL("./app.html", import.meta.url));

/**
 * `boardRoot` is optional. When it is set, the view also reports where the board is and which
 * BRANCH CLASS each seat is on -- main, wip or iso.
 *
 * That pairing is the one thing worth putting next to a seat card: the short cid says which world
 * the seat is looking at, and the branch class says whether it is shipping, drafting or fighting.
 * A grid of cards without it shows four seats producing text and cannot distinguish the one that is
 * about to move the shipping ref from the one arguing on a fork that will never be merged.
 */
// GET /events is long-lived, so an uncapped subscriber set is an unbounded-memory endpoint on the
// loopback (2026-09-27 re-review, rank 12). Loopback bounds who can hit it, not how many times.
export const MAX_SUBSCRIBERS = 64;

export function createViewServer({ makeClientFor, home, cwd = process.cwd(), boardRoot = process.env.PANTHEON_BOARD ?? null, boardRef = process.env.PANTHEON_BOARD_REF ?? null } = {}) {
  let subscribers = 0;
  if (typeof makeClientFor !== "function") {
    throw new Error("createViewServer: pass makeClientFor(vendor) — this module never imports a vendor SDK");
  }
  const bus = createBus();
  const running = new Set();

  // Run one turn on one seat, streaming its events onto the bus. Returns when the turn is done.
  async function runTurn({ vendor, purpose = "view", prompt, model, label }) {
    const key = `${vendor}/${purpose}`;
    // A second turn on the SAME seat while one is in flight would interleave two conversations
    // into one chain. Refused rather than queued, because silently queuing makes a slow seat
    // look responsive while the operator's second prompt sits invisible.
    if (running.has(key)) return { ok: false, why: `seat ${key} is already running a turn` };
    running.add(key);
    try {
      const client = makeClientFor(vendor);
      const r = await sdkTurn({
        vendor, purpose, cwd, prompt, model, client, home, label,
        onEvent: e => bus.publish(e),
      });
      if (!r.ok) bus.publish({ seat: label ?? vendor, type: "error", at: Date.now(), text: r.why });
      return r;
    } catch (err) {
      // The view must show a failure, not just stop updating. A pane frozen mid-stream is
      // indistinguishable from a slow model.
      bus.publish({ seat: label ?? vendor, type: "error", at: Date.now(), text: String(err?.message ?? err).slice(0, 300) });
      return { ok: false, why: String(err?.message ?? err) };
    } finally {
      running.delete(key);
    }
  }

  // Imported lazily and defensively: the view must work with no board at all, and a board whose
  // files are mid-write must degrade to "unknown" rather than take the page down.
  async function boardSummary() {
    if (!boardRoot) return { board: null };
    // The view READS a board; it must never create one. openBoard() mkdirs its object store, which is
    // right for a CLI and wrong inside a request handler: pointed at a path it cannot create, the
    // handler blocks on the filesystem and the endpoint stops answering. A missing store is reported.
    if (!existsSync(join(boardRoot, "objects"))) {
      return { board: { error: `no board at ${boardRoot} (no objects/ directory)` } };
    }
    try {
      const { openBoard } = await import("../board/index.mjs");
      const { shortCid } = await import("../board/canon.mjs");
      const b = openBoard(boardRoot);
      const refs = b.refs.list();
      const ship = boardRef ?? refs.find(r => r.name.startsWith("refs/board/"))?.name ?? null;
      const head = ship ? b.refs.resolve(ship) : null;
      const cls = name => (name.startsWith("refs/board/") ? "main" : name.startsWith("refs/iso/") ? "iso" : name.startsWith("refs/seat/") ? "wip" : "other");
      const occ = b.runtime.occupancy();
      const seats = {};
      for (const [seat_id, o] of Object.entries(occ)) {
        seats[seat_id] = { status: o.status ?? "idle", mode: o.mode ?? null,
          branch: o.ref ? cls(o.ref) : (o.branch ?? null), ref: o.ref ?? null };
      }
      const { status, why } = await import("../board/controller.mjs").then(async m => {
        if (!head) return { status: "intake", why: "no board ref" };
        const state = m.boardState({ ...b, ref: ship });
        return m.boardStatus({ store: b.store, state });
      });
      return { board: { root: boardRoot, ref: ship, head: head ? shortCid(head) : null, status, why,
        seats, refs: refs.map(r => ({ name: r.name, cls: cls(r.name), short: shortCid(r.cid) })) } };
    } catch (e) {
      return { board: { error: String(e?.message ?? e).slice(0, 200) } };
    }
  }

  // originPolicy / json / badId live in ./http-safety.mjs so the build API enforces the SAME rules
  // from the same source, rather than a second copy of security checks an external review found
  // holes in once already.

  const server = createServer(async (req, res) => {
    // Every failure below is a response, never a crash: a malformed URL, a dropped connection and a
    // thrown handler all used to take the process -- and its four credentials -- down with them.
    req.on("error", () => { /* aborted mid-read; the for-await below rejects and is caught */ });
    try {
      await handle(req, res);
    } catch (e) {
      process.stderr.write(`view: ${req.method} ${req.url}: ${String(e?.message ?? e).slice(0, 200)}\n`);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
      else try { res.destroy(); } catch { /* already gone */ }
    }
  });

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return json(res, 400, { error: "malformed URL" }); }

    const refused = originPolicy(req);
    if (refused) return json(res, 403, { error: refused });

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(PAGE, "utf8"));
    }

    if (req.method === "GET" && url.pathname === "/board") {
      return json(res, 200, await boardSummary());
    }

    if (req.method === "GET" && url.pathname === "/seats") {
      return json(res, 200, {
        seats: Object.entries(ADAPTERS).map(([v, s]) => ({
          vendor: v, default_model: s.default_model, continuity: s.continuity,
        })),
        state: reduceSeats(bus.snapshot()),
        stats: bus.stats(),
      });
    }

    if (req.method === "GET" && url.pathname === "/events") {
      if (subscribers >= MAX_SUBSCRIBERS) {
        return json(res, 503, { error: `too many /events subscribers (${subscribers}/${MAX_SUBSCRIBERS}); close one before opening another` });
      }
      subscribers++;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        // Without this, a proxy or the browser can buffer the stream and deliver it at the end
        // — reproducing, in the transport, exactly the blindness this view exists to remove.
        "x-accel-buffering": "no",
      });
      // Headers go out NOW. Without this the client waits for the first event or the 15s ping before it
      // even learns the stream opened -- on an idle bus that is 15s of apparent silence.
      res.flushHeaders();
      // Resume from Last-Event-ID so a reconnect does not replay the whole buffer.
      const from = Number(req.headers["last-event-id"] ?? url.searchParams.get("from") ?? 0) || 0;
      const send = e => {
        res.write(`id: ${e.seq ?? 0}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const unsubscribe = bus.subscribe(send, { from });
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { subscribers--; clearInterval(keepAlive); unsubscribe(); });
      return;
    }

    if (req.method === "POST" && url.pathname === "/turn") {
      const ct = String(req.headers["content-type"] ?? "");
      if (!/^application\/json\b/i.test(ct)) {
        return json(res, 415, { error: `POST /turn requires content-type application/json, got "${ct}"` });
      }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 64_000) { req.destroy(); return; }   // bounded: no unbounded buffering
        }
      } catch { return; }                                           // client went away mid-body
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "invalid JSON" }); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(res, 400, { error: "body must be a JSON object" });
      // `models` is a per-vendor map. A single `model` applied across a fan-out sends one
      // vendor's model id to another, which 404s at best and silently runs the wrong model at
      // worst; `model` is kept only for the single-seat case.
      const { vendor, prompt, purpose, model, models, seats, label, labels } = parsed;
      const targets = Array.isArray(seats) && seats.length ? seats : (vendor ? [vendor] : []);
      if (!targets.length || !prompt) return json(res, 400, { error: "need prompt and vendor (or seats[])" });
      for (const v of targets) if (typeof v !== "string" || !ADAPTERS[v]) return json(res, 400, { error: `unknown vendor "${v}"` });
      if (badId(purpose) || badId(label)) return json(res, 400, { error: "purpose and label must be identifiers (letters, digits, . _ : -)" });
      for (const v of targets) if (badId(labels?.[v])) return json(res, 400, { error: `label for ${v} must be an identifier` });

      // Fan out concurrently: the whole point of a multi-seat view is watching seats run at the
      // same time. allSettled so one vendor's failure does not cancel the others.
      const results = await Promise.allSettled(
        targets.map(v => runTurn({
          vendor: v, purpose: purpose ?? "view", prompt,
          model: models?.[v] ?? (targets.length === 1 ? model : undefined),
          label: labels?.[v] ?? (targets.length === 1 ? label : undefined),
        })),
      );
      return json(res, 200, {
        results: targets.map((v, i) => ({
          vendor: v,
          ok: results[i].status === "fulfilled" && results[i].value?.ok === true,
          why: results[i].status === "rejected" ? String(results[i].reason) : (results[i].value?.why ?? null),
        })),
      });
    }

    json(res, 404, { error: "not found" });
  }

  return { server, bus, runTurn, listen: (port = 7777) => new Promise(r => server.listen(port, "127.0.0.1", () => r(server.address()))) };
}
