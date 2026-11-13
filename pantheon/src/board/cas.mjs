// Content-addressed store. Put is idempotent by construction: the path IS the hash, so writing
// the same node twice is a no-op and two seats that produce the same patch produce one blob.
//
// LINK INTEGRITY IS CHECKED AT PUT TIME, and that is what makes the DAG acyclic rather than
// merely "we intend it to be acyclic". You cannot cite a cid that does not exist yet, so a cycle
// has no way to form and no graph walk is needed to look for one. It also refuses the fabricated
// citation -- a link to a node nobody ever wrote -- which a walk performed later would find only
// if someone ran it.
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { cidOf, nodeBytes, codecOf, isCid, canonicalize } from "./canon.mjs";

const objPath = (root, cid) => {
  const [codec, hex] = cid.split(":");
  return join(root, "objects", codec, hex.slice(0, 2), hex.slice(2));
};

/** Every cid this node points at, whatever the shape of the field holding it. */
export function linksOf(codec, node) {
  const out = [];
  const walk = v => {
    if (isCid(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  if (codec === "blob") return out;
  walk(node);
  return out;
}

export function openStore(root, { readOnly = false } = {}) {
  if (!readOnly) mkdirSync(join(root, "objects"), { recursive: true });

  const has = cid => isCid(cid) && existsSync(objPath(root, cid));

  function put(codec, node) {
    if (readOnly) throw new Error("cas.put: this store is read-only");
    const cid = cidOf(codec, node);
    const p = objPath(root, cid);
    if (existsSync(p)) return cid;                    // idempotent: identical bytes, identical name

    for (const link of linksOf(codec, node)) {
      if (!has(link)) {
        throw new Error(`cas.put: ${codec} links ${link}, which is not in the store. ` +
          `A node may only cite nodes that already exist -- that is what keeps the DAG acyclic ` +
          `and makes a fabricated citation impossible rather than merely detectable later.`);
      }
    }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp${process.pid}`;
    try {
      writeFileSync(tmp, nodeBytes(codec, node));
      renameSync(tmp, p);                             // atomic: a torn object is never readable
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
      throw e;
    }
    return cid;
  }

  function get(cid) {
    if (!isCid(cid)) throw new Error(`cas.get: "${cid}" is not a cid`);
    const p = objPath(root, cid);
    if (!existsSync(p)) throw new Error(`cas.get: ${cid} is not in the store`);
    const bytes = readFileSync(p);
    if (codecOf(cid) === "blob") {
      // Blobs were served BEFORE the check below, so an artifact's bytes -- the one object every
      // "bound to a hash" claim is ultimately about -- were the one object never re-hashed on read.
      const again = cidOf("blob", bytes);
      if (again !== cid) throw new Error(`cas.get: ${cid} does not hash to its own name (got ${again}); the object store has been tampered with`);
      return bytes;
    }
    const node = JSON.parse(bytes.toString("utf8"));
    // Re-derive the name from the bytes. A store whose object has been edited in place would
    // otherwise serve content under a hash that no longer describes it, and every downstream
    // "bound to a hash" claim would be false while still looking verified.
    const again = cidOf(codecOf(cid), node);
    if (again !== cid) throw new Error(`cas.get: ${cid} does not hash to its own name (got ${again}); the object store has been tampered with`);
    return node;
  }

  const getBlobText = cid => get(cid).toString("utf8");

  /** Walk lineage from a set of roots. Bounded, because an unbounded walk over a growing DAG is
   *  how a projection quietly becomes the whole history. */
  function reachable(roots, { limit = 10_000 } = {}) {
    const seen = new Set(), queue = [...roots];
    let truncated = false;
    while (queue.length) {
      const cid = queue.shift();
      if (!isCid(cid) || seen.has(cid)) continue;
      if (seen.size >= limit) { truncated = true; break; }
      seen.add(cid);
      if (codecOf(cid) === "blob") continue;
      for (const l of linksOf(codecOf(cid), get(cid))) if (!seen.has(l)) queue.push(l);
    }
    return { cids: [...seen], truncated, limit };
  }

  const count = () => {
    let n = 0;
    const objects = join(root, "objects");
    if (!existsSync(objects)) return 0;
    for (const codec of readdirSync(objects)) {
      for (const shard of readdirSync(join(objects, codec))) {
        n += readdirSync(join(objects, codec, shard)).filter(f => !f.includes(".tmp")).length;
      }
    }
    return n;
  };

  return { root, has, put, get, getBlobText, reachable, count, cidOf, canonicalize };
}
