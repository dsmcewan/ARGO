# Character, campaign and mortal RPG release scope

On 2026-11-14 the owner explicitly requested: “Ok well let's push and merge then.” This delivery includes the completed local branch `argo/rpg-phase2`, whose implementation and retained evidence end at `a4a0dfa192dbdc8dfaf1cd184f7c057c153fb59a`, plus release documentation. The intended base is `main` at `100e6c2bb3b6f1a5a8ca07e7685f492b01c7f345`. The pull request and GitHub commit/check records establish the final delivery identity and status; this document does not predict that a merge has succeeded.

## Included work

- [All-campaign character memory and narration](../characters-runtime/README.md): authenticated speech and witnessed actions, observer-owned impressions, actor-scoped views, quiet character proposal callbacks and a separate world-external narrator adapter.
- [Tempting Fates campaign kit](../../CAMPAIGNS/Tempting_Fates/README.md): dark tragic Greek mythology, player/referee guides, atlas, encounters, strict campaign data, pure tabletop rules tools and attribution. The source scenario's voluntary gifts, separate Fate jurisdictions and post-anomaly boundary remain controlling.
- [Mortal authority](../rpg-phase2/README.md): additive `mortal-rules/0.2.0` contracts, deterministic combat/exploration/resource transitions, signed history, asynchronous SQLite storage, scoped views and fresh-world campaign initialization.
- [Balance evidence](../rpg-phase2/balance/RESULTS.md): 29,000 offline training/held-out trials, replay checks, retained uncertainty and censored-outcome accounting. The selected classic d8 option met the predefined dangerous-encounter/viable-retreat target. This does not establish human enjoyment or live dialogue quality.

## Dialogue and shared-context status

The character response interface carries traits/priorities, activity, private impressions, recent acquired experiences and the incoming addressed message. It accepts generated text or silence, but a production model-backed NPC `speak`/`interpret` adapter is not supplied. Fixed test replies verify plumbing only. The model-backed narrator remains a separate world-external presentation role.

The intended dialogue behavior is to interpret the incoming message using the character's own knowledge and nature, choose what to communicate or withhold, and produce a coherent response. An explicit per-turn communicative intention is not implemented. Campaign goals and richer room descriptions are not automatically fed into character dialogue. No live provider latency, tone or conversational-coherence result is claimed.

Rooms and routes have canonical definitions referenced by identity. Shared context must contain only established facts each recipient may know. A low ceiling and burning brazier can be shared facts; whether the room feels comforting or oppressive belongs to each observer. Agreement between observers does not promote an opinion into canon. Weather has no structured authoritative state or update contract yet.

Recommended next work is a versioned, scoped scene-context builder and NPC model adapter: reuse immutable factual definitions, preserve private reactions, deduplicate repeated nature revisions in model presentation without rewriting signed history, and select relevant promises/unfinished exchanges alongside recent conversation. The current actor reader selects the latest 16 acquired experiences, which can omit an older relevant commitment. Reduce repeated verified-history reconstruction and unnecessary generation while preserving disclosure/freshness checks. These recommendations are not implemented by this release.

## Verification and integration boundaries

The implementation's ten offline application gates previously passed at `bb7c838252f320548d47c6c433b0eb429afd8e70`; the [retained verification](../rpg-phase2/verification.json) binds that claim to its exact source and records subsequent evidence-only commits. Delivery requires fresh verification of the final committed candidate and the GitHub pull request checks. No paid model run or deployment is authorized by this release.

Historical `verification.json` files and Board snapshots deliberately retain their original “local candidate”, “main unchanged”, `VERIFYING` and `READY` statements. They describe the earlier preparation stage, not current GitHub delivery. In particular, RP-900's recorded refusal, `Candidate changes pinned gate policy`, remains a real refusal. Tests, workspace manifests and the lockfile are protected by the old controller policy. User-directed GitHub integration is not recorded as a successful Board/controller merge, and it does not update an externally pinned operational trust root or enable automatic dispatch.

The existing controller, tools, gate scripts, workflow, model client and frozen v1 contracts are unchanged. The separate review-repair branch is not silently included. Existing v1 review findings and the missing owner-supplied abuse-fragment material remain outside this delivery.

This is a headless library and campaign release. Mortal worlds and the older Fate/character/narrator authority profiles remain separate until a common identity, checkpoint and migration contract is defined. Production host authentication, signing-key custody, legitimate perception/entitlements and external rollback checkpoints remain required integrations. UI, voice, live NPC conversation, human playtesting and unattended production readiness are not claimed.
