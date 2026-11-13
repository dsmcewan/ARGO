// Build API. Triggers Pantheon's real pipeline (src/board/run-item.mjs) over HTTP, so a caller
// that is not a terminal -- LEXI's companion, first -- can start a build and watch it happen.
//
// Binds to 127.0.0.1 only and enforces the same origin policy as the live view, from the same
// module (./http-safety.mjs). This process can spend four vendors' credentials; a harness that
// listens on 0.0.0.0 by default hands that to anything on the network, and "it was only for local
// development" is how that ships.
//
// Zero runtime dependencies beyond node: builtins -- the SDKs are injected by the caller via
// makeClientFor, exactly as createViewServer and runOpenItem both require.
import { createServer } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import { createBus } from "./bus.mjs";
import { originPolicy, json } from "./http-safety.mjs";
import { runOpenItem } from "../board/run-item.mjs";
import { ticketContainmentRefusal, ticketRuntimeRefusal, outDirFor } from "../board/ticket-safety.mjs";
import { VENDORS } from "../board/schema.mjs";

// Two builds at once, a third refused. Two DIFFERENT tickets do not share state (each gets its own
// board root), so they can genuinely run side by side; the cap exists because each build spends
// real vendor credit and holds a worktree, not because of a data race.
export const MAX_CONCURRENT_BUILDS = 2;

/**
 * Ticket fields the pipeline hard-requires, checked at the door.
 *
 * WHY THESE AND NOT "ALL OF THEM". Each name here is a field run-item.mjs really dereferences on a
 * path that cannot recover from its absence. `question` is the one that cost a run: the intake
 * scout publishes `{ kind: "search", payload: { query: spec.question } }`, and schema.mjs refuses
 * an empty query -- so a ticket without it is a build that CANNOT finish, admitted anyway.
 *
 * On 2026-09-28 exactly that happened. A ticket drafted by gpt-5.5 passed this door, ran a full
 * scout turn -- 58 seconds, 81,280 tokens, twelve tool calls against the target repo -- and then
 * died at publish. Nothing was broken: not the scout, not the seat, not the schema. The gate just
 * did not check a field the next stage requires, so the cost was paid before the refusal and the
 * error surfaced a long way from its cause. A gate that admits work it knows will fail is not one.
 *
 * The other fields run-item reads (slots, copy, constraints, forbidden, attach, tests_file) are
 * genuinely optional or have defaults, so requiring them here would refuse tickets that build
 * fine. A test pins that every name in this list is one run-item actually reads.
 */
export const REQUIRED_TICKET_FIELDS = ["key", "repo_root", "question", "title", "goal"];

/**
 * Why this ticket cannot build, or null if it can.
 *
 * Present-but-empty counts as missing, because that is what actually arrived: LEXI's own
 * _REQUIRED_KEYS check passes on a key that EXISTS, and what came through was blank.
 *
 * Reports every missing field at once. One at a time would turn fixing a drafter into a guessing
 * game with a 58-second round trip per guess.
 */
export function requiredTicketFieldRefusal(ticket, { fields = REQUIRED_TICKET_FIELDS } = {}) {
  const missing = fields.filter(f => typeof ticket?.[f] !== "string" || !ticket[f].trim());
  if (!missing.length) return ticketRuntimeRefusal(ticket);
  return `ticket is missing ${missing.length === 1 ? "a field" : "fields"} the build needs: ` +
    missing.map(f => `ticket.${f}`).join(", ") +
    " -- each must be a non-empty string. Refused here rather than part-way through, because the " +
    "pipeline dereferences these and a build that cannot finish should not spend a seat first.";
}
// GET /events is long-lived, so an uncapped subscriber set is an unbounded-memory endpoint on the
// loopback. Loopback bounds who can hit it, not how many times.
export const MAX_SUBSCRIBERS = 64;

// Containment lives in src/board/ticket-safety.mjs, checked HERE so a bad ticket is refused with a
// 400 before anything starts, and AGAIN inside runOpenItem because the pipeline has two other
// doors (the CLI and any importer). One implementation, two call sites -- not two copies.

/**
 * @param {object} o
 * @param {(vendor: string) => object} o.makeClientFor - required; injected the same way runOpenItem
 *   and createViewServer require it, so no module here imports a vendor SDK.
 * @param {string} [o.allowedRoot] - a ticket's repo_root must resolve to this directory or below it.
 * @param {(spec: object, opts: object) => Promise<object>} [o.run] - the pipeline. Defaults to
 *   runOpenItem. Injectable for the same reason makeClientFor is: the concurrency guard cannot be
 *   tested against the real pipeline, which (with no vendor credentials present) fails in
 *   milliseconds and empties the in-flight set before a second request can collide with it.
 */
export function createBuildServer({ makeClientFor, allowedRoot = join(homedir(), "Projects"), run = runOpenItem } = {}) {
  if (typeof makeClientFor !== "function") {
    throw new Error("createBuildServer: pass makeClientFor(vendor) -- this module never imports a vendor SDK");
  }
  const bus = createBus();
  const running = new Set();          // ticket keys currently in flight
  let subscribers = 0;

  const server = createServer(async (req, res) => {
    // Every failure below is a response, never a crash: a malformed URL, a dropped connection and a
    // thrown handler must not take the process -- and its four credentials -- down with it.
    req.on("error", () => { /* aborted mid-read; the for-await below rejects and is caught */ });
    try {
      await handle(req, res);
    } catch (e) {
      process.stderr.write(`build: ${req.method} ${req.url}: ${String(e?.message ?? e).slice(0, 200)}\n`);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
      else try { res.destroy(); } catch { /* already gone */ }
    }
  });

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return json(res, 400, { error: "malformed URL" }); }

    const refused = originPolicy(req);
    if (refused) return json(res, 403, { error: refused });

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
        // -- reproducing, in the transport, exactly the blindness this endpoint exists to remove.
        "x-accel-buffering": "no",
      });
      res.flushHeaders();
      const from = Number(req.headers["last-event-id"] ?? url.searchParams.get("from") ?? 0) || 0;
      const send = e => res.write(`id: ${e.seq ?? 0}\ndata: ${JSON.stringify(e)}\n\n`);
      const unsubscribe = bus.subscribe(send, { from });
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { subscribers--; clearInterval(keepAlive); unsubscribe(); });
      return;
    }

    if (req.method === "GET" && url.pathname === "/builds") {
      return json(res, 200, { running: [...running], max: MAX_CONCURRENT_BUILDS });
    }

    if (req.method === "POST" && url.pathname === "/build") {
      const ct = String(req.headers["content-type"] ?? "");
      if (!/^application\/json\b/i.test(ct)) {
        return json(res, 415, { error: `POST /build requires content-type application/json, got "${ct}"` });
      }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 256_000) { req.destroy(); return; }   // bounded: no unbounded buffering
        }
      } catch { return; }                                          // client went away mid-body
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "invalid JSON" }); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(res, 400, { error: "body must be a JSON object" });

      const ticket = parsed.ticket;
      if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) return json(res, 400, { error: "body must carry a `ticket` object" });
      if (typeof ticket.key !== "string" || !ticket.key) return json(res, 400, { error: "ticket.key must be a non-empty string" });
      if (typeof ticket.repo_root !== "string" || !ticket.repo_root) {
        return json(res, 400, { error: "ticket.repo_root must be set: a build API cannot fall back to this repo's own root" });
      }
      const missing = requiredTicketFieldRefusal(ticket);
      if (missing) return json(res, 400, { error: missing });
      const escapes = ticketContainmentRefusal(ticket, { allowedRoot });
      if (escapes) return json(res, 400, { error: escapes });
      // OPTIONAL SCOUT OVERRIDE. The pipeline's default intake fans out to two independent pools
      // (agy_google + xai); a caller that already knows one pool is down (a depleted vendor
      // account, a recorded cooldown) can name a different set instead of paying for a scout turn
      // that is certain to fail at that vendor. Defaults to runOpenItem's own default when absent.
      let scouts;
      if (parsed.scouts !== undefined) {
        if (!Array.isArray(parsed.scouts) || parsed.scouts.length === 0 ||
            !parsed.scouts.every(v => typeof v === "string" && VENDORS.has(v))) {
          return json(res, 400, { error: `scouts must be a non-empty array of known vendor ids (${[...VENDORS].join(", ")})` });
        }
        scouts = parsed.scouts;
      }
      if (running.has(ticket.key)) {
        return json(res, 409, { error: `a build for "${ticket.key}" is already running; the same ticket twice at once would share one output directory` });
      }
      if (running.size >= MAX_CONCURRENT_BUILDS) {
        return json(res, 409, { error: `${MAX_CONCURRENT_BUILDS} build(s) already running (${[...running].join(", ")}); this server runs at most ${MAX_CONCURRENT_BUILDS} at a time` });
      }

      running.add(ticket.key);
      // EVERY event is tagged with the ticket key. run-item.mjs's events carry `stage` but not
      // `key` -- correct for its own per-build progress.jsonl, and unreadable on a bus two builds
      // share. Tagging belongs here, where the ambiguity is.
      const publish = e => { try { bus.publish({ ...e, key: ticket.key }); } catch { /* one bad subscriber must not fail the build */ } };
      // Deliberately not awaited: the response is 202 and the result arrives on /events. A rejected
      // promise here would be an unhandled rejection, so runOpenItem's own contract (it returns a
      // result rather than throwing, once past its argument checks) is backed up with a catch.
      run(ticket, { makeClientFor, progress: publish, ...(scouts ? { scouts } : {}) })
        .then(result => publish({ event: "run.done", ok: result.ok, shipped: result.shipped, error: result.error, salvaged: result.salvaged, board: result.board, outDir: result.outDir }))
        .catch(e => publish({ event: "run.done", ok: false, shipped: false, error: { stage: "start", message: String(e?.message ?? e).slice(0, 400) } }))
        .finally(() => running.delete(ticket.key));

      // Where the outcome will land. A caller polling for it (LEXI does) needs this now, not when
      // the build finishes -- and must not rebuild the path formula itself.
      const outDir = outDirFor(ticket);
      return json(res, 202, {
        accepted: true, key: ticket.key, running: [...running],
        out_dir: outDir, run_json: join(outDir, "run.json"),
      });
    }

    json(res, 404, { error: "not found" });
  }

  return { server, bus, listen: (port = 7778) => new Promise(r => server.listen(port, "127.0.0.1", () => r(server.address()))) };
}
