# MB-001: concurrent Mesh builds

The [usage guide](../../tools/MESH.md) covers the Python supervisor, Pantheon CLI, two-build fixture and limits. The [interface](INTERFACE.md) is the frozen coordination contract for this addition. [Profile](profile.json) and [verification](verification.json) distinguish worker protocol completion, staging-board acceptance and external application acceptance.

The source is [TELOS draft PR205](https://github.com/dsmcewan/TELOS/pull/205), pinned and audited in [source-audit.md](source-audit.md). Three read-only peers exchange complete per-attempt findings in bounded rounds; they cannot certify or merge a build. One author owns each leased worktree, and one supervisor admits up to eight simultaneous attempts. Existing Board path locks, immutable candidate/CAS checks and external controller remain authoritative.

Independent review found and repaired per-process peer identity misbinding, cancellation releasing the lock before Board threads settled, and incomplete Pantheon result-scope validation. Native regressions cover each; [policy review](policy-review.json) and [product review](independent-review.json) identify exact reviewed bytes. No paid model pipeline ran.
