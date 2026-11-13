// Black-box acceptance suite for `pantheon` (bin/pantheon.mjs), driven purely as a subprocess.
//
// SCOPE AND METHOD: written WITHOUT reading src/, bin/pantheon.mjs, or the pre-existing tests/.
// Contract sourced from docs/specs/2026-09-27-pantheon-design.md §2, 6, 6.1-6.3, 12, plus
// behaviour observed only by running the CLI as a subprocess. Where observed behaviour diverges
// from what the spec requires, the test encodes the SPEC's requirement and is expected to FAIL —
// see .superpowers/sdd/2026-09-27-pantheon-seat-core/p2-blackbox-report.md (round 1) and
// p2-blackbox-report-round2.md (this round) for the write-ups.
//
// HISTORY (kept for authorship/traceability, not narrative colour):
// Round 1 found that `snapshot <vendor> <cwd>` / `verify-resume <vendor> <cwd> <record.json>`
// refused identity resolution for every (vendor, cwd) that had not been the target of a real,
// completed `turn` — making §6.2's RESUMED/NOT-RESUMED contract externally untestable without
// spawning a real vendor CLI, which this task forbids. That was confirmed as a real defect and
// fixed upstream: resolution moved to session identity, and both verbs gained a `purpose`
// positional (seats are now scoped like `turn`'s) and an explicit `--session-id <id>` escape
// hatch for exactly the no-seat-yet case this suite needs. Round 2 (this file) is written
// against that new interface. Only the arity/usage literals and the exit-code constants changed
// underneath these tests; every behavioural assertion from round 1 that could now be made
// reachable was kept, not weakened.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CLI = path.resolve(import.meta.dirname, '..', 'bin', 'pantheon.mjs');
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Make a fresh, isolated temp root with `ph` (PANTHEON_HOME) and `home` (HOME) subdirs. */
function makeFixtureRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-acceptance-${label}-`));
  const ph = path.join(root, 'ph');
  const home = path.join(root, 'home');
  fs.mkdirSync(ph, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { root, ph, home };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

/** Run the CLI as a subprocess. Never touches the real HOME or PANTHEON_HOME. */
function run(args, { home, ph, env = {}, cwd = REPO_ROOT, timeoutMs = 10_000 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH, // vendor CLIs may be on PATH; the CLI must not depend on them
      ...(home !== undefined ? { HOME: home } : {}),
      ...(ph !== undefined ? { PANTHEON_HOME: ph } : {}),
      ...env,
    },
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal,
  };
}

/** Recursively snapshot a directory tree as relPath -> "size:mtimeMs". Missing dir -> {}. */
function snapshotTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rel = path.join(entry.parentPath ?? entry.path, entry.name).slice(dir.length + 1);
    const full = path.join(dir, rel);
    const st = fs.statSync(full);
    out[rel] = `${st.size}:${st.mtimeMs}`;
  }
  return out;
}

/** Directory encoding observed from the CLI's own error text: '/' -> '-'. */
function encodeCwd(cwd) {
  return cwd.replace(/\//g, '-');
}

/** Write a synthetic claude-vendor transcript directly (bypassing any real vendor CLI). */
function seedClaudeConversation(home, cwd, turns, sessionId = crypto.randomUUID()) {
  const dir = path.join(home, '.claude', 'projects', encodeCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const t of turns) {
    lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: t.user }, sessionId }));
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: t.assistant }, sessionId }));
  }
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
  return sessionId;
}

/** Overwrite an existing session's transcript file in place with different content, same id. */
function overwriteClaudeConversation(home, cwd, sessionId, turns) {
  const dir = path.join(home, '.claude', 'projects', encodeCwd(cwd));
  const lines = [];
  for (const t of turns) {
    lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: t.user }, sessionId }));
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: t.assistant }, sessionId }));
  }
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

const USAGE_LINES = [
  'usage: pantheon <verb>',
  '  conform',
  '  turn <vendor> <purpose> <cwd> <prompt...>',
  '  snapshot <vendor> <purpose> <cwd> [--session-id <id>]',
  '  verify-resume <vendor> <purpose> <cwd> <record.json> [--session-id <id>]',
];

// Exit codes as printed by the CLI's own usage banner (0 ok/resumed, 1 not-resumed, 2 usage,
// 3 unknown-vendor, 4 identity-unresolvable, 5 refused-stale-seat). Named here so a change to
// the scheme breaks a readable assertion, not a bare magic number.
const EXIT = {
  OK: 0,
  NOT_RESUMED: 1,
  USAGE: 2,
  UNKNOWN_VENDOR: 3,
  IDENTITY_UNRESOLVABLE: 4,
  REFUSED_STALE_SEAT: 5,
};

function assertUsagePrinted(output) {
  for (const line of USAGE_LINES) {
    assert.ok(
      output.stdout.includes(line) || output.stderr.includes(line),
      `expected usage line ${JSON.stringify(line)} in stdout or stderr, got stdout=${JSON.stringify(output.stdout)} stderr=${JSON.stringify(output.stderr)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// conform
// ---------------------------------------------------------------------------

describe('conform', () => {
  test('succeeds, reports OK per vendor, exits 0, and writes nothing anywhere', () => {
    const { root, ph, home } = makeFixtureRoot('conform');
    try {
      const before = snapshotTree(home);
      const out = run(['conform'], { home, ph });
      assert.equal(out.status, EXIT.OK, `expected exit 0, got ${out.status}: ${out.stderr}`);
      assert.match(out.stdout, /claude/);
      assert.match(out.stdout, /codex/);
      assert.match(out.stdout, /grok/);
      assert.match(out.stdout, /agy/);
      assert.deepEqual(snapshotTree(ph), {}, 'conform must not write into PANTHEON_HOME');
      assert.deepEqual(snapshotTree(home), before, 'conform must not write into HOME');
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// Argument validation (all verbs) — must exit 2 with usage, write nothing
// ---------------------------------------------------------------------------

describe('argument validation', () => {
  const cases = [
    ['no verb at all', []],
    ['unknown verb', ['bogus-verb']],
    ['turn: no args', ['turn']],
    ['turn: vendor only', ['turn', 'claude']],
    ['turn: vendor+purpose only', ['turn', 'claude', 'purpose']],
    ['turn: missing prompt', ['turn', 'claude', 'purpose', '/tmp/somecwd']],
    ['snapshot: no args', ['snapshot']],
    ['snapshot: vendor only', ['snapshot', 'claude']],
    ['snapshot: vendor+purpose only (missing cwd)', ['snapshot', 'claude', 'purpose']],
    ['verify-resume: no args', ['verify-resume']],
    ['verify-resume: vendor only', ['verify-resume', 'claude']],
    ['verify-resume: vendor+purpose only (missing cwd)', ['verify-resume', 'claude', 'purpose']],
    ['verify-resume: vendor+purpose+cwd only (missing record.json)', ['verify-resume', 'claude', 'purpose', '/tmp/somecwd']],
  ];

  for (const [label, args] of cases) {
    test(`${label} -> usage, exit code 2, nothing written`, () => {
      const { root, ph, home } = makeFixtureRoot('argval');
      try {
        const out = run(args, { home, ph });
        assert.equal(out.status, EXIT.USAGE, `expected exit 2 for ${label}, got ${out.status}. stdout=${out.stdout} stderr=${out.stderr}`);
        assertUsagePrinted(out);
        assert.deepEqual(snapshotTree(ph), {}, `${label} must not write into PANTHEON_HOME`);
        assert.deepEqual(snapshotTree(home), {}, `${label} must not write into HOME`);
      } finally {
        cleanup(root);
      }
    });
  }
});

describe('trailing arguments (ambiguous — documented, not asserted as a defect)', () => {
  test('snapshot silently ignores a trailing extra argument instead of rejecting it as malformed', () => {
    // OBSERVATION (holds under the new arity too): `snapshot claude purpose <cwd> extra` does not
    // hit the usage/exit-2 path the way a too-few-arguments call does; it proceeds straight past
    // arity checking into identity resolution (and fails there, exit 4, for the unrelated reason
    // that no seat/--session-id was given). The assignment asks for "missing or malformed
    // arguments" to exit nonzero with usage — a stray trailing argument is arguably "malformed",
    // but the CLI treats arity as a floor, not an exact count. Documented as an ambiguity, not
    // asserted as a violation.
    const { root, ph, home } = makeFixtureRoot('trailing-arg');
    try {
      const out = run(['snapshot', 'claude', 'purpose', '/tmp/somecwd', 'extra'], { home, ph });
      assert.notEqual(out.status, EXIT.USAGE, 'a trailing extra argument is not routed through the usage/exit-2 path');
      assert.equal(out.status, EXIT.IDENTITY_UNRESOLVABLE, 'it falls through to identity resolution instead');
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown vendor — exits with the unknown-vendor code, does not spawn anything, writes nothing
// ---------------------------------------------------------------------------

describe('unknown vendor', () => {
  test('turn with an unknown vendor exits with the unknown-vendor code, without spawning anything, writes nothing', () => {
    const { root, ph, home } = makeFixtureRoot('unkvendor-turn');
    try {
      // Strip PATH so a real vendor binary could not be found even if the CLI tried to spawn one.
      const out = run(['turn', 'not-a-real-vendor', 'purpose', '/tmp/somecwd', 'hello'], {
        home,
        ph,
        env: { PATH: '/usr/bin:/bin' },
      });
      assert.equal(out.status, EXIT.UNKNOWN_VENDOR, `expected unknown-vendor exit code, got ${out.status}`);
      assert.match(out.stdout + out.stderr, /unknown vendor/i);
      assert.deepEqual(snapshotTree(ph), {});
      assert.deepEqual(snapshotTree(home), {});
    } finally {
      cleanup(root);
    }
  });

  test('snapshot with an unknown vendor exits with the unknown-vendor code, writes nothing', () => {
    const { root, ph, home } = makeFixtureRoot('unkvendor-snapshot');
    try {
      const out = run(['snapshot', 'not-a-real-vendor', 'purpose', '/tmp/somecwd'], { home, ph });
      assert.equal(out.status, EXIT.UNKNOWN_VENDOR, `expected unknown-vendor exit code, got ${out.status}: ${out.stdout}${out.stderr}`);
      assert.match(out.stdout + out.stderr, /unknown vendor/i);
      assert.deepEqual(snapshotTree(ph), {});
      assert.deepEqual(snapshotTree(home), {});
    } finally {
      cleanup(root);
    }
  });

  test('verify-resume with an unknown vendor exits with the unknown-vendor code, writes nothing', () => {
    const { root, ph, home } = makeFixtureRoot('unkvendor-verify');
    try {
      const recordPath = path.join(root, 'record.json');
      fs.writeFileSync(recordPath, JSON.stringify({ vendor: 'not-a-real-vendor', length: 1, head: 'ab' }));
      const out = run(['verify-resume', 'not-a-real-vendor', 'purpose', '/tmp/somecwd', recordPath], { home, ph });
      assert.equal(out.status, EXIT.UNKNOWN_VENDOR, `expected unknown-vendor exit code, got ${out.status}: ${out.stdout}${out.stderr}`);
      assert.match(out.stdout + out.stderr, /unknown vendor/i);
      assert.deepEqual(snapshotTree(ph), {});
      assert.deepEqual(snapshotTree(home), {});
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// grok / agy — spec §6.3 says their transcript stores are unconfirmed; snapshot must not
// silently proceed as if it had continuity for them.
// ---------------------------------------------------------------------------

describe('unconfirmed vendor stores (spec §6.3)', () => {
  for (const vendor of ['grok', 'agy']) {
    test(`snapshot ${vendor} refuses rather than fabricating continuity, writes nothing`, () => {
      const { root, ph, home } = makeFixtureRoot(`unconfirmed-${vendor}`);
      try {
        // Supply --session-id so the refusal under test is the §6.3 "unconfirmed store" one,
        // not the unrelated "no seat / no --session-id" identity-resolution refusal that would
        // otherwise fire first and mask it.
        const out = run(['snapshot', vendor, 'purpose', '/tmp/somecwd', '--session-id', crypto.randomUUID()], { home, ph });
        assert.notEqual(out.status, EXIT.OK, `${vendor} must not report success for an unconfirmed store`);
        assert.match(out.stdout + out.stderr, /unconfirmed/i);
        assert.deepEqual(snapshotTree(ph), {});
        assert.deepEqual(snapshotTree(home), {});
      } finally {
        cleanup(root);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Nothing is written outside PANTHEON_HOME across a representative command sequence
// ---------------------------------------------------------------------------

describe('write containment (spec §2, "Trustworthy operation")', () => {
  test('a representative command sequence writes only inside PANTHEON_HOME', () => {
    const { root, ph, home } = makeFixtureRoot('containment');
    try {
      // Seed HOME with a plausible vendor store so read paths are exercised, not just misses.
      const encoded = encodeCwd('/tmp/somecwd');
      fs.mkdirSync(path.join(home, '.claude', 'projects', encoded), { recursive: true });
      const beforeHome = snapshotTree(home);
      const beforeRepo = snapshotTree(path.join(REPO_ROOT, 'tests'));

      run(['conform'], { home, ph });
      run(['turn', 'claude', 'purpose'], { home, ph }); // arg-validation failure
      run(['turn', 'not-a-real-vendor', 'purpose', '/tmp/somecwd', 'hi'], { home, ph }); // unknown vendor
      run(['snapshot', 'claude', 'purpose', '/tmp/somecwd'], { home, ph }); // identity-resolution failure
      run(['snapshot', 'claude', 'purpose', '/tmp/somecwd', '--session-id', crypto.randomUUID()], { home, ph }); // no such transcript
      run(['verify-resume', 'claude', 'purpose', '/tmp/somecwd', path.join(root, 'nope.json')], { home, ph });

      assert.deepEqual(snapshotTree(home), beforeHome, 'HOME must be untouched by this sequence');
      assert.deepEqual(
        snapshotTree(path.join(REPO_ROOT, 'tests')),
        beforeRepo,
        'the repo tree must be untouched by this sequence',
      );
      // PANTHEON_HOME may legitimately gain files; that is the one place writes are allowed.
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// Exit code distinctness (spec-implied, item 8 of the assignment)
//
// Round 1 found these buckets collapsed onto shared exit codes. That was fixed upstream (see
// history note at the top of this file). These are now regression tests guarding the fix, kept
// under their original heading so a future collapse is caught the same way the first one was.
// ---------------------------------------------------------------------------

describe('exit code distinctness', () => {
  test('bad-arguments (usage) uses a distinct code from an unknown vendor for turn', () => {
    const { root, ph, home } = makeFixtureRoot('exitcodes-turn');
    try {
      const badArgs = run(['turn', 'claude'], { home, ph });
      const unknownVendor = run(['turn', 'not-a-real-vendor', 'p', '/tmp/somecwd', 'hi'], { home, ph });
      assert.equal(badArgs.status, EXIT.USAGE);
      assert.equal(unknownVendor.status, EXIT.UNKNOWN_VENDOR);
      assert.notEqual(
        unknownVendor.status,
        badArgs.status,
        '`turn` must report "unknown vendor" with a different exit code than malformed ' +
          "arguments/usage, so a caller can distinguish \"you typo'd the verb shape\" from " +
          '"you named a vendor pantheon does not support" without parsing prose.',
      );
    } finally {
      cleanup(root);
    }
  });

  test('unknown-vendor and identity-unresolvable use distinct codes for snapshot', () => {
    const { root, ph, home } = makeFixtureRoot('exitcodes-snapshot');
    try {
      const unknownVendor = run(['snapshot', 'not-a-real-vendor', 'purpose', '/tmp/somecwd'], { home, ph });
      const neverTurned = run(['snapshot', 'claude', 'purpose', '/tmp/somecwd'], { home, ph });
      assert.equal(unknownVendor.status, EXIT.UNKNOWN_VENDOR, `expected unknown-vendor code, got ${unknownVendor.status}`);
      assert.equal(neverTurned.status, EXIT.IDENTITY_UNRESOLVABLE, `expected identity-unresolvable code, got ${neverTurned.status}`);
      assert.notEqual(
        neverTurned.status,
        unknownVendor.status,
        'snapshot must report "unsupported vendor" (a config-time fact) and "no session id, ' +
          'take a turn first" (a runtime/state fact) with different exit codes, per the ' +
          "assignment's own bar (item 8).",
      );
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// CONTRACT (spec §6.2) — now reachable via --session-id without running a real `turn`.
// ---------------------------------------------------------------------------

describe('CONTRACT (spec §6.2)', () => {
  test('1. snapshot then verify-resume on an unchanged conversation reports RESUMED', () => {
    const { root, ph, home } = makeFixtureRoot('contract-resumed');
    try {
      const cwd = '/tmp/contract-resumed-cwd';
      const sessionId = seedClaudeConversation(home, cwd, [
        { user: 'please review the auth module', assistant: 'looked at it, found one issue' },
        { user: 'fix it', assistant: 'fixed, tests pass' },
      ]);

      const snap = run(['snapshot', 'claude', 'purpose', cwd, '--session-id', sessionId], { home, ph });
      assert.equal(snap.status, EXIT.OK, `spec §6.2 requires snapshot to succeed on an existing conversation. Got exit ${snap.status}: ${snap.stdout}${snap.stderr}`);
      const record = JSON.parse(snap.stdout);
      assert.equal(record.session_id, sessionId);
      assert.equal(record.length, 4);

      const recordPath = path.join(root, 'record.json');
      fs.writeFileSync(recordPath, snap.stdout);
      const verify = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.equal(verify.status, EXIT.OK, `expected RESUMED (exit 0). Got exit ${verify.status}: ${verify.stdout}${verify.stderr}`);
      assert.match(verify.stdout, /RESUMED/);
    } finally {
      cleanup(root);
    }
  });

  test('2. verify-resume against a DIFFERENT, SAME-LENGTH conversation under the same session id reports NOT RESUMED, caught by content (not length)', () => {
    // Deliberately reuses ONE session id throughout, so the session-id-match check (a metadata
    // comparison, not a content one) cannot be what catches this. The live transcript at that
    // session id is overwritten in place with different content of the SAME turn count after
    // the record is taken, simulating spec §6.2's "a different conversation is rejected on
    // prefix hash mismatch" case from the spike this spec cites.
    const { root, ph, home } = makeFixtureRoot('contract-different');
    try {
      const cwd = '/tmp/contract-different-cwd';
      const sessionId = seedClaudeConversation(home, cwd, [
        { user: 'summarize the incident report', assistant: 'root cause was a race in the retry loop' },
        { user: 'draft the postmortem', assistant: 'draft attached, five action items' },
      ]);

      const snap = run(['snapshot', 'claude', 'purpose', cwd, '--session-id', sessionId], { home, ph });
      assert.equal(snap.status, EXIT.OK, `setup requires snapshot to succeed. Got exit ${snap.status}: ${snap.stdout}${snap.stderr}`);
      const record = JSON.parse(snap.stdout);
      const recordPath = path.join(root, 'record.json');
      fs.writeFileSync(recordPath, snap.stdout);

      // Same session id, same turn COUNT (2 turns), deliberately different text.
      overwriteClaudeConversation(home, cwd, sessionId, [
        { user: 'plan the release notes', assistant: 'three features, two fixes, one breaking change' },
        { user: 'ship it', assistant: 'tagged v2.3.0 and published' },
      ]);

      const verify = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.equal(verify.status, EXIT.NOT_RESUMED, `expected NOT RESUMED. Got exit ${verify.status}: ${verify.stdout}${verify.stderr}`);
      assert.match(verify.stdout + verify.stderr, /NOT RESUMED/);
      assert.match(verify.stdout + verify.stderr, /turns=4/, 'live and recorded turn counts must be equal — length cannot be what caught this');
      assert.match(verify.stdout + verify.stderr, /recorded=4/);
      assert.doesNotMatch(
        verify.stdout + verify.stderr,
        /length/i,
        'a length-based reason string would indicate the mismatch was caught by count, not content',
      );
    } finally {
      cleanup(root);
    }
  });

  test('3. a record with length: 0 must not verify anything', () => {
    const { root, ph, home } = makeFixtureRoot('contract-zerolength');
    try {
      const cwd = '/tmp/contract-zerolength-cwd';
      const sessionId = seedClaudeConversation(home, cwd, [{ user: 'hello', assistant: 'hi' }]);
      const recordPath = path.join(root, 'record.json');
      fs.writeFileSync(recordPath, JSON.stringify({ vendor: 'claude', length: 0, head: '', session_id: sessionId }));
      const verify = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.equal(verify.status, EXIT.NOT_RESUMED, `a length:0 record must not verify. Got exit ${verify.status}: ${verify.stdout}${verify.stderr}`);
      assert.match(verify.stdout + verify.stderr, /NOT RESUMED/);
    } finally {
      cleanup(root);
    }
  });

  test('4. a tampered record (valid shape, wrong head) must not verify', () => {
    const { root, ph, home } = makeFixtureRoot('contract-tampered');
    try {
      const cwd = '/tmp/contract-tampered-cwd';
      const sessionId = seedClaudeConversation(home, cwd, [
        { user: 'one', assistant: 'two' },
        { user: 'three', assistant: 'four' },
      ]);
      const snap = run(['snapshot', 'claude', 'purpose', cwd, '--session-id', sessionId], { home, ph });
      assert.equal(snap.status, EXIT.OK, `setup requires snapshot to succeed. Got exit ${snap.status}: ${snap.stdout}${snap.stderr}`);

      const record = JSON.parse(snap.stdout);
      record.head = crypto.createHash('sha256').update('tampered').digest('hex');
      const recordPath = path.join(root, 'record.json');
      fs.writeFileSync(recordPath, JSON.stringify(record));

      const verify = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.equal(verify.status, EXIT.NOT_RESUMED, `a tampered head must not verify. Got exit ${verify.status}: ${verify.stdout}${verify.stderr}`);
      assert.match(verify.stdout + verify.stderr, /NOT RESUMED/);
    } finally {
      cleanup(root);
    }
  });

  test('5. (new behaviour, per §6.1 binding) verify-resume refuses a record taken against a DIFFERENT session id, reporting NOT RESUMED with that reason', () => {
    // This is the check the team lead flagged as new, distinct from test 2: test 2 catches two
    // conversations sharing ONE session id by content hash; this test catches a record whose
    // session id flatly does not match the seat's — a metadata check, not a content one, and it
    // must fire before any hash comparison is attempted.
    const { root, ph, home } = makeFixtureRoot('contract-session-mismatch');
    try {
      const cwd = '/tmp/contract-session-mismatch-cwd';
      const sessionA = seedClaudeConversation(home, cwd + '-a', [{ user: 'hi', assistant: 'hello' }]);
      const sessionB = seedClaudeConversation(home, cwd, [{ user: 'hi', assistant: 'hello' }]);

      const snapA = run(['snapshot', 'claude', 'purpose', cwd + '-a', '--session-id', sessionA], { home, ph });
      assert.equal(snapA.status, EXIT.OK, `setup requires snapshot to succeed. Got exit ${snapA.status}: ${snapA.stdout}${snapA.stderr}`);
      const recordPath = path.join(root, 'record-a.json');
      fs.writeFileSync(recordPath, snapA.stdout);

      // Verify record A (session A) against the live conversation at `cwd`, identified as session B.
      const verify = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionB], { home, ph });
      assert.notEqual(verify.status, EXIT.OK, `expected NOT RESUMED. Got exit ${verify.status}: ${verify.stdout}${verify.stderr}`);
      assert.match(verify.stdout + verify.stderr, /NOT RESUMED/);
      assert.match(verify.stdout + verify.stderr, new RegExp(sessionA), 'reason should name the record\'s session');
      assert.match(verify.stdout + verify.stderr, new RegExp(sessionB), 'reason should name the seat\'s session');
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// NEW FINDING (round 2): verify-resume crashes instead of failing closed on bad record.json input
// ---------------------------------------------------------------------------

describe('FINDING: verify-resume does not fail closed on a malformed record.json', () => {
  // The assignment's item 5 requires "missing or malformed arguments exit nonzero with usage".
  // record.json is read as file content rather than a shell argument, but the same bar applies:
  // bad input from outside the process should produce a controlled, nonzero-exit error, not an
  // uncaught exception with a raw stack trace on stderr. All three cases below currently exit 1
  // (Node's default uncaught-exception status) with a stack trace, not "NOT RESUMED"/a usage
  // message — indistinguishable, by exit code alone, from a legitimate not-resumed verdict, and
  // a stack trace is not the kind of stable, parseable output item 8 asks for either.
  function seedOneSession(home, cwd) {
    return seedClaudeConversation(home, cwd, [{ user: 'hi', assistant: 'hello' }]);
  }

  test('nonexistent record.json path exits nonzero WITHOUT an uncaught-exception stack trace', () => {
    const { root, ph, home } = makeFixtureRoot('badrecord-missing');
    try {
      const cwd = '/tmp/badrecord-missing-cwd';
      const sessionId = seedOneSession(home, cwd);
      const out = run(['verify-resume', 'claude', 'purpose', cwd, path.join(root, 'does-not-exist.json'), '--session-id', sessionId], { home, ph });
      assert.notEqual(out.status, 0, 'a missing record file must not report RESUMED');
      assert.doesNotMatch(
        out.stderr,
        /at file:\/\/.*bin\/pantheon\.mjs|at ModuleJob\.run|SyntaxError|Error: ENOENT/,
        `FINDING: a missing record.json crashes with an uncaught exception instead of a controlled error. stderr=${out.stderr}`,
      );
    } finally {
      cleanup(root);
    }
  });

  test('malformed JSON in record.json exits nonzero WITHOUT an uncaught-exception stack trace', () => {
    const { root, ph, home } = makeFixtureRoot('badrecord-malformed');
    try {
      const cwd = '/tmp/badrecord-malformed-cwd';
      const sessionId = seedOneSession(home, cwd);
      const recordPath = path.join(root, 'bad.json');
      fs.writeFileSync(recordPath, 'not json');
      const out = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.notEqual(out.status, 0, 'malformed JSON must not report RESUMED');
      assert.doesNotMatch(
        out.stderr,
        /SyntaxError|at ModuleJob\.run/,
        `FINDING: malformed JSON in record.json crashes with an uncaught SyntaxError instead of a controlled error. stderr=${out.stderr}`,
      );
    } finally {
      cleanup(root);
    }
  });

  test('valid JSON but missing required fields exits nonzero WITHOUT an uncaught-exception stack trace', () => {
    const { root, ph, home } = makeFixtureRoot('badrecord-shape');
    try {
      const cwd = '/tmp/badrecord-shape-cwd';
      const sessionId = seedOneSession(home, cwd);
      const recordPath = path.join(root, 'wrongshape.json');
      fs.writeFileSync(recordPath, JSON.stringify({ foo: 'bar' }));
      const out = run(['verify-resume', 'claude', 'purpose', cwd, recordPath, '--session-id', sessionId], { home, ph });
      assert.notEqual(out.status, 0, 'a wrong-shape record must not report RESUMED');
      assert.doesNotMatch(
        out.stderr,
        /at ModuleJob\.run|Error: verifyExtends/,
        `FINDING: a record missing required fields crashes with an uncaught Error instead of a controlled error. stderr=${out.stderr}`,
      );
    } finally {
      cleanup(root);
    }
  });
});
