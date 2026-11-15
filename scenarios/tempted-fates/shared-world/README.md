# One headless Tempting Fates world

This local harness connects ordinary mortal dialogue, explicit loan terms, custody, exploration, combat and resources to one signed `shared-world/0.1.0` journal. It is a trusted local operator tool, not a remote authentication service or a player-facing game UI. Fate, lifespan and donor transactions remain in their separate frozen profile. The [seed notes](SEED.md) describe fresh campaign initialization; old worlds are never automatically migrated.

Use Node 24 and the repository's installed workspace dependencies. Every command requires an explicit private directory **outside this checkout**, including outside the main checkout when running from a linked worktree. Its parent must already exist. `init` and `demo` refuse an existing path; they never overwrite a world, including a partially initialized one.

```sh
node scenarios/tempted-fates/shared-world/cli.ts demo --dir /tmp/my-new-argo-world
node scenarios/tempted-fates/shared-world/cli.ts resume --dir /tmp/my-new-argo-world --actor hero
```

The demo uses a clearly labeled **injected offline response fixture** through the real model adapter; it makes no provider call. It records Melia's actual contextual model request privately, commits her proposed reply only after authority accepts it, then issues and explicitly accepts a separate structured loan. Conversation alone changes neither custody nor resources and creates no loan. The traveler borrows the lamp, spends two oil turns and 1200 seconds walking to the market and back, returns the lamp, retries the earlier exact acceptance, and restarts/replays the signed journal. Those deterministic fixture checks establish integration, not live model quality or balanced campaign play.

The model request is stored in `model-request.json` at mode 0600; it contains NPC-private context and is not ordinary actor output. The generated text appears in stdout only after its exact request's signed receipt verifies and a fresh scoped view still permits disclosure. Stale/rejected proposals are never presented as spoken dialogue. A later cutoff can suppress display even though the accepted receipt remains valid.

## Initialize your own fresh world

```sh
node scenarios/tempted-fates/shared-world/cli.ts init --dir /path/to/new-private-world --config /path/to/world-config.json
```

Configuration is a closed JSON object with all the [seed options](SEED.md) **except `seed` and `authority_public_key`**. The CLI generates a private random seed and an Ed25519 key pair once. For example:

```json
{
  "scope": {
    "tenant_id": "local", "rights_lane": "homebrew", "workspace_id": "table",
    "workspace_tenant_id": "local:homebrew:table", "campaign_id": "tempting_fates",
    "world_id": "my_world", "branch_id": "main"
  },
  "authority_key_id": "local_key", "referee_id": "local_referee", "npc_controller_id": "local_npc_host",
  "variant": "legend", "hp_mode": "floor4", "environment": "night", "starting_kit": "borrowed_lamp",
  "initial_knowledge_ids": ["melia_lamp_loan_offer"],
  "travelers": [{
    "id": "hero", "name": "The visitor", "controller_id": "local_hero", "weapon": "spear",
    "nature": {"description": "Practical and curious.", "priorities": ["return borrowed things"]},
    "presentation": {"occupation": "Traveler", "wants": "Find a safe route.", "will_not": "Accept a hidden debt."},
    "max_speech_characters": 1024
  }]
}
```

The private directory is 0700 and its files 0600: `genesis.json`, `manifest.json`, `signing-key.pem`, `ready.json`, `world.sqlite` and SQLite sidecars while open. Genesis includes the hidden RNG seed, controllers, profiles and source-backed policies; it is host-only. Do not publish this directory. Resume refuses symlink world/key/database files, unsafe permissions, incomplete initialization or a missing database. Source-checkout aliases through existing symlink parents are resolved before initialization. The filesystem and same-user operator remain trusted; this is not a sandbox against that operator.

Resume loads the saved genesis/key and verifies signed history. `--actor ID` and `--referee` are mutually exclusive, trusted local capabilities; either can be selected by someone who already controls the private files. They do not authenticate a remote player. Unknown options, extra fields and identity overrides in stdin fail. No provider credentials are read and no live client is constructed.

## JSON-lines operations

Each input line is at most one MiB. Nonblank lines are independent closed objects. A malformed/refused operation emits a bounded error row; processing continues and the eventual exit code is nonzero if any operation failed. The successful operations are:

| Input | Output |
| --- | --- |
| `{"op":"query"}` | `{"type":"query","query":...}` at the latest prefix. |
| `{"op":"view","query":...}` | A current actor-scoped view. A stale query is refused. |
| `{"op":"prepare","request_id":"ask_1","action":...}` | A `prepared` command bound to this principal and the current cursor. |
| `{"op":"submit","command":...}` | A `committed` exact-request receipt, optionally followed by visible `spoken` text. |

Pass the complete command returned by prepare unchanged to submit. A whisper action, for example, is:

```json
{"type":"speak","text":"May I borrow your lamp?","audience":{"kind":"whisper","addressed_actor_ids":["melia"]},"in_reply_to":null}
```

Referee sessions have no actor query/view. They can prepare and submit the documented referee actions, including encounter creation/recovery, knowledge activation/revocation and monotone mythic closure. Players cannot use them by adding a different principal or role to JSON. Ordinary mechanical commands use `{"type":"mortal","action":...}` with the existing mortal-v3 action grammar. Dialogue cannot offer a loan or run combat: those require separate explicit structured actions.

## Embedding the session

`@argo/session` exports `createWorldSession({genesis, ledger, principal})` and its types. The host must authenticate `principal` before construction. The returned object exposes `query()`, `view(query)`, `prepare(action, requestId)` and `submit(command)`. It fixes that identity, scope, complete genesis hash and signing trust. It owns no database, model, secondary state or writer. Its caller owns the injected ledger lifecycle.

Actor reads use the public scoped projector, preserving the storage-owned immutable snapshot fast path while fully validating raw injected data. Referee preparation validates a snapshot without inventing an actor view. Submit validates the exact command and forwards it before any current-prefix check so storage can recognize an exact old retry. It verifies both the receipt signature and exact command/principal request hash, request ID and resulting sequence. An authentic signature for another request is refused. Submit returns only a receipt; UI display remains a separate scoped-read decision.

After a dispatched request loses acknowledgment, it may already have committed. Reconcile the **same command/request ID** rather than inventing a replacement action. A stale new command must be explicitly prepared again following the caller's decision. Restart verifies the full journal; independent rollback protection requires a separately trusted `expectedHead` checkpoint when opening the public ledger. A colocated state/checkpoint file is not independent protection. The demo supplies its in-memory final cursor when reopening and compares full replay; normal CLI resume does not claim an external rollback anchor.

`TESTS/shared-world-session.test.ts` covers request binding, authentic foreign receipts, fixed identity, stale races, private observations, current closure, physical combat, signed restart, private CLI storage and the ordinary-process offline demo. All provider behavior in this pass is injected and offline.

## Explicit offline conversation

`talk-init` creates one durable conversation store for this existing world; `talk` opens it. Both require a fixed player, NPC and fixture file. They do not initialize another world or discover a provider.

```sh
node scenarios/tempted-fates/shared-world/cli.ts talk-init --dir /path/to/private-world --actor hero --npc melia --fixture /path/to/replies.json
node scenarios/tempted-fates/shared-world/cli.ts talk --dir /path/to/private-world --actor hero --npc melia --fixture /path/to/replies.json
```

The canonical sidecar is `WORLD/turns.sqlite`, with its own private SQLite worker. Creation is exclusive. Opening a missing, corrupt, foreign or differently bound store fails; it never silently creates a replacement. There is no store-path override. The CLI supports one player/NPC/policy binding per world directory, and both principals must match the saved genesis. The private world and sidecars retain the existing owner, file-type and 0700/0600 checks. Selecting these local capabilities does not authenticate a remote player.

The fixture is closed, bounded JSON data, not executable code:

```json
{
  "version": "shared-world-offline-fixture/1.0.0",
  "fixture_id": "melia_visit",
  "turns": [
    {"turn_id":"first", "player_text":"May I borrow the lamp?", "reply_text":"No fee or deposit. Buy your oil and agree when it comes back."},
    {"turn_id":"second", "player_text":"May I borrow the lamp?", "reply_text":"The terms are unchanged; no service or oath is required."},
    {"turn_id":"quiet", "player_text":"I will wait.", "reply_text":null}
  ]
}
```

Files are regular non-symlink UTF-8 JSON, at most one MiB, with 1–256 turns. Fixture and turn IDs use 1–64 safe ASCII identifier characters and exclude reserved object names. Turn IDs are unique; input text may repeat under different IDs. Text must be nonblank and fit the actual actor's speech cap; only reply text may be null. Unknown fields, duplicate IDs, oversized strings and invalid reply shapes fail. Input/reply text is never trimmed, interpolated or replaced by a fallback.

The complete canonical fixture and the versioned CLI fixture adapter determine the persisted provider-policy identity. Reopening with different fixture meaning, actor/NPC identities or resolved model policy fails. Formatting-only JSON changes keep the same identity. This declares the intended callback behavior; a hash is not proof about arbitrary host code. The pinned adapter uses one injected Responses-shaped client, low effort, a ten-second generation budget, 32 KiB context and 700 output tokens. It constructs no SDK, loads no arbitrary module and reads no provider credentials. It selects each row from the host's immutable turn/attempt context and verifies the actual focused model input before returning its strict text/null fixture response. Repeated identical input cannot select another turn's fixture through ambient mutable state.

Each conversation input line is a closed object:

| Input | Behavior |
| --- | --- |
| `{"op":"talk","turn_id":"first","text":"May I borrow the lamp?"}` | Start or join this exact durable turn. Unknown fixture IDs and changed exact text fail before turn or player dispatch. |
| `{"op":"continue","turn_id":"first"}` | Explicitly reconcile/resume an existing turn; never invent a missing turn or regenerate a consumed attempt. |
| `{"op":"status","turn_id":"first"}` | Read a fresh public result without driving work. A known fixture turn absent from the store returns null. |
| `{"op":"cancel","turn_id":"first"}` | Persist cancellation. It cannot undo a possible canonical commit or erase its receipt. |

Every new-mode result and error is labeled `mode:"offline_fixture"`; validated rows also identify the fixture and its hash. Turn rows contain the host's public result, including phase/outcome, verified receipts, and an optional delivery with stable `delivery_id`. They never expose private outbox commands, NPC context or pending model text. The output is evidence of integration with deterministic fixtures, not live dialogue quality.

Delivery is selected from the **player's fresh scoped view**, matching the actual committed NPC record. A reply may remain committed while cancellation, closure, eviction or a concurrent change suppresses text. Status and repeated reads repeat that projection, not cached outbox disclosure. `no_reply` does not prove intentional silence; `generation_uncertain` does not authorize regeneration. Conversation speech cannot create a loan, transfer custody or perform physical actions; use the separate explicit low-level session operations for those.

After restart or an ambiguous acknowledgment, reuse the same turn ID/input and use `continue` or `status`. A consumed generation attempt is never automatically repeated. EOF/host close is not durable cancellation of other callers; use `cancel` explicitly. The host, sidecar and caller-owned world journal close in that order. Losing or restoring both trusted local stores can lose attempt/silence tombstones; the sidecar is not an independent rollback anchor. A stable delivery ID permits consumer deduplication, but printing is not claimed exactly once.

All CLI modes now await each output, including errors and demo rows, before advancing input. The default writer waits for the stream write callback and propagates failure; it does not keep dispatching after a broken sink. Input lines and JSON config/fixture files are capped at one MiB. Complete encoded output lines, including wrappers, escapes and newline, are capped at 16 MiB and never truncated. An output failure after commit is an ambiguous display acknowledgment, so reconcile the existing turn rather than creating a new one.

`TESTS/shared-world-conversation-cli.test.ts` exercises actual host/store behavior, ordinary-process restart using private stdin/stdout/stderr file descriptors, fixture binding/preflight, repeated inputs, cancellation, closure/eviction, private output and backpressure. Existing `init`, `resume`, `demo` and low-level JSON operation shapes remain supported.
