# Full foundation diagnostic, not complete application acceptance

At exact source `3c8ff55d872891014c89fe43515b3c28fd492626`, all 49 foundation files completed through unchanged `scripts/run-tests.mjs`: 567 named assertions, no failing tests, every file completed normally. Total runner time was 895.626 seconds, including clone/offline install. The source main HEAD was unchanged.

The retained diagnostic script differs from `docs/session-continuation/run-native-subset.py` only in its external allowance (1200 instead of 600 seconds). It uses the same read-only, network-unshared clone and native assertion/completion checks. The record includes the exact complete sorted file list and all log hashes. This is one group, not all ten application groups; it does not retroactively pass the earlier full-gate timeout or accept the later CLI/policy candidate.

Other author/reviewer processes ran concurrently during part of this measurement. A redundant author full-suite run was stopped and preserved separately as incomplete. This timing supports a bounded execution-budget repair; it is not an isolated performance benchmark, service latency guarantee or an assertion that every environment needs this duration. Final complete application and CI acceptance remain required.

To reproduce, install Node24 and Bubblewrap, supply a clean checkout containing the exact commit plus an offline npm cache, and invoke the retained script with `--repo`, `--candidate`, `--npm-cache`, a fresh `--output` directory and every path in `gate-result.json`'s `gate.files`. No provider calls or live credentials are used.
