#!/usr/bin/env node
// Acceptance oracle for a role card's "Known holes" section: DECLARE-THEN-VERIFY, not a checklist.
//
// A card that says a hole is open at HEAD X is an audit reference; the 2026-09-27 re-review found
// three holes on .claude/agents/controller.md that had been closed for hours (SHIP_ONLY, the TESTS
// gate's author check, blob re-hashing) plus a line citation that drifted. Reading cannot keep such a
// section true; running can. So the card must make every claim checkable and this script checks it:
//
//   1. `## Known holes at HEAD \`<sha>\`` names the HEAD it was audited against, and that sha must be a
//      prefix of $PANTHEON_HEAD (or --head) when one is given: an unpinned or stale pin FAILS.
//   2. Every numbered item under that heading carries a `probe: \`<shell command>\`` whose exit code 0
//      means "the hole reproduces". The probe is EXECUTED here, in the current directory. Exit non-zero
//      means the card claims an open hole that no longer reproduces: FAIL.
//   3. Every numbered item under `## Closed` (any heading starting with "## Closed") cites at least one
//      `tests/<name>.test.mjs`; the file must exist and `node --test <file>` must exit 0: a closure with
//      no executable evidence FAILS.
//   4. Every citation of the form `path:line` immediately followed by a parenthesised quote
//      (`docs/architecture.md:137 ("ship() is the only way ...")`) must find that quote on that line
//      of that file, comparing with backticks and whitespace collapsed: a drifted citation FAILS.
//
//   node scripts/card-check.mjs <card.md> [--head <sha>]      exit 0 = every claim verified
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const cardPath = argv.find(a => !a.startsWith("--") && a !== flag("--head"));
if (!cardPath) { console.error("usage: card-check.mjs <card.md> [--head <sha>]"); process.exit(2); }
const head = flag("--head") ?? process.env.PANTHEON_HEAD ?? null;
const text = readFileSync(cardPath, "utf8");
const lines = text.split("\n");
const problems = [], verified = [];
const norm = s => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

// Sections by "## " heading.
const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^## (.*)$/.exec(lines[i]);
  if (m) sections.push({ title: m[1], start: i, end: lines.length });
}
for (let i = 0; i + 1 < sections.length; i++) sections[i].end = sections[i + 1].start;
const body = s => lines.slice(s.start + 1, s.end).join("\n");
const items = s => {
  // numbered items: "1. **title**" ... up to the next number or end
  const out = []; let cur = null;
  for (const l of lines.slice(s.start + 1, s.end)) {
    const m = /^\s{0,3}(\d+)\.\s+(.*)$/.exec(l);
    if (m) { if (cur) out.push(cur); cur = { n: Number(m[1]), text: m[2] + "\n" }; }
    else if (cur) cur.text += l + "\n";
  }
  if (cur) out.push(cur);
  return out;
};

// 1. the HEAD pin
const holes = sections.find(s => /^Known holes at HEAD/.test(s.title));
if (!holes) problems.push("no `## Known holes at HEAD \\`<sha>\\`` section");
else {
  const pin = /Known holes at HEAD `?([0-9a-f]{7,40})`?/.exec(holes.title)?.[1];
  if (!pin) problems.push(`the Known holes heading names no sha: "${holes.title}"`);
  else if (head && !head.startsWith(pin)) problems.push(`Known holes are pinned to ${pin} but HEAD is ${head.slice(0, 12)}: the section is an audit of an older tree`);
  else verified.push(`pin ${pin}${head ? " matches HEAD" : " (no HEAD given to compare)"}`);

  // 2. every open hole reproduces
  const open = items(holes);
  if (!open.length) verified.push("no open holes claimed");
  for (const it of open) {
    const probe = /probe:\s*`([^`]+)`/.exec(it.text)?.[1];
    if (!probe) { problems.push(`open hole ${it.n} has no \`probe:\` command; an unprobed hole is an opinion`); continue; }
    const r = spawnSync("sh", ["-c", probe], { encoding: "utf8", timeout: 300_000 });
    if (r.status === 0) verified.push(`hole ${it.n} reproduces (probe exit 0)`);
    else problems.push(`open hole ${it.n} does NOT reproduce: probe exited ${r.status ?? r.signal}: ${probe}\n      ${(r.stdout + r.stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`);
  }
}

// 3. closures cite passing tests
const closed = sections.filter(s => /^Closed/i.test(s.title));
for (const s of closed) {
  for (const it of items(s)) {
    const tests = [...it.text.matchAll(/`?(tests\/[\w.-]+\.test\.mjs)`?/g)].map(m => m[1]);
    if (!tests.length) { problems.push(`closed item ${it.n} in "${s.title}" cites no tests/*.test.mjs`); continue; }
    for (const t of new Set(tests)) {
      if (!existsSync(t)) { problems.push(`closed item ${it.n} cites ${t}, which does not exist`); continue; }
      const r = spawnSync(process.execPath, ["--test", t], { encoding: "utf8", timeout: 300_000 });
      if (r.status === 0) verified.push(`closed item ${it.n}: ${t} passes`);
      else problems.push(`closed item ${it.n}: ${t} exits ${r.status}`);
    }
  }
}

// 4. quoted citations resolve
for (const m of text.matchAll(/`?([\w./-]+\.(?:md|mjs|json)):(\d+)`?\s*\(\s*"([^"]{6,})"\s*\)/g)) {
  const [, file, ln, quote] = m;
  if (!existsSync(file)) { problems.push(`citation ${file}:${ln} — file does not exist`); continue; }
  const target = readFileSync(file, "utf8").split("\n")[Number(ln) - 1] ?? "";
  if (norm(target).includes(norm(quote))) verified.push(`citation ${file}:${ln} resolves`);
  else problems.push(`citation ${file}:${ln} does not contain "${quote.slice(0, 60)}"; line reads: "${target.trim().slice(0, 80)}"`);
}

for (const v of verified) console.log(`ok    ${v}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`\n${verified.length} verified, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
