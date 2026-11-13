// Human-authored oracle for ticket applyArtifactGuard ("a shipped artifact can silently overwrite a
// live file that changed since the implementer last saw it"). Written BEFORE the seat creates
// scripts/apply-artifact.mjs; baselined failing simply because the file does not exist yet.
//
// The real incident this closes, 2026-09-28: applying reviewerReseatLab's shipped artifact to
// src/board/run-item.mjs silently clobbered a concurrent Claude Code session's own in-progress edit
// to that same file, in the same shared, non-worktree-isolated checkout. The pipeline's own board
// and worktree were never at fault -- every ticket already runs isolated -- the gap is entirely in
// the manual "copy it in yourself" step the README (scripts/tickets/README.md, step 6) describes.
//
// This fixture reconstructs the exact on-disk shape a real shipped ticket leaves behind
// (outputs/open-items/<key>/{run.json, implementer-prompt-<key>-rev1.txt, artifact/<path>}), using
// the real prompt format from src/board/run-item.mjs's own template ("Current contents of <path>:"
// followed by the file body, followed by a line reading exactly "[tests]").
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runOpenItem } from "../src/board/run-item.mjs";
import { withPipeline } from "./fixtures/pipeline.mjs";

const withRepo = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-apply-guard-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Builds outputs/open-items/<key>/ exactly as a real shipped run leaves it: run.json with
// artifact.copied_to, a rev1 implementer prompt in the pipeline's real template shape, and the
// shipped artifact bytes themselves.
async function seedShippedTicket({ outputsDir, key, path, preTicketContent, shippedContent }) {
  // Keep the original create/edit/collision oracles, but seed through the real isolated controller
  // and ship gates. A hand-written {shipped:true} summary is deliberately no longer sufficient.
  const repoRoot = resolve(outputsDir, "../../..");
  const livePath = join(repoRoot, path);
  const live = existsSync(livePath) ? readFileSync(livePath) : null;
  mkdirSync(join(livePath, ".."), { recursive: true });
  if (preTicketContent) writeFileSync(livePath, preTicketContent);
  else rmSync(livePath, { force: true });
  try {
    await withPipeline(async ({ opts, implement }) => {
      implement(() => shippedContent);
      const result = await runOpenItem({ key, slot: key, path, repo_root: repoRoot,
        title: "apply fixture", goal: "apply fixture", question: "fixture",
        copy: preTicketContent ? [path] : [], acceptance_cmd: "true" },
        { ...opts, dir: join(repoRoot, `board-${key}`) });
      assert.equal(result.shipped, true, JSON.stringify(result.error));
    });
  } finally {
    if (live === null) rmSync(livePath, { force: true });
    else writeFileSync(livePath, live);
  }
}

test("SAFE when the live file is byte-identical to what the implementer was shown", async () => {
  await withRepo(async repoRoot => {
    const path = "src/thing.mjs";
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, path), "export const ok = false;\n");
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "export const ok = false;\n", shippedContent: "export const ok = true;\n" });

    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "fixtureKey", outputsDir, repoRoot });
    assert.equal(r.safe, true, `expected safe, got: ${JSON.stringify(r)}`);
    assert.equal(r.path, path);
  });
});

test("REFUSED when the live file changed since the implementer's rev1 baseline, and nothing is written", async () => {
  await withRepo(async repoRoot => {
    const path = "src/thing.mjs";
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    // A DIFFERENT session edited this file after the ticket's rev1 prompt was written.
    writeFileSync(join(repoRoot, path), "export const ok = false;\nexport const other = 1; // a concurrent edit\n");
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "export const ok = false;\n", shippedContent: "export const ok = true;\n" });

    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "fixtureKey", outputsDir, repoRoot });
    assert.equal(r.safe, false, `expected refused, got: ${JSON.stringify(r)}`);
    assert.match(r.reason, /changed since|differs from what the implementer was shown/i);
    assert.equal(readFileSync(join(repoRoot, path), "utf8"), "export const ok = false;\nexport const other = 1; // a concurrent edit\n",
      "checkApply must never write, even when refusing");
  });
});

test("SAFE for a create ticket (no pre-ticket file) when the live path is still absent", async () => {
  await withRepo(async repoRoot => {
    const path = "src/new-thing.mjs";
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "", shippedContent: "export const created = true;\n" });

    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "fixtureKey", outputsDir, repoRoot });
    assert.equal(r.safe, true, `expected safe (nothing to collide with), got: ${JSON.stringify(r)}`);
  });
});

test("REFUSED for a create ticket when something else created the file independently since", async () => {
  await withRepo(async repoRoot => {
    const path = "src/new-thing.mjs";
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, path), "// someone else created this independently\n");
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "", shippedContent: "export const created = true;\n" });

    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "fixtureKey", outputsDir, repoRoot });
    assert.equal(r.safe, false);
  });
});

test("path extraction is not fooled by the ticket's own root containing the literal text \"artifact\"", async () => {
  // Real bug found by an xai/grok-4.7 adversarial review of this ticket's first attempt: a naive
  // `copiedTo.indexOf("/artifact/")` finds the WRONG occurrence when the repo root itself contains
  // that substring before the true `<outputsDir>/artifact/` segment, extracting a mangled path.
  await withRepo(async outerDir => {
    const repoRoot = join(outerDir, "my-artifact-repo");
    const path = "src/thing.mjs";
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, path), "export const ok = false;\n");
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "export const ok = false;\n", shippedContent: "export const ok = true;\n" });

    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "fixtureKey", outputsDir, repoRoot });
    assert.equal(r.safe, true, `expected safe with the correct path extracted despite "artifact" in repoRoot, got: ${JSON.stringify(r)}`);
    assert.equal(r.path, path, `path extraction must not be confused by repoRoot containing "artifact"; got path=${JSON.stringify(r.path)}`);
  });
});

test("a missing run.json or rev1 prompt is a checked {safe:false} result, never a thrown exception", async () => {
  await withRepo(async repoRoot => {
    const outputsDir = join(repoRoot, "outputs", "open-items", "nope");
    const { checkApply } = await import("../scripts/apply-artifact.mjs");
    const r = await checkApply({ key: "nope", outputsDir, repoRoot });
    assert.equal(r.safe, false);
    assert.equal(typeof r.reason, "string");
  });
});

test("the CLI --apply path actually copies when safe, and writes nothing and exits nonzero when refused", async () => {
  await withRepo(async repoRoot => {
    const path = "src/thing.mjs";
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, path), "export const ok = false;\n");
    const outputsDir = join(repoRoot, "outputs", "open-items", "fixtureKey");
    await seedShippedTicket({ outputsDir, key: "fixtureKey", path, preTicketContent: "export const ok = false;\n", shippedContent: "export const ok = true;\n" });

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const script = new URL("../scripts/apply-artifact.mjs", import.meta.url).pathname;

    const applied = await run(process.execPath, [script, "--key", "fixtureKey", "--apply"], { cwd: repoRoot });
    assert.equal(readFileSync(join(repoRoot, path), "utf8"), "export const ok = true;\n", "a safe apply must actually copy the shipped bytes in");
    assert.match(applied.stdout, /applied/i);

    // Now simulate a concurrent edit landing right after, and try again: must refuse and not touch the file.
    writeFileSync(join(repoRoot, path), "export const ok = true;\nexport const untouched = \"someone else's edit\";\n");
    await assert.rejects(() => run(process.execPath, [script, "--key", "fixtureKey", "--apply"], { cwd: repoRoot }));
    assert.equal(readFileSync(join(repoRoot, path), "utf8"), "export const ok = true;\nexport const untouched = \"someone else's edit\";\n",
      "a refused apply must never overwrite the live file");
  });
});
