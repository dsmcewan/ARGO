// Live-view server. Zero runtime dependencies beyond node: builtins — the SDKs are injected by
// the caller, so this module imports no vendor package and stays testable without one.
//
// Binds to 127.0.0.1 only. This process holds four vendors' credentials and can spend money on
// them; a harness that listens on 0.0.0.0 by default hands that to anything on the network, and
// "it was only for local development" is how that ships.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createBus, reduceSeats } from "./bus.mjs";
import { sdkTurn } from "../sdk/seat-sdk.mjs";
import { ADAPTERS } from "../sdk/adapter.mjs";

const PAGE = fileURLToPath(new URL("./app.html", import.meta.url));

export function createViewServer({ makeClientFor, home, cwd = process.cwd() } = {}) {
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

  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(PAGE, "utf8"));
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
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        // Without this, a proxy or the browser can buffer the stream and deliver it at the end
        // — reproducing, in the transport, exactly the blindness this view exists to remove.
        "x-accel-buffering": "no",
      });
      // Resume from Last-Event-ID so a reconnect does not replay the whole buffer.
      const from = Number(req.headers["last-event-id"] ?? url.searchParams.get("from") ?? 0) || 0;
      const send = e => {
        res.write(`id: ${e.seq ?? 0}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const unsubscribe = bus.subscribe(send, { from });
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
      return;
    }

    if (req.method === "POST" && url.pathname === "/turn") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64_000) { req.destroy(); return; }   // bounded: no unbounded buffering
      }
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "invalid JSON" }); }
      // `models` is a per-vendor map. A single `model` applied across a fan-out sends one
      // vendor's model id to another, which 404s at best and silently runs the wrong model at
      // worst; `model` is kept only for the single-seat case.
      const { vendor, prompt, purpose, model, models, seats, label, labels } = parsed;
      const targets = Array.isArray(seats) && seats.length ? seats : (vendor ? [vendor] : []);
      if (!targets.length || !prompt) return json(res, 400, { error: "need prompt and vendor (or seats[])" });
      for (const v of targets) if (!ADAPTERS[v]) return json(res, 400, { error: `unknown vendor "${v}"` });

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
  });

  return { server, bus, runTurn, listen: (port = 7777) => new Promise(r => server.listen(port, "127.0.0.1", () => r(server.address()))) };
}
