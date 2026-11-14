# Retained campaign verification evidence

The exact full-gate candidate is `12229dec115abb8d34c5abba987530fbeda3daa8`. [verification.json](../verification.json) maps local author commits to commits reachable on this feature branch and binds code/data hashes. Final status documentation does not retroactively change a reviewed commit.

| Evidence | Result / scope |
| --- | --- |
| [Full application gate](full-gate/gate-result.json) | All ten groups passed; immutable candidate in offline read-only Bubblewrap clone; no merge |
| [Rules review](argo-tf200-review.json) | 12 tests and 40,570 independent assertions; retained Knave first-edition attribution and adaptation checked |
| [Catalog review](argo-tf300-review.json) | 18 tests, five freeze tests and 64 ordinary-process probes; private fields and invalid passive inputs refused |
| [Campaign review](argo-tf-campaign-review.json) | Nine books and world data checked; routes, rumor assessments, budgets and 159 narrative strings agree |
| [State issue](argo-tf-phase2-review.json) / [fix verification](argo-tf-phase2-fix-review.json) | Exclusive item custody now agrees in TypeScript and JSON; compile-negative and runtime regressions pass |
| [Real-ledger integration](argo-tf-integration-green.log) | Five tests pass: authored pack, fixed variants, private disclosure/custody/replay, book links and proposed state grammar |
| [Board submissions](argo-tf-board-submissions.json) | Four lanes VERIFYING; integration manifest-policy refusal retained, no fabricated acceptance |

Reviewers are separate native Codex peers using the same model. Their conclusions are advisory and bounded, not human/cross-vendor certification. No live RPG table, model provider or deployed authentication service was tested.

## Reproduce

Use the immutable gated checkout with Node24, Python3.11+ and the locked dependencies. Run `npm ci --ignore-scripts` in the root and in `pantheon/`, then `node scripts/gate.mjs --merge-ready`. Set up local dependencies offline where required. This command tests a clean checkout; only the separately trusted controller can authorize integration.

`stage-gate.py` retains the exact disposable-clone wrapper used here: supply `--repo`, the full `--candidate`, `--npm-cache` and `--output`. It runs only local Git/npm operations and the network-unshared, read-only Bubblewrap gate. It cannot merge or promote a trust root. Review this wrapper before running it in a privileged environment.

Rules probes: `node argo-tf200-review-probes.mjs /path/to/checkout`. Catalog probes: `node argo-tf300-probes.mjs /path/to/checkout`. The campaign checker accepts the checkout path; the Phase2 type probe intentionally fails on the fixed type. Old review logs retain their original exact scratch paths; [original-path-map.json](original-path-map.json) maps their bytes to portable local copies. Replace the path in a probe if necessary. The licensed Knave PDF remains in the existing evidence bundle; its temporary text extraction is reproducible and is not duplicated here.

[manifest.json](manifest.json) binds every retained evidence file. SHA-256 identities show which bytes were inspected; they do not grant operational authority or authenticate a hostile test author. Known baseline trust/storage limitations are unchanged.
