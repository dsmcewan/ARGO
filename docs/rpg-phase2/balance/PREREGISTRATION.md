# Mortal balance experiment 1.0.0

Preregistered before any engine outcome study. The owner chose **dangerous encounters with viable retreat**. The numerical thresholds below are the implementation team's measurable interpretation, not numbers supplied by the owner and not proof of fun. This protocol does not tune signed history or grant any model authority.

The first retained study uses **500 trials per partition per combat arm**, for 21,000 combat trials across 42 cells. Eight resource scenarios add 8,000 trials across the two partitions. The library default is 2,000 per cell for explicitly requested broader studies; the CLI defaults to this first study's 500. A separate ten-seed pilot publishes timings only. No outcome-dependent sample stopping, seed substitution, selective arm removal, or silent trial retry is permitted.

The machine specification is [protocol.json](../../../scenarios/tempted-fates/balance/protocol.json). Production experiment modules contain their own stable fixtures, never imports from TESTS. The public Ed25519 key is RFC8032's published test vector; no private key or production credential is used. Every input is explicitly labeled synthetic.

## Design

The primary matrix pairs classic d8 starting HP and `max(4,d8)`, armor11/12/14, and three policies. The player has Strength2, Constitution2 and a d6 melee weapon. The primary opponent is a single raider with HP4, Strength1, armor11 and d4 melee damage. Both have one ration/water allowance, so initial prepayment is real but does not make this combat test a hidden starvation experiment. Initial carried capacities fit. Armor is a preparation comparator; this experiment does not claim it was purchased affordably.

The three policies are fight until the encounter ends; retreat on the first own turn; and retreat on an own turn when `hp*2 <= max_hp`, otherwise fight. The threshold is fixed before results. A 1HP character has no injured-but-standing state, so this policy may offer no retreat opportunity; retain that result. Enemies attack the player and never acquire a hidden counter-retreat/pursuit rule. Three secondary cells repeat the policies against two raiders with classic HP and armor11. They are reported separately, not pooled into the primary target.

Training, heldout and pilot use distinct fixed SHA256 seed domains. Within a trial, all arms share the original HP draw and engine seed; floor4 transforms that same draw. HP sampling is fixture creation in a separate domain, not a substitute for authority dice. Common seeds do not guarantee aligned draws after policies diverge. Acting order and every combat/resource roll come exclusively from the actual `resolveMortal`. No shadow attack formula, bespoke initiative, artificial HP patch or selective random draw exists.

Every admitted or refused command is folded a second time through the same resolver; all transition digests and final states must match. This is deterministic pure-kernel replay, not signed-journal verification. Commands use the current returned sequence/head; the pure resolver intentionally leaves head unchanged. Journal signing and durable replay have separate tests.

## Endpoints and targets

Report standing, unconscious (HP0), dead (HP<0), escaped alive, victory and censorship separately. Encounter termination alone proves neither escape nor victory. Escape requires an admitted retreat and a standing terminal actor; victory requires all foes incapacitated and a standing player without retreat. Keep actions, charged rounds, started rounds, active/global seconds, resource balances, RNG count and exact seed-level digest. A final partial round counts the time actually charged by authority. Preserve original-d8 strata, especially the low-HP tail.

The primary unarmored classic target is:

- Fight-to-finish incapacitation between20% and60%.
- Immediate-retreat escape alive at least85%.
- Paired standing-survival advantage of immediate retreat over fight at least15 percentage points.

Wilson intervals summarize binomial rates; paired asymptotic normal intervals use differences within a seed, with improved/worsened/both/neither counts retained. Descriptive intervals use95%. Four one-sided target bounds use Bonferroni alpha=.05/4, z2.241402727604947. The dangerous range has two bounds; escape and paired advantage have one each. For heldout confirmation, this family applies to the frozen selected HP configuration; other matrix comparisons remain descriptive. These intervals model the fixed pseudorandom seeds as samples of the declared encounter distribution, not all campaigns or human choices. Means and confidence intervals are floating-point **analysis JSON only**, never canonical game events or integer-result digests.

Training retains classic if every adjusted target interval fits; otherwise floor4 is recommended only if all its intervals fit; otherwise report no-target-match. Intervals crossing a boundary are inconclusive, not rounded into success. Report floor4 and every armor/policy arm even when classic is retained. Heldout must not choose a new recommendation or justify tuning after observing results. Record the training report and generated decision before running it. A later rule/config change requires a new preregistered protocol and seed domain; keep the exposed heldout results.

A trial caps at500 accepted combat commands including begin, or after100 charged rounds. The engine may already have established the next round when that cap is checked; started and charged counts are reported separately. Censored trials are retained, and any combat censorship prevents a positive training recommendation. Unexpected reducer refusal, mutation or replay mismatch is a hard experiment error, not an unfavorable seed to replace. No table row is silently dropped.

## Resources

All scenarios have fixed finite action budgets and use legal resolver commands. Light compares a five-turn dark circuit with exactly five oil units versus four; insufficient return light must refuse without spending time/RNG. Search repeats once deliberately to prove per-actor discovery refusal, then consumes two finite forage units over legal four-hour work periods. Prepared needs buys finite food/water stock with real currency; the short policy crosses the second active-day boundary without resupply. Zero remaining inventory is distinct from actually missing a due payment. Rest first inflicts a configured travel hazard, reaches a prepaid boundary through waits, uses a safe eight-hour rest, tests immediate repeat refusal, then attempts the next rest with or without the next coverage period. Another actor's wait must not age the subject's active clock or spend their supplies.

Record every refusal and resulting state, completed objectives, health, exact time, remaining resources/stock/treasury and successful rest count. No stock or clock resets between actions. These scenarios test the declared boundaries, not a full economy, campaign longevity or optimal foraging strategy.

## Running and retaining evidence

Use Node24 with repository dependencies installed, after the real reducer is integrated and all relevant sources are committed. The CLI hashes the actual committed reducer, contracts, imported SYSTEMS schemas, dependency lock/manifests, balance modules and protocol, and retains the repository commit and Node version. It refuses uncommitted study source. Output files are exclusive; a `.started.json` remains on failure rather than silently allowing an unrecorded rerun.

```sh
node scenarios/tempted-fates/balance/cli.ts --phase pilot --output /owned/evidence/pilot.json
node scenarios/tempted-fates/balance/cli.ts --phase train --trials 500 --output /owned/evidence/train.json
# Inspect and retain train.json plus train.json.decision.json before the next command.
node scenarios/tempted-fates/balance/cli.ts --phase holdout --trials 500 --training /owned/evidence/train.json --decision /owned/evidence/train.json.decision.json --output /owned/evidence/holdout.json
```

Source fingerprints and trial counts must match the frozen training record. Reports are analysis artifacts, not proof of physical dice fairness, a production identity service, storage security, human enjoyment or a safe operational deployment. No paid model calls are used. This file records a plan, not outcomes; results are added only after actual execution.
