import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgyCliTurn } from "../src/board/agy-cli.mjs";
import { cooldownPoolFor } from "../src/role/seating.mjs";

const withFake = async (body, fn, { card = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-agy-oauth-"));
  try {
    const cli = join(dir, "agy");
    writeFileSync(cli, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    if (card) {
      const cardDir = join(dir, ".agents", "agents", "pantheon-scout");
      mkdirSync(cardDir, { recursive: true });
      writeFileSync(join(cardDir, "agent.md"), "---\nname: pantheon-scout\ndescription: fixture\n---\n# Scout\n");
    }
    return await fn({ cli, dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const init = '{"event":"init","init":{"model":"fixture-model","agent":"pantheon-scout"},"conversation_id":"fixture-conversation"}';
const result = response => JSON.stringify({ event: "result", result: {
  status: "SUCCESS", conversation_id: "fixture-conversation", num_turns: 1,
  response, usage: { input_tokens: 1, output_tokens: 1 },
} });

test("OAuth CLI seat strips API-key env and accepts an observed model turn", async () => {
  const body = `if [ -n "$GEMINI_API_KEY" ]; then exit 31; fi
printf '%s\\n' '${init}' '${result("A scoped scout answer")}'`;
  await withFake(body, async ({ cli, dir }) => {
    const old = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "fixture-not-a-real-key";
    try {
      const seen = [];
      const turn = await runAgyCliTurn({ cli, repo: dir, worktree: dir, role: "scout",
        model: "fixture-model", prompt: "scout this", timeoutS: 5, onEvent: ev => seen.push(ev) });
      assert.equal(turn.text, "A scoped scout answer");
      assert.equal(turn.response_id, "fixture-conversation");
      assert.equal(seen.some(ev => ev.event === "seat.start"), true);
    } finally {
      if (old === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = old;
    }
  });
});

test("OAuth CLI seat rejects a timed-out empty SUCCESS envelope", async () => {
  const empty = JSON.stringify({ event: "result", result: {
    status: "SUCCESS", conversation_id: "fixture-conversation", num_turns: 0,
    response: "", usage: { input_tokens: 0, output_tokens: 0 },
  } });
  await withFake(`printf '%s\\n' '${init}' '${empty}'`, async ({ cli, dir }) => {
    await assert.rejects(
      runAgyCliTurn({ cli, repo: dir, worktree: dir, role: "scout",
        model: "fixture-model", prompt: "scout this", timeoutS: 5 }),
      /no completed model turn/i,
    );
  });
});

test("OAuth CLI seat refuses a missing role card before launching", async () => {
  await withFake(`printf '%s\\n' '${init}' '${result("A scoped scout answer")}'`, async ({ cli, dir }) => {
    await assert.rejects(
      runAgyCliTurn({ cli, repo: dir, worktree: dir, role: "scout",
        model: "fixture-model", prompt: "scout this", timeoutS: 5 }),
      /role card .* missing/i,
    );
  }, { card: false });
});

test("API-key cooldown cannot close the separate AGY OAuth subscription", () => {
  const seat = { vendor: "agy_google", pool: "agy_google" };
  assert.equal(cooldownPoolFor(seat, "sdk"), "agy_google");
  assert.notEqual(cooldownPoolFor(seat, "cli"), cooldownPoolFor(seat, "sdk"));
  assert.equal(cooldownPoolFor({ vendor: "xai", pool: "xai" }, "cli"), "xai");
});
