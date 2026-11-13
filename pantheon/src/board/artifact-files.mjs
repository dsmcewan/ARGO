
// File boundaries shared by the controller and apply. Following a copied symlink here would
// let a sandboxed test redirect the controller's NEXT write onto the host.
import { lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync, statSync } from "node:fs";
import { resolve, relative, join, dirname, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";

export function artifactPath(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path)) throw new Error("artifact path must be relative");
  const base = realpathSync(root), target = resolve(base, path), rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("artifact path escapes its root");
  let at = base;
  for (const segment of rel.split(sep)) {
    at = join(at, segment);
    try { if (lstatSync(at).isSymbolicLink()) throw new Error(`symlink in artifact path: ${path}`); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return target;
}

export function readArtifact(root, path) {
  const file = artifactPath(root, path);
  try { return readFileSync(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

export function writeArtifact(root, path, bytes) {
  let file = artifactPath(root, path);
  mkdirSync(dirname(file), { recursive: true });
  file = artifactPath(root, path);
  let mode = 0o666;
  try { mode = statSync(file).mode & 0o777; } catch (e) { if (e.code !== "ENOENT") throw e; }
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    writeFileSync(tmp, bytes, { flag: "wx", mode });
    // Rename the actual validated bytes, rather than following a destination symlink.
    artifactPath(root, path);
    renameSync(tmp, file);
  } finally { try { unlinkSync(tmp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
}
