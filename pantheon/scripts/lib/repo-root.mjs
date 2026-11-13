import { resolve } from 'node:path';

// A ticket's repo_root opts into targeting a project other than pantheon itself. Resolved against
// the pantheon repo (not process.cwd()) so a relative value behaves the same regardless of where
// the runner was invoked from. Falsy (undefined, null, '') means "no opt-in": defaults to pantheon,
// so every ticket written before this field existed keeps building pantheon exactly as before.
export function resolveRepoRoot(repo, specRepoRoot) {
  return specRepoRoot ? resolve(repo, specRepoRoot) : repo;
}
