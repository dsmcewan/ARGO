// Byte caps measured through JSON.stringify can be shrunk by a `toJSON` on the value: a brief carrying
// 20 KB with `toJSON() { return "tiny" }` measured as 6 bytes and passed law 4's diary cap, and the
// continuity brief's own cap in the same way (found by an in-session probe after the 2026-09-27
// re-review). This walks the DATA -- own enumerable properties, Map/Set entries, array items -- and
// counts what a reader would actually receive. Functions count as nothing; cycles are counted once.
export function measureBytes(value, seen = new Set()) {
  if (value == null) return 4;
  switch (typeof value) {
    case "string": return Buffer.byteLength(value, "utf8") + 2;
    case "number": return String(value).length;
    case "boolean": return value ? 4 : 5;
    case "bigint": return String(value).length;
    case "function": case "symbol": case "undefined": return 0;
  }
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength * 2;   // hex-ish upper bound
  if (value instanceof Date) return 26;
  if (Array.isArray(value)) return 2 + value.reduce((n, x) => n + measureBytes(x, seen) + 1, 0);
  if (value instanceof Map) return 2 + [...value.entries()].reduce((n, [k, v]) => n + measureBytes(String(k), seen) + measureBytes(v, seen) + 2, 0);
  if (value instanceof Set) return 2 + [...value].reduce((n, x) => n + measureBytes(x, seen) + 1, 0);
  let n = 2;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "function") continue;            // toJSON and friends are not payload
    n += Buffer.byteLength(k, "utf8") + 3 + measureBytes(v, seen) + 1;
  }
  return n;
}
