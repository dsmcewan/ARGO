# Running an open item through the seats

One ticket, one or more file slots, one board. The human writes the oracle and the ticket; each
implementer owns a slot. The controller executes acceptance once over the combined change and takes
all slots through one `ship()` transaction.
Everything below was learned by running it on 2026-09-27 (open items 6, 7, 7b and 2); the templates in
`templates/` carry those lessons as comments.

## The order that works

1. **Oracle first.** Copy `templates/oracle.test.mjs.tmpl` to `tests/<name>.test.mjs`. Assert the
   property, not a proxy. Run it and record that it FAILS on the current code:

   ```bash
   node --test tests/<name>.test.mjs        # expected: not ok — this is the baseline
   ```

   Then grep the existing suite for anything that pins the state you are about to change and fix it
   yourself now. A seat may not edit tests, so a stale assertion costs the run all three revisions
   (open item 2: three revisions, 519 pass / 1 fail each, on one line in `tests/role-seating.test.mjs`).

   **Then run the whole suite yourself, with the new oracle in place, before you launch.** Every
   failure it shows must be one the implementer can fix by editing `path` alone. Two launches on
   2026-09-27 burned three revisions each on failures no seat could repair: a wrong byte count in my
   own oracle, and an unrelated oracle whose files the ticket's `copy` list never brought into the
   worktree. Compute literals; do not eyeball them. Scope `copy` to what the *acceptance command*
   reads — the full suite — not to what your change touches.

2. **Ticket.** Copy `templates/ticket.template.json` to `open-item-<n>-<slug>.json`. The `goal` is the
   whole design: a tool-less seat writes the file from that text and the current source alone. `copy`
   must bring everything the acceptance command needs into the worktree (`.agents` for the seating
   oracle, for instance).

3. **Launch.** Keys come from the Windows environment for the shell, never printed:

   ```bash
   bash -c 'source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh >/dev/null 2>&1; \
     node scripts/open-items-run.mjs --ticket scripts/tickets/open-item-<n>-<slug>.json \
       --seat planner=<vendor>/<model> --seat reviewer=<vendor>/<model>' \
     > ~/.claude/jobs/<job>/tmp/run-<slug>.log 2>&1
   ```

   `--seat role=vendor/model` is a declared operator reseat, recorded in `run.json`. Chairs and packs do
   not change; the occupant does. Law 3 is checked against LABS: the reviewer's lab must differ from
   both the maker's and the planner's, so with the Antigravity seat (vendor `agy_google`, Google's lab)
   reviewing, the planner cannot also be `agy_google`.

   **The Antigravity seat.** `--seat reviewer=agy_google/gemini-3.7-flash` runs `scripts/agy-seat.py` (the
   `google-antigravity` SDK Agent under `~/Projects/agentic-pipeline/sdk/.venv-antigravity`, needs
   `GEMINI_API_KEY` — the same credential the plain `agy_google` SDK calls use; see
   `docs/specs/2026-09-27-vendor-model-facts.md`'s "agy_google merge" note for why these were unified
   from two vendor identifiers into one). It holds read-only tools plus a shell over the worktree, one
   `pantheon-fact-checker` subagent, a budget, and hooks that append every tool call and subagent
   start/finish to the run's `progress.jsonl`. Its role text is `.agents/agents/pantheon-<role>/agent.md`,
   the same files the `agy` CLI loads with `--agent`. The machine's seat-plan gate expects the routing
   plan marker on any command that dispatches this seat: generate a plan with
   `~/.claude/skills/multi-model-seats/scripts/route-cli.mjs` and prefix the command with
   `SEAT_PLAN=<task_id>` at the very start (a leading shell assignment, outside any quotes). Do not
   hide the dispatch inside a wrapper script to avoid the gate; the marker is cheap and the record is
   the point.

4. **Watch.** The runner appends `outputs/open-items/<key>/progress.jsonl`; the overseer turns it into
   sentences and warns on silence:

   ```bash
   node scripts/overseer.mjs outputs/open-items/<key> --stall 150 --heartbeat 60 --giveup 1500
   ```

   Arm it from the Monitor tool so the lines land in chat. It exits on `run.end` / `run.error`; a file
   that carries a relaunch reopens on the later `run.start`.

5. **Resume the same ticket and board.** `--resume <board dir>` reads the board-local version-2
   `run.json`, rather than an output record another run may have overwritten. It verifies the exact
   ticket and every saved slot/ref/CID. Failed acceptance returns to revision; a late failure after
   passing acceptance reuses that byte-bound result. A completed board restores all certified exports
   without seat calls. Recovery before every slot has a saved artifact is refused explicitly. Legacy
   recovery records must be rebuilt; do not mark them version 2 by hand.

6. **Apply every certified file.** Successful exports are under
   `outputs/open-items/<key>/artifact/<path>`; refused/salvaged work is under `artifact-latest/`.
   From the target repository, run:

   ```bash
   node /path/to/pantheon/scripts/apply-artifact.mjs --key <key>          # check only
   node /path/to/pantheon/scripts/apply-artifact.mjs --key <key> --apply  # apply all slots
   ```

   Apply re-reads the immutable board, passing isolated repros, bound reviews, every exported hash
   and each destination's original bytes/existence. It validates the whole set before the first
   write and uses the verified buffers. Any changed destination or symlink refuses the set.
   Files are replaced individually; this is not a filesystem-wide atomic transaction. Stop concurrent
   editing while applying. Run the full applicable suite before closing the item in `STATE.md`.

## Acceptance boundary

Acceptance requires Linux Bubblewrap with user, mount, PID and network namespaces. The controller
probes the boundary before spending a vendor turn and never falls back to a host shell.
The child sees writable `/workspace`, private `/tmp` and `/dev`, a fresh `/proc`, and read-only
system runtime files under `/usr`. It receives fixed PATH/HOME/TMPDIR/LANG and `PANTHEON_HEAD`,
without inherited API keys, proxy settings, loader overrides or the operator's home directory.
Repository-contained symlinks in `copy` are dereferenced; links outside the target repository are refused.

The ticket's `copy` list must supply all project dependencies. Acceptance commands cannot access
host project paths, network services or nested user namespaces. Separate trusted infrastructure
checks that need those capabilities from generated-code acceptance; do not disable isolation to
make a ticket green. A passing command that changed an artifact's bytes does not certify the earlier
artifact. Wall time and output are bounded; memory and disk consumption are not independently capped.

## What the seats did, measured (2026-09-27)

| chair | body | on | result |
|---|---|---|---|
| scout | google `gemini-3.5-flash` | every run | 3–16 s, on point |
| scout | xai `grok-4.6` | every run | 13–23 s once told it has no tools; 82k chars of tool narration before that |
| planner | anthropic (all rungs) | runs 1 and item-2 relaunch | 429, subscription-side, no interval — twice, two hours apart |
| planner | xai `grok-4.6` / google `gemini-3.5-flash` | the rest | one `TITLE:` line in 3–5 s |
| implementer | openai `gpt-6-astra` | items 6, 7, 7b, 2 | 51 s–2 m 11 s per revision; the executed failure returned as the next brief is what fixes a revision |
| reviewer | xai `grok-4.7` | items 6, 7, 7b | 6–10 min with nothing visible, then a substantive verdict |
| reviewer | agy `gemini-3.7-flash` (SDK seat) | item 2, failing artifact | 32 s, 7 tool calls + 1 subagent, block finding naming the exact failing test, `request_changes` |
| reviewer | agy `gemini-3.7-flash` (SDK seat) | item 2, passing artifact | 48 s, 12 tool calls + 1 subagent, ran the suite itself, `approve`, shipped `123b769ea9f8` |
