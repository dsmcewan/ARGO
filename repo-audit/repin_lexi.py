#!/usr/bin/env python3
"""Record a newer LEXI commit as a separate source identity.

Reads a local Git checkout of LEXI that contains both commits. It never imports LEXI, runs its
code, touches a database or writes into the checkout. It writes only two new evidence files:

    evidence/LEXI-<short>-tree.json   complete recursive tree listing of the new commit
    evidence/lexi-repin-<short>.json  ancestry, path delta from the original pin, and blob checks

The original pin (c190e24...) and every catalog derived from it are left unchanged. Usage:

    git clone https://github.com/dsmcewan/LEXI <checkout>
    git -C <checkout> fetch --depth=60 origin <new commit>
    python3 -I repo-audit/repin_lexi.py <checkout> <new commit>
"""

import json
import subprocess
import sys
from pathlib import Path

ORIGINAL = "c190e245965447b369a33d928c4f09da33a68d67"
HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / "evidence"

# Files whose content underpins findings in REPO_INVENTORY.md. Each must still match the blob in
# source-manifest.json for that finding to carry over to the new commit without re-review.
FINDING_FILES = [
    "lexi-dashboard/backend/auth.py",
    "lexi-dashboard/backend/main.py",
    "lexi-dashboard/backend/companion_build.py",
    "lexi-dashboard/backend/model_fallback.py",
    "lexi-dashboard/backend/anthropic_credentials.py",
    "lexi-dashboard/backend/db_config.py",
    "lexi-dashboard/backend/db_session.py",
    "lexi-dashboard/backend/models.py",
    "lexi-dashboard/backend/prompt_builder.py",
    "scripts/program/lib/canonical-json.mjs",
]


def git(checkout, *args):
    return subprocess.run(["git", "-C", str(checkout), *args], check=True,
                          capture_output=True, text=True).stdout


def tree(checkout, commit):
    rows = []
    for line in git(checkout, "ls-tree", "-r", "-t", "--full-tree", "-z", commit).split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        mode, kind, sha = meta.split(" ")
        rows.append({"path": path, "mode": mode, "type": kind, "sha": sha})
    return sorted(rows, key=lambda r: r["path"])


def main(checkout, commit):
    checkout = Path(checkout)
    commit = git(checkout, "rev-parse", "--verify", commit + "^{commit}").strip()
    if commit == ORIGINAL:
        sys.exit("refusing: that is the original pin")
    git(checkout, "cat-file", "-e", ORIGINAL + "^{commit}")
    short = commit[:7]
    out_tree = EVIDENCE / f"LEXI-{short}-tree.json"
    out_repin = EVIDENCE / f"lexi-repin-{short}.json"

    original_tree = json.loads((EVIDENCE / "LEXI-tree.json").read_text())
    if original_tree["sha"] != ORIGINAL:
        sys.exit("refusing: retained LEXI-tree.json is not the original pin")
    manifest = {r["path"]: r for r in json.loads((EVIDENCE / "source-manifest.json").read_text())
                if r["repo"] == "LEXI"}

    new_tree = tree(checkout, commit)
    blobs = {r["path"]: r for r in new_tree if r["type"] in ("blob", "commit")}
    old_blobs = {r["path"]: r for r in original_tree["tree"] if r["type"] in ("blob", "commit")}

    ancestor = subprocess.run(["git", "-C", str(checkout), "merge-base", "--is-ancestor",
                               ORIGINAL, commit]).returncode == 0
    commits = git(checkout, "log", "--format=%H%x00%cI%x00%s", f"{ORIGINAL}..{commit}").splitlines()

    delta = []
    for path in sorted(set(blobs) | set(old_blobs)):
        old, new = old_blobs.get(path), blobs.get(path)
        if old and new and (old["sha"], old["mode"]) == (new["sha"], new["mode"]):
            continue
        delta.append({"path": path,
                      "status": "added" if not old else "deleted" if not new else "modified",
                      "old_blob_sha": old and old["sha"], "new_blob_sha": new and new["sha"],
                      "in_original_source_manifest": path in manifest})

    checks = []
    for path in FINDING_FILES:
        pinned = manifest.get(path, {}).get("expected_blob_sha")
        now = blobs.get(path, {}).get("sha")
        checks.append({"path": path, "original_blob_sha": pinned, "new_blob_sha": now,
                       "unchanged": pinned is not None and pinned == now})

    head = git(checkout, "show", "-s", "--format=%cI%x00%s%x00%T", commit).strip().split("\0")
    record = {
        "repo": "LEXI",
        "url": "https://github.com/dsmcewan/LEXI",
        "purpose": "Separate source identity. The original pin and its derived catalogs are unchanged.",
        "original_pin": ORIGINAL,
        "new_pin": commit,
        "new_pin_committed_at": head[0],
        "new_pin_subject": head[1],
        "new_pin_tree": head[2],
        "original_is_ancestor": ancestor,
        "commits_since_original": [dict(zip(("sha", "committed_at", "subject"), c.split("\0")))
                                   for c in commits],
        "tree_listing": out_tree.name,
        "blob_count": sum(1 for r in new_tree if r["type"] == "blob"),
        "path_delta": delta,
        "finding_file_checks": checks,
        "all_finding_files_unchanged": all(c["unchanged"] for c in checks),
        "method": "git ls-tree/log/merge-base on a read-only clone; no LEXI code executed",
    }
    out_tree.write_text(json.dumps({"sha": commit, "tree": new_tree}, indent=1) + "\n")
    out_repin.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {out_tree.relative_to(HERE.parent)} and {out_repin.relative_to(HERE.parent)}: "
          f"{len(delta)} changed path(s); finding files unchanged: {record['all_finding_files_unchanged']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
