// The request-safety rules shared by every local HTTP surface in this project (the live view and
// the build API). Extracted from src/view/server.mjs unchanged, so a second server cannot ship with
// a subtly weaker copy of checks that an EXTERNAL review -- not this project's own suite -- found
// holes in the first time.
//
// REQUEST-ORIGIN POLICY. The loopback bind is necessary and was never sufficient: a browser on this
// machine is on the loopback too, so before this any web page open in it could POST a text/plain
// body -- a "simple" request that needs no CORS preflight -- and spend all four vendors' credits;
// and DNS rebinding (attacker.example resolving to 127.0.0.1 after the page loads) turned the bind
// into a same-origin read of an event stream that carries seat text. Three checks, each
// independent, each refusing:
//
//   Host      must name the loopback AND this port. Rebinding fails here: the Host header still
//             says attacker.example.
//   Origin    when present, must be the loopback origin on this port. A cross-site POST always
//             carries one; curl and same-origin navigations carry none, so absence is allowed.
//   Body type a POST requires application/json (checked by each server on its own routes). A
//             cross-origin JSON POST triggers a preflight these servers never answer with CORS
//             headers, so the browser refuses to send it; the text/plain form that skips preflight
//             is refused there.
//
// Sec-Fetch-Site, when a browser sends it, must be same-origin or none -- belt and braces.
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

const splitHost = h => {
  if (h.startsWith("[")) { const c = h.indexOf("]"); return c === -1 ? null : { name: h.slice(0, c + 1), port: h.slice(c + 1).replace(/^:/, "") }; }
  const i = h.lastIndexOf(":");
  return i === -1 ? { name: h, port: "" } : { name: h.slice(0, i), port: h.slice(i + 1) };
};

const isLocalHostPort = (h, port) => {
  const sp = h ? splitHost(String(h)) : null;
  if (!sp || !LOCAL.has(sp.name.toLowerCase())) return false;
  return sp.port === "" ? port === 80 : Number(sp.port) === port;
};

/** null when the request may proceed; otherwise the reason to refuse it with, as a string. */
export function originPolicy(req) {
  const port = req.socket?.localPort;
  if (!isLocalHostPort(req.headers.host, port)) return `Host "${req.headers.host ?? ""}" is not this server's loopback address`;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o = null;
    try { o = new URL(origin); } catch { return `Origin "${origin}" is not a URL`; }
    if (o.protocol !== "http:" || !isLocalHostPort(o.host, port)) return `Origin "${origin}" is not this server`;
  }
  const sfs = req.headers["sec-fetch-site"];
  if (sfs !== undefined && sfs !== "same-origin" && sfs !== "none") return `Sec-Fetch-Site "${sfs}" is a cross-site request`;
  return null;
}

export const json = (res, code, body) => {
  // nosniff, and never a CORS header: the default answer to a cross-origin reader is silence.
  res.writeHead(code, { "content-type": "application/json", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
};

// A seat label becomes an object key in reduceSeats and the SSE stream. "__proto__" as a key is
// prototype confusion at best; the reviewer that found the /turn hole also polluted a prototype
// through it. Labels and purposes are identifiers, and are refused otherwise.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
// "constructor" and "prototype" are valid identifiers and still special on every plain object a
// browser-side reducer might key by seat; refused by name, not by shape.
const RESERVED = new Set(["constructor", "prototype", "__proto__"]);

export const badId = v => v !== undefined && (typeof v !== "string" || !SAFE_ID.test(v) || RESERVED.has(v));
