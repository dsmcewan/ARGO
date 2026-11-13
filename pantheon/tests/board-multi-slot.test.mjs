import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOpenItem } from "../src/board/run-item.mjs";

// A whole run, end to end, with no vendor credentials: every seat answers from a script keyed by
// what the prompt asks for. This is the only way to prove the multi-slot path actually works --
// the single-slot suite passing proves only that the old path is unbroken.
function scriptedClients() {
  const calls = [];
  let n = 0;
  const answerFor = prompt => {
    if (/VERDICT/i.test(prompt)) return "looks right\n\nVERDICT: approve";
    if (/TITLE:/i.test(prompt)) return "TITLE: the fixture change";
    if (/RAN: nothing/i.test(prompt)) return "nothing known.\n\nRAN: nothing";
    const m = prompt.match(/Output ONLY the complete new contents of (\S+)/);
    return `// built: ${m ? m[1] : "unknown"}\nexport const ok = true;\n`;
  };
  return {
    calls,
    // A real Responses STREAM, not a plain object: the pipeline streams every SDK turn (that is
    // how the overseer can say "still writing" instead of nothing), so a fake that returns a
    // finished object never exercises the path the pipeline actually takes.
    // All three surfaces, because a run touches all three: openai/xai stream through
    // `responses`, anthropic (the planner's whole ladder) through `messages`, google through
    // `models.generateContentStream`. A fake covering only one surface dies at the first seat
    // that isn't on it -- which is how this fixture found out the planner is anthropic.
    makeClientFor: vendor => {
      const record = req => {
        const prompt = String(req.input ?? req.messages?.at(-1)?.content ?? req.contents ?? "");
        calls.push({ vendor, model: req.model, prompt });
        return answerFor(prompt);
      };
      return {
        responses: {
          create: async req => {
            const text = record(req);
            const id = `resp_${++n}`;
            const response = { id, output_text: text, output: [{ type: "message", content: [{ type: "output_text", text }] }] };
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "response.created", response: { id } };
                yield { type: "response.output_text.delta", delta: text };
                yield { type: "response.completed", response };
              },
            };
          },
        },
        messages: {
          create: async req => {
            const text = record(req);
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "content_block_delta", delta: { type: "text_delta", text } };
                yield { type: "message_stop" };
              },
            };
          },
        },
        models: {
          generateContentStream: async req => {
            const text = record(req);
            return {
              async *[Symbol.asyncIterator]() { yield { text }; },
            };
          },
        },
      };
    },
  };
}

const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-multislot-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const THREE_SLOTS = [
  { slot: "alpha", path: "alpha.mjs", goal: "write alpha", model: "gpt-6-astra" },
  { slot: "beta", path: "beta.mjs", goal: "write beta", model: "gpt-6-sol" },
  { slot: "gamma", path: "gamma.mjs", goal: "write gamma", model: "gpt-6-luna" },
];

async function runThree(dir, extra = {}) {
  mkdirSync(join(dir, "seed"), { recursive: true });
  writeFileSync(join(dir, "seed", "keep.txt"), "seed\n");
  const { makeClientFor, calls } = scriptedClients();
  const events = [];
  const result = await runOpenItem({
    key: "multiFixture", repo_root: dir, title: "a three-file change",
    goal: "the whole change", copy: ["seed"], acceptance_cmd: "true", question: "q",
    slots: THREE_SLOTS, ...extra,
  }, {
    dir: join(dir, "board"),
    makeClientFor,
    scouts: ["xai"],                 // no Antigravity venv in a test environment
    // planner AND implementer: same reason, 2026-09-29. SEATING's new agy_google top rungs
    // (operator instruction) bypass makeClientFor -- agyTurn spawns its own process -- so this
    // scripted fake can never answer for either. Pinned to the vendors this fixture's `messages`/
    // `responses` stream surfaces were already built to serve (see scriptedClients()'s own comment).
    seatOverrides: {
      planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture on the scripted client" },
      implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture on the scripted client" },
    },
    progress: e => events.push(e),
  });
  return { result, calls, events };
}

test("three slots each get their own implementer, writing three different files", async () => {
  await withTmp(async dir => {
    const { result, events } = await runThree(dir);
    assert.equal(result.error, null, `run failed: ${JSON.stringify(result.error)}`);

    const wrote = events.filter(e => e.event === "wrote");
    assert.deepEqual(wrote.map(e => e.slot).sort(), ["alpha", "beta", "gamma"],
      "every slot must be written, each by its own implementer turn");

    // The files really exist in the worktree, with the content that implementer produced.
    for (const s of THREE_SLOTS) {
      const f = join(result.board, "worktree", s.path);
      assert.ok(existsSync(f), `${s.path} was never written`);
      assert.match(readFileSync(f, "utf8"), new RegExp(`built: ${s.path}`),
        `${s.path} holds another slot's content -- the implementers were not isolated`);
    }
  });
});

test("the per-slot model choice is what actually reaches the vendor call", async () => {
  await withTmp(async dir => {
    const { calls } = await runThree(dir);
    const implCalls = calls.filter(c => /Output ONLY the complete new contents of/.test(c.prompt));
    // The trailing "." belongs to the sentence, not the filename: "...contents of alpha.mjs. No
    // prose before or after". A bare \S+ swallows it.
    const byFile = Object.fromEntries(implCalls.map(c => [
      c.prompt.match(/Output ONLY the complete new contents of ([^\s.]+(?:\.[^\s.]+)*)/)[1], c.model,
    ]));
    // This is the decision the ticket deferred: which openai rung builds which file.
    assert.equal(byFile["alpha.mjs"], "gpt-6-astra");
    assert.equal(byFile["beta.mjs"], "gpt-6-sol");
    assert.equal(byFile["gamma.mjs"], "gpt-6-luna");
  });
});

test("acceptance runs ONCE over the combined change, not once per slot", async () => {
  await withTmp(async dir => {
    const { events } = await runThree(dir);
    const runs = events.filter(e => e.event === "acceptance.start");
    assert.equal(runs.length, 1,
      "per-slot acceptance would grade each implementer against a tree the others were still writing");
  });
});

test("every slot gets its own critique, because ship gates review per artifact", async () => {
  await withTmp(async dir => {
    const { events } = await runThree(dir);
    const verdicts = events.filter(e => e.event === "verdict" && e.slot);
    assert.deepEqual([...new Set(verdicts.map(e => e.slot))].sort(), ["alpha", "beta", "gamma"],
      "a multi-slot change with one critique would be refused by the REVIEW gate, correctly");
  });
});

test("all three slots ship in ONE transaction, not three partial ships", async () => {
  await withTmp(async dir => {
    const { result, events } = await runThree(dir);
    const staged = events.filter(e => e.event === "staged");
    assert.equal(staged.length, 1, "the controller stages every slot onto one ref before shipping");
    const ship = events.filter(e => e.event === "ship");
    assert.equal(ship.length, 1, "one ship transaction covers the whole change");
    assert.equal(result.shipped, true, `did not ship: ${ship[0]?.detail}`);
    assert.match(ship[0].detail, /alpha/);
    assert.match(ship[0].detail, /beta/);
    assert.match(ship[0].detail, /gamma/);
  });
});

test("a single-slot ticket still runs the way it always did", async () => {
  await withTmp(async dir => {
    mkdirSync(join(dir, "seed"), { recursive: true });
    writeFileSync(join(dir, "seed", "keep.txt"), "seed\n");
    const { makeClientFor } = scriptedClients();
    const events = [];
    const result = await runOpenItem({
      key: "singleFixture", repo_root: dir, title: "one file", goal: "g",
      slot: "solo", path: "solo.mjs", copy: ["seed"], acceptance_cmd: "true", question: "q",
    }, { dir: join(dir, "board"), makeClientFor, scouts: ["xai"], progress: e => events.push(e),
      // Same 2026-09-29 reason as runThree() above: keep this fixture on the scripted client.
      seatOverrides: {
        planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture on the scripted client" },
        implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture on the scripted client" },
      } });

    assert.equal(result.error, null, `run failed: ${JSON.stringify(result.error)}`);
    assert.equal(result.shipped, true);
    assert.equal(events.filter(e => e.event === "staged").length, 0,
      "a one-slot run needs no staging ref and should not create one");
  });
});
