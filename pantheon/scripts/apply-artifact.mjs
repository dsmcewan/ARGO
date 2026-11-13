
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cidOf } from "../src/board/canon.mjs";
import { certifiedArtifacts } from "../src/board/artifacts.mjs";
import { readArtifact, writeArtifact } from "../src/board/artifact-files.mjs";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function unchanged(repoRoot, file) {
  const live = readArtifact(repoRoot, file.path);
  return (live !== null) === file.baseline.exists && cidOf("blob", live ?? Buffer.alloc(0)) === file.baseline.bytes;
}

export function checkApply({ key, outputsDir, repoRoot }) {
  try {
    if (!identifier.test(key) || ["constructor", "prototype", "__proto__"].includes(key)) throw new Error("invalid ticket key");
    const expected = join(resolve(repoRoot), "outputs", "open-items", key);
    outputsDir ??= expected;
    if (resolve(outputsDir) !== expected) throw new Error("outputs directory is not this ticket's directory");
    const raw = readArtifact(repoRoot, `outputs/open-items/${key}/run.json`);
    if (raw === null) throw new Error("no shipped artifact recorded for this key");
    const run = JSON.parse(raw.toString("utf8"));
    if (run.key !== key) throw new Error("manifest belongs to another ticket");
    const files = certifiedArtifacts(run, { repoRoot, outDir: outputsDir });
    for (const file of files) {
      if (file.exported === null || cidOf("blob", file.exported) !== file.bytes) throw new Error(`exported artifact differs from certified bytes: ${file.path}`);
      if (!unchanged(repoRoot, file)) return { safe: false, path: file.path,
        reason: "live file differs from what the implementer was shown; something else changed it since this ticket started" };
    }
    return { safe: true, path: files[0].path, paths: files.map(f => f.path), files, reason: null };
  } catch (e) {
    return { safe: false, reason: e instanceof SyntaxError ? "run.json is not valid JSON" : e.message };
  }
}

export function applyArtifacts(options) {
  const result = checkApply(options);
  if (!result.safe) throw new Error(result.reason);
  // Validate EVERY destination before the first write. Use the already certified buffers,
  // never a second copyFile read of a source that could have changed since verification.
  for (const file of result.files) if (!unchanged(options.repoRoot, file)) throw new Error(`live file changed: ${file.path}`);
  for (const file of result.files) writeArtifact(options.repoRoot, file.path, file.contents);
  return { paths: result.paths };
}

function main(args) {
  const keyAt = args.indexOf("--key"), apply = args.includes("--apply");
  if (keyAt < 0 || !args[keyAt + 1] || args[keyAt + 1].startsWith("--") ||
      args.filter(a => a === "--key").length !== 1 ||
      args.length !== (apply ? 3 : 2) || (apply && args.filter(a => a === "--apply").length !== 1)) {
    console.error("Usage: node scripts/apply-artifact.mjs --key <key> [--apply]");
    return 2;
  }
  const options = { key: args[keyAt + 1], repoRoot: process.cwd() };
  const result = checkApply(options);
  if (!result.safe) { console.error(`REFUSED: ${result.reason}`); return 1; }
  for (const path of result.paths) console.log(`path: ${path}`);
  if (apply) {
    const applied = applyArtifacts(options);
    for (const path of applied.paths) console.log(`applied ${path}`);
  } else console.log("SAFE to apply");
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`REFUSED: ${error.message}`); process.exitCode = 1; }
}
