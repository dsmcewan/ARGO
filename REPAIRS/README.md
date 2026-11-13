# Review repair batch

This is the live repair batch for the 2026-11-13 review. The immutable seed is `repair_seed.json`; exact task scopes are under `tickets/`. Twelve contained findings are assigned to five disjoint local peer lanes. Four migration/storage decisions remain blocked on T-R900. Paid model runs remain off.

The supervisor initializes the existing SQLite engine with this seed and keeps leases/heartbeats, path ownership and audit events in `/workspace/ARGO/.board/`. The database and capabilities are excluded from Git. `BOARD.md` is a sanitized exported snapshot; the live view is `.board/BOARD.md`.

The existing engine protects its gate policy against ticket changes and supports only data validators. These application/control-plane repairs therefore cannot self-certify through that adapter. Claims are real; final acceptance is explicitly blocked pending separately reviewed controller evidence and policy migration. No direct SQL status edits or invented vendor verdicts are permitted. Candidate progress and external verification are recorded in `RESOLUTIONS.md` and `acceptance/`.
