// A pantheon ticket runner currently only ever builds pantheon itself (REPO is hardcoded to this
// script's own location). resolveRepoRoot is the one piece of logic that lets a ticket opt into
// targeting a different project -- everything else in open-items-run.mjs stays pointed at pantheon
// (its own tooling identity: role cards, PANTHEON_HEAD provenance, the ticket file's own location).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRepoRoot } from '../scripts/lib/repo-root.mjs';

test('with no repo_root, resolves to the pantheon repo itself (default, existing-ticket behavior)', () => {
  assert.equal(resolveRepoRoot('/home/colchis/Projects/pantheon', undefined), '/home/colchis/Projects/pantheon');
});

test('an absolute repo_root is used as-is', () => {
  assert.equal(resolveRepoRoot('/home/colchis/Projects/pantheon', '/home/colchis/Projects/lexi-orb'), '/home/colchis/Projects/lexi-orb');
});

test('a relative repo_root is resolved against the pantheon repo, not the process cwd', () => {
  assert.equal(resolveRepoRoot('/home/colchis/Projects/pantheon', '../lexi-orb'), '/home/colchis/Projects/lexi-orb');
});

test('an empty-string repo_root is treated as absent, not as "resolve to cwd"', () => {
  assert.equal(resolveRepoRoot('/home/colchis/Projects/pantheon', ''), '/home/colchis/Projects/pantheon');
});
