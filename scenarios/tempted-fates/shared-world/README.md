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
