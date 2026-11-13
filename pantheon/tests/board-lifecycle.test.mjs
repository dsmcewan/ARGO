
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { runOpenItem } from "../src/board/run-item.mjs";
import * as applying from "../scripts/apply-artifact.mjs";
import { withPipeline } from "./fixtures/pipeline.mjs";

const specFor = repo => ({ key: "differentKey", repo_root: repo, title: "two files", goal: "both must pass",
  question: "fixture", copy: [], acceptance_cmd: "true",
  slots: [{ slot: "alpha", path: "alpha.mjs" }, { slot: "beta", path: "beta.mjs" }] });

// Real pipeline, scripted seats, real shell/oracle. Shipping a board is insufficient if only
// its first file reaches disk, or if apply can ignore the shipping refusal.
test("refusal, revision on resume, all-slot review/ship/export, guarded apply and idempotent resume", async () => {
  await withPipeline(async ({ repo, opts, calls, implement }) => {
    writeFileSync(join(repo, "alpha.mjs"), "export const ok = false;\n");
    writeFileSync(join(repo, "beta.mjs"), "export const ok = false;\n");
    writeFileSync(join(repo, "verify.mjs"), 'import assert from "node:assert/strict"; import {ok as a} from "./alpha.mjs"; import {ok as b} from "./beta.mjs"; assert.equal(a && b, true);');
    const spec = { ...specFor(repo), copy: ["alpha.mjs", "beta.mjs", "verify.mjs"],
      acceptance_cmd: "node verify.mjs" };
    implement(prompt => /Your revision/.test(prompt) ? "export const ok = true;\n" : "export const ok = false;\n");
    const first = await runOpenItem(spec, opts);
    assert.equal(first.shipped, false);
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    assert.equal(existsSync(join(first.outDir, "artifact", "alpha.mjs")), false,
      "refused work must never be exported as certified work");
    // Another run may overwrite the convenience output record; resume belongs to this BOARD.
    writeFileSync(join(first.outDir, "run.json"), '{"shipped":true,"wrongRun":true}');
    const second = await runOpenItem(spec, { ...opts, resume: first.board });
    assert.equal(second.shipped, true, JSON.stringify(second.error));
    const run = JSON.parse(readFileSync(join(second.outDir, "run.json"), "utf8"));
    assert.equal(run.artifacts.length, 2);
    for (const slot of spec.slots) assert.match(readFileSync(join(second.outDir, "artifact", slot.path), "utf8"), /ok = true/);
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, true,
      "the key need not equal any slot; baseline comes from bytes, not a prompt filename");
    const original = readFileSync(join(repo, "beta.mjs"), "utf8");
    writeFileSync(join(repo, "beta.mjs"), "// concurrent edit\n");
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    assert.throws(() => applying.applyArtifacts({ key: spec.key, repoRoot: repo }), /differs|changed/);
    assert.match(readFileSync(join(repo, "alpha.mjs"), "utf8"), /ok = false/,
      "an invalid second file must stop the WHOLE apply before the first write");
    writeFileSync(join(repo, "beta.mjs"), original);
    applying.applyArtifacts({ key: spec.key, repoRoot: repo });
    for (const slot of spec.slots) assert.match(readFileSync(join(repo, slot.path), "utf8"), /ok = true/);
    const before = calls.length;
    const resumed = await runOpenItem(spec, { ...opts, resume: first.board });
    assert.equal(resumed.shipped, true, JSON.stringify(resumed.error));
    assert.equal(calls.length, before, "a completed board resumes without paying for seats again");
  });
});

test("every successful slot is exported, and a changed resume ticket is refused", async () => {
  await withPipeline(async ({ repo, opts }) => {
    const spec = specFor(repo);
    const result = await runOpenItem(spec, opts);
    assert.equal(result.shipped, true, JSON.stringify(result.error));
    for (const slot of spec.slots) assert.ok(existsSync(join(result.outDir, "artifact", slot.path)), slot.path);
    const changed = await runOpenItem({ ...spec, acceptance_cmd: "true # different" }, { ...opts, resume: result.board });
    assert.equal(changed.shipped, false);
    assert.match(changed.error.message, /ticket|spec/i);
  });
});

test("apply refuses unshipped or tampered exports, legacy manifests and destination symlinks", async () => {
  await withPipeline(async ({ repo, opts }) => {
    const spec = specFor(repo);
    const result = await runOpenItem(spec, opts);
    const path = join(result.outDir, "run.json");
    const original = readFileSync(path, "utf8"), run = JSON.parse(original);
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, true, "positive control before tampering");
    writeFileSync(path, JSON.stringify({ ...run, shipped: false }));
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    writeFileSync(path, original);
    const artifact = join(result.outDir, "artifact", "alpha.mjs"), bytes = readFileSync(artifact);
    writeFileSync(artifact, "// tampered\n");
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    writeFileSync(artifact, bytes);
    writeFileSync(path, JSON.stringify({ key: spec.key, shipped: true, artifact: { copied_to: artifact } }));
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    writeFileSync(path, original);
    writeFileSync(join(repo, "outside.mjs"), "");
    symlinkSync(join(repo, "outside.mjs"), join(repo, "alpha.mjs"));
    assert.equal(applying.checkApply({ key: spec.key, repoRoot: repo }).safe, false);
    unlinkSync(join(repo, "alpha.mjs"));
  });
});

test("acceptance cannot inherit credentials or reach host files, and may not change certified bytes", async () => {
  await withPipeline(async ({ repo, opts, implement }) => {
    const outside = join(repo, "outside.txt");
    writeFileSync(outside, "host-only");
    const old = process.env.PANTHEON_FIX_DUMMY;
    process.env.PANTHEON_FIX_DUMMY = "fixture-secret";
    implement(() => `import {existsSync,writeFileSync} from "node:fs";
      if(process.env.PANTHEON_FIX_DUMMY || existsSync(${JSON.stringify(outside)})) process.exit(7);
      try { writeFileSync(${JSON.stringify(outside)}, "escaped"); process.exit(8); } catch {}
      console.log("confined");`);
    try {
      const r = await runOpenItem({ key: "isolation", slot: "code", path: "code.mjs", repo_root: repo,
        title: "boundary", goal: "boundary", question: "q", copy: [], acceptance_cmd: "node code.mjs" }, opts);
      assert.equal(r.shipped, true, JSON.stringify(r.error));
      assert.equal(readFileSync(outside, "utf8"), "host-only");
    } finally { if (old === undefined) delete process.env.PANTHEON_FIX_DUMMY; else process.env.PANTHEON_FIX_DUMMY = old; }
  });
  await withPipeline(async ({ repo, opts, implement }) => {
    implement(() => 'import {writeFileSync} from "node:fs"; writeFileSync("code.mjs","// changed");');
    const r = await runOpenItem({ key: "mutation", slot: "code", path: "code.mjs", repo_root: repo,
      title: "mutation", goal: "mutation", question: "q", copy: [], acceptance_cmd: "node code.mjs" }, opts);
    assert.equal(r.shipped, false, "passing tests on changed files cannot certify the original CAS bytes");
  });
});

test("a genuine single-slot TESTS refusal is never safe to apply", async () => {
  await withPipeline(async ({ repo, opts, implement }) => {
    writeFileSync(join(repo, "code.mjs"), "// original\n");
    implement(() => "// candidate\n");
    const r = await runOpenItem({ key: "sameSlot", slot: "sameSlot", path: "code.mjs", repo_root: repo,
      title: "refusal", goal: "refusal", question: "q", copy: ["code.mjs"], acceptance_cmd: "exit 1" },
      { ...opts, makeClientFor: vendor => {
        const client = opts.makeClientFor(vendor);
        if (vendor !== "xai") return client;
        return { responses: { inputTokens: {count: async () => ({input_tokens: 1000})}, create: async req => {
          if (!String(req.input).includes("VERDICT")) return client.responses.create(req);
          return { async *[Symbol.asyncIterator]() {
            yield { type: "response.output_text.delta", delta: "VERDICT: approve" };
            yield { type: "response.completed", response: { id: "fixture", output_text: "VERDICT: approve", output: [] } };
          } };
        } } };
      } });
    assert.equal(r.shipped, false);
    assert.equal(applying.checkApply({ key: "sameSlot", repoRoot: repo }).safe, false);
  });
});

test("a test-created symlink cannot redirect a later controller write onto the host", async () => {
  await withPipeline(async ({ repo, opts, implement }) => {
    const outside=join(repo,"host.mjs");writeFileSync(outside,"// host unchanged\n");
    implement(()=>`import {unlinkSync,symlinkSync} from "node:fs"; unlinkSync("code.mjs"); symlinkSync(${JSON.stringify(outside)},"code.mjs");`);
    const r=await runOpenItem({key:"alias",slot:"code",path:"code.mjs",repo_root:repo,
      title:"alias",goal:"alias",question:"q",copy:[],acceptance_cmd:"node code.mjs"},{...opts,revisions:2});
    assert.equal(r.shipped,false);
    assert.match(r.error.message,/symlink/);
    assert.equal(readFileSync(outside,"utf8"),"// host unchanged\n");
  });
});

test("a completed ship survives an export failure and resumes without another model turn", async () => {
  await withPipeline(async ({ repo, opts, calls }) => {
    const spec=specFor(repo),out=join(repo,"outputs","open-items",spec.key);
    mkdirSync(join(out,"artifact"),{recursive:true});
    writeFileSync(join(repo,"host-export-blocker"),"host unchanged");
    symlinkSync(join(repo,"host-export-blocker"),join(out,"artifact","beta.mjs"));
    const first=await runOpenItem(spec,opts);
    assert.equal(first.ok,false);
    assert.equal(first.shipped,true,"shipping already committed even though exporting failed");
    unlinkSync(join(out,"artifact","beta.mjs"));
    const before=calls.length;
    const resumed=await runOpenItem(spec,{...opts,resume:first.board});
    assert.equal(resumed.ok,true,JSON.stringify(resumed.error));
    assert.equal(resumed.shipped,true);
    assert.equal(calls.length,before,"an export retry must not invoke seats");
    assert.equal(applying.checkApply({key:spec.key,repoRoot:repo}).safe,true);
  });
});
