# Deterministic merge controller

`npm run gate` checks frozen JSON Schema, generated types, TypeScript, event replay, process bounds, and isolation. It hashes the candidate before and after execution and rejects concurrent edits. `--merge-ready` additionally requires a clean committed tree. Model review is advisory and cannot replace any check.

For subsequent worker merges, run `controller/merge.mjs` from a separately trusted checkout. Set `ARGO_CONTROLLER_TRUSTED_SHA` to an operator-approved immutable ARGO foundation commit outside the candidate workspace, then pass `--repo`, `--candidate`, and `--trusted`. The controller requires a clean target checkout, rejects unsafe staging symlinks and any difference from the trusted test oracles, controller, schema freeze, type configuration and pinned dependency manifests, installs with lifecycle scripts disabled (set `ARGO_NPM_CACHE` to a prepopulated dependency cache for fully offline installs), and runs the gate in a network-isolated Bubblewrap environment. It permits only a fast-forward of the exact candidate after the gate passes and the target remains unchanged. It never reads model approval text.

The first foundation merge bootstraps this trust root through the user's authorized repository work. A candidate cannot nominate its own trust root; maintain that environment binding in the operator/CI configuration. Contract changes need a separately reviewed version migration and an updated trusted policy. Old contract hashes cannot be edited to waive their own checks.

CI runs the deterministic checks on every push/pull request. Required-check/branch-protection enforcement is GitHub repository configuration; a workflow file alone cannot prevent an administrator bypass. No such GitHub setting has been claimed or changed here. Automated worker merges should use this controller and disjoint paths in `OWNERSHIP.json`.

The parent test runner requires every trusted named test to complete, so an imported candidate exiting with code zero before registering tests is a refusal. Protected policy changes require a separately authorized trust-root update; they are never overlaid for testing and then silently merged untested.

Before installation, extracted files are compared with the raw Git tree: every path, blob, executable bit and symlink target must match. Archive substitutions or omissions from `.gitattributes` are refused, as are submodules. The tree tested is therefore the tree selected for the fast-forward.
