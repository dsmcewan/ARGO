# Measured mortal balance: retain classic d8 HP

The preregistered training rule selected **classic 1d8 starting HP**, and the separately authorized held-out partition matched its target. For the specified unarmored one-raider encounter, held-out fight-to-finish incapacitation was **179/500 (35.8%)**, immediate-retreat escape alive was **461/500 (92.2%)**, and the paired standing-survival gain was **28.0 percentage points**. No rule, seed, policy, sample count or HP recommendation changed after training. This supports the declared dangerous-but-viable target for this fixture, not a general guarantee of survival or enjoyment.

The owner chose “dangerous encounters with viable retreat.” The implementation team—not the owner—defined the numerical acceptance ranges. Classic was selected because its training bounds matched; floor4 was retained as a comparator rather than substituted after looking at held-out results. This report does not alter existing worlds or authorize a retrospective HP change.

## Evidence and design

- [Preregistration, including pre-study review corrections](PREREGISTRATION.md) and [machine protocol](../../../scenarios/tempted-fates/balance/protocol.json).
- [Training report and complete per-seed rows](evidence/train-bb7c838.json), [frozen decision](evidence/train-bb7c838.json.decision.json), [training intent](evidence/train-bb7c838.json.started.json), and [log](evidence/train-bb7c838.log).
- [Held-out report and complete per-seed rows](evidence/holdout-bb7c838.json), [held-out intent](evidence/holdout-bb7c838.json.started.json), and [log](evidence/holdout-bb7c838.log).
- [Timing pilot and prior execution notes](evidence/README.md). The pilot is outside both outcome partitions.

Both outcome partitions used committed source `bb7c838252f320548d47c6c433b0eb429afd8e70` and source fingerprint `db0af69c416361853ac6384e6d2c6ac23b6b5207c1313f801623208ff1f6643f`. Node version and individual source hashes are retained in each report. Training ran once in 281.55 seconds; heldout ran once in 241.04 seconds. The training record was committed and its exact report/decision inspected before heldout began.

Each partition has **500 trials per cell**: 18 primary combat cells, three outnumbered cells and eight resource scenarios. Across both partitions, **21,000 combat trials and 8,000 resource trials** ran; every trial was folded through the actual `resolveMortal` again and matched all transition digests and final state. There were **zero censored trials, dropped rows, replay discrepancies or outcome-dependent retries**. Expected invalid resource actions are retained as refusals, not omitted trials.

The player has Strength 2, Constitution 2 and a d6 melee weapon. The primary raider has HP 4, Strength 1, armor 11 and d4 melee damage. Combatants have a ration and water allowance. Comparators change initial HP or armor, not authority rules. Classic and floor4 share each seed’s original d8 draw. Immediate retreat occurs on the first own turn; threshold retreat occurs on an own turn at HP≤half maximum, otherwise the actor attacks. Opponents attack deterministically. Escape is declared available in every combat fixture.

## Frozen primary target

The target is 20–60% fight incapacitation, at least 85% immediate escape alive, and at least 15 percentage points paired standing-survival advantage. Incapacitated means unconscious or dead; unconsciousness is not counted as death. Bounds below use the preregistered adjustment.

| Partition / HP | Fight incapacitated | Adjusted bounds | Immediate escape | Adjusted bounds | Paired standing gain | Adjusted bounds | Target |
| --- | ---: | --- | ---: | --- | ---: | --- | --- |
| Training / classic | 177/500 (35.4%) | 30.77–40.32% | 460/500 (92.0%) | 88.84–94.32% | 27.4 pp | 21.49–32.64 pp | match |
| Training / floor4 | 142/500 (28.4%) | 24.11–33.12% | 485/500 (97.0%) | 94.77–98.30% | 25.4 pp | 19.63–30.54 pp | match |
| Held out / classic | 179/500 (35.8%) | 31.16–40.72% | 461/500 (92.2%) | 89.07–94.49% | 28.0 pp | 22.05–33.26 pp | match |
| Held out / floor4 | 147/500 (29.4%) | 25.06–34.15% | 484/500 (96.8%) | 94.52–98.15% | 26.2 pp | 20.37–31.38 pp | match |

The held-out **classic** row is the confirmation of the frozen selection. Held-out floor4 is a predeclared descriptive comparator, not a second opportunity to choose a winner. The held-out report explicitly records `heldout-no-selection`.

Wilson score bounds describe binomial rates. The paired difference is p(improved)−p(worsened), using union-bounded marginal Wilson scores without assuming independent marginals. Four one-sided positive-confirmation bounds share the nominal .05 budget; the paired lower bound splits its .0125 share across two .00625 marginal tails. Displayed upper escape/paired endpoints are descriptive, not extra claims covered by that four-bound family. Wilson coverage is nominal, not an exact finite-sample guarantee. All means and confidence bounds are analysis-only floats; canonical game transitions and retained result digests remain integer data.

## All primary combat cells

Every row has 500 trials. Standing means terminal HP>0; U/D gives unconscious/dead counts. Escaped and won are distinct outcomes whose sum equals standing here. Mean rounds includes the authority’s six-second charge for a final partial round. Armor 11 is unarmored; armor 12 and 14 are prepared equipment comparators.

**Training**

| HP | Armor | Policy | Standing | U / D | Escaped / won | Total rounds | Mean rounds |
| --- | ---: | --- | ---: | --- | --- | ---: | ---: |
| classic | 11 | fight | 323 | 72 / 105 | 0 / 323 | 1119 | 2.238 |
| classic | 11 | immediate | 460 | 15 / 25 | 460 / 0 | 500 | 1.000 |
| classic | 11 | threshold | 393 | 48 / 59 | 162 / 231 | 977 | 1.954 |
| classic | 12 | fight | 341 | 67 / 92 | 0 / 341 | 1160 | 2.320 |
| classic | 12 | immediate | 469 | 9 / 22 | 469 / 0 | 500 | 1.000 |
| classic | 12 | threshold | 404 | 41 / 55 | 159 / 245 | 1009 | 2.018 |
| classic | 14 | fight | 382 | 44 / 74 | 0 / 382 | 1239 | 2.478 |
| classic | 14 | immediate | 473 | 8 / 19 | 473 / 0 | 500 | 1.000 |
| classic | 14 | threshold | 419 | 32 / 49 | 123 / 296 | 1098 | 2.196 |
| floor4 | 11 | fight | 358 | 77 / 65 | 0 / 358 | 1212 | 2.424 |
| floor4 | 11 | immediate | 485 | 15 / 0 | 485 / 0 | 500 | 1.000 |
| floor4 | 11 | threshold | 445 | 47 / 8 | 203 / 242 | 1029 | 2.058 |
| floor4 | 12 | fight | 376 | 70 / 54 | 0 / 376 | 1257 | 2.514 |
| floor4 | 12 | immediate | 488 | 12 / 0 | 488 / 0 | 500 | 1.000 |
| floor4 | 12 | threshold | 451 | 43 / 6 | 194 / 257 | 1063 | 2.126 |
| floor4 | 14 | fight | 418 | 46 / 36 | 0 / 418 | 1334 | 2.668 |
| floor4 | 14 | immediate | 490 | 10 / 0 | 490 / 0 | 500 | 1.000 |
| floor4 | 14 | threshold | 461 | 33 / 6 | 150 / 311 | 1143 | 2.286 |

**Held out**

| HP | Armor | Policy | Standing | U / D | Escaped / won | Total rounds | Mean rounds |
| --- | ---: | --- | ---: | --- | --- | ---: | ---: |
| classic | 11 | fight | 321 | 69 / 110 | 0 / 321 | 1086 | 2.172 |
| classic | 11 | immediate | 461 | 15 / 24 | 461 / 0 | 500 | 1.000 |
| classic | 11 | threshold | 384 | 50 / 66 | 147 / 237 | 961 | 1.922 |
| classic | 12 | fight | 340 | 67 / 93 | 0 / 340 | 1133 | 2.266 |
| classic | 12 | immediate | 464 | 15 / 21 | 464 / 0 | 500 | 1.000 |
| classic | 12 | threshold | 391 | 50 / 59 | 137 / 254 | 1011 | 2.022 |
| classic | 14 | fight | 374 | 53 / 73 | 0 / 374 | 1213 | 2.426 |
| classic | 14 | immediate | 471 | 12 / 17 | 471 / 0 | 500 | 1.000 |
| classic | 14 | threshold | 411 | 40 / 49 | 115 / 296 | 1086 | 2.172 |
| floor4 | 11 | fight | 353 | 87 / 60 | 0 / 353 | 1172 | 2.344 |
| floor4 | 11 | immediate | 484 | 16 / 0 | 484 / 0 | 500 | 1.000 |
| floor4 | 11 | threshold | 436 | 56 / 8 | 187 / 249 | 1010 | 2.020 |
| floor4 | 12 | fight | 368 | 79 / 53 | 0 / 368 | 1226 | 2.452 |
| floor4 | 12 | immediate | 484 | 16 / 0 | 484 / 0 | 500 | 1.000 |
| floor4 | 12 | threshold | 439 | 51 / 10 | 172 / 267 | 1059 | 2.118 |
| floor4 | 14 | fight | 403 | 61 / 36 | 0 / 403 | 1309 | 2.618 |
| floor4 | 14 | immediate | 487 | 13 / 0 | 487 / 0 | 500 | 1.000 |
| floor4 | 14 | threshold | 454 | 39 / 7 | 144 / 310 | 1133 | 2.266 |

The low-HP tail remains dangerous. The following held-out unarmored strata use the original d8 result, so floor4 and classic remain paired; these smaller subgroup counts are descriptive, not additional confirmatory targets.

| Original d8 | HP rule / policy | Trials | Standing | Escaped | Unconscious / dead |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | classic / fight | 55 | 13 | 0 | 14 / 28 |
| 1 | classic / immediate | 55 | 40 | 40 | 4 / 11 |
| 1 | classic / threshold | 55 | 13 | 0 | 14 / 28 |
| 1 | floor4 / fight | 55 | 31 | 0 | 11 / 13 |
| 1 | floor4 / immediate | 55 | 52 | 52 | 3 / 0 |
| 1 | floor4 / threshold | 55 | 44 | 24 | 9 / 2 |
| 8 | classic / fight | 48 | 44 | 0 | 2 / 2 |
| 8 | classic / immediate | 48 | 48 | 48 | 0 / 0 |
| 8 | classic / threshold | 48 | 48 | 14 | 0 / 0 |
| 8 | floor4 / fight | 48 | 44 | 0 | 2 / 2 |
| 8 | floor4 / immediate | 48 | 48 | 48 | 0 / 0 |
| 8 | floor4 / threshold | 48 | 48 | 14 | 0 / 0 |

At 1 HP, the half-HP threshold can never trigger while the character remains standing: any successful damaging hit incapacitates them. That policy therefore keeps fighting until victory or incapacitation. Floor4 removes that starting tail but is not necessary to meet this study’s frozen aggregate target.

Prepared armor 14 reduced classic fight incapacitation to 126/500 (25.2%) in heldout, compared with 179/500 (35.8%) unarmored. Equipment was supplied in these comparator fixtures; the study did not measure its purchase affordability.

## Outnumbered stress: two raiders

Classic HP and armor 11, again 500 trials per row. These cells were not pooled into the primary acceptance check.

| Partition | Policy | Standing | Unconscious / dead | Escaped / won | Total rounds | Mean rounds |
| --- | --- | ---: | --- | --- | ---: | ---: |
| Training | fight | 119 | 151 / 230 | 0 / 119 | 1249 | 2.498 |
| Training | immediate | 425 | 27 / 48 | 425 / 0 | 500 | 1.000 |
| Training | threshold | 277 | 95 / 128 | 209 / 68 | 1046 | 2.092 |
| Held out | fight | 98 | 154 / 248 | 0 / 98 | 1258 | 2.516 |
| Held out | immediate | 416 | 35 / 49 | 416 / 0 | 500 | 1.000 |
| Held out | threshold | 275 | 98 / 127 | 223 / 52 | 1010 | 2.020 |

In heldout, fighting both raiders left only 98/500 standing (19.6%); immediate retreat escaped 416/500 (83.2%). The one-raider viability result therefore must not be advertised as a guarantee when outnumbered. In these supplied fixtures, an actor reaching its eligible turn can retreat without an opportunity attack; reaching that turn is not guaranteed. A separate pursuit, blocked exit, stronger foe, different weapon or party tactic was not simulated.

## Finite resource scenarios

Each scenario has 500 trials per partition. Completion refers to its stated bounded objective; a deliberately under-supplied scenario failing that objective is a retained result, not a test error.

| Scenario | Objective completed train / heldout | Held-out standing / unconscious / dead | Held-out refusals | Held-out successful rests | Meaning |
| --- | --- | --- | ---: | ---: | --- |
| light_exact | 500 / 500 | 500 / 0 / 0 | 0 | 0 | Five oil units finish the five-turn circuit; none remains. |
| light_short | 0 / 0 | 500 / 0 / 0 | 500 | 0 | Four units leave one oil unit at the cave; the two-turn return is refused without spending more time/RNG. |
| search_forage | 500 / 500 | 500 / 0 / 0 | 1000 | 0 | Repeated search is refused after its first attempt; two finite forage units are consumed, then exhausted forage refuses. |
| needs_prepared | 500 / 500 | 500 / 0 / 0 | 500 | 0 | Finite purchases spend 3 obols and supply the second active day; stock reaches 0 and treasury records the payment. |
| needs_short | 0 / 0 | 463 / 37 / 0 | 0 | 0 | All lose HP from the missing ration/water assessment; some reach 0 HP. This fixture stops after one missed period. |
| rest_prepared | 500 / 500 | 500 / 0 / 0 | 500 | 1000 | Two legal 8h rests succeed with coverage; an immediate repeat refuses. |
| rest_short | 0 / 0 | 500 / 0 / 0 | 1000 | 500 | The first rest succeeds; the immediate repeat and next uncovered rest refuse. |
| clock_isolation | 500 / 500 | 500 / 0 / 0 | 0 | 0 | Another actor advances world time 4h; the subject spends 0 active seconds and retains its supplies. |

The short-needs arm left 31/500 unconscious in training and 37/500 in heldout; it caused no deaths because this specific 8 HP fixture undergoes only one pair of d4 missing-supply rolls. This does not make starvation nonlethal over later periods. Resource reports retain exact balances, stock/treasury totals, refusals, discovery state, active/global time and each seed’s outcome/hash. Zero inventory is distinguished from a due payment that could not be made.

## Limits and reproduction

- This is a fixed, small, disclosed encounter distribution with simple deterministic policies, not a broad tactical search or a human playtest. Armor affordability, multiple player cooperation, morale, grid positioning, stunts, spell effects and full campaign economy were not measured.
- Current authority permits retreat only on a standing actor’s eligible turn when escape is declared available. The actor remains at the same site, and round time/needs still apply; the experiment does not invent a free journey or ignore incoming turns.
- All mechanics, time, dice, needs and rest outcomes came from the production pure reducer. The replay evidence establishes deterministic command folds, not independent proof of dice fairness, journal signatures, database durability, authentication or safe deployment; those have separate reviews/gates.
- Common seeds pair alternatives without forcing their later draw streams to remain aligned. No trial was selected for a favorable roll. The training-prefix unit fixtures and pilot were reported separately; no held-out reducer outcome was inspected before its authorization.
- Current no-censorship result does not remove the guard: a future relevant censored pair makes that target inconclusive, and raw standing-at-cap is separate from terminal survival.
- Do not retune against this exposed held-out set. A later rule/configuration change needs a newly preregistered seed domain and retained prior results. The library’s 2,000-per-cell default was not silently substituted for the authorized 500-per-cell study.

Reproduce using the commands in the preregistration on the pinned source and fresh output paths. Reports include compact per-seed arrays; combine the listed columns with the enclosing arm/scenario ID to reconstruct exact result hashes. The original report, decision, start and log files remain unchanged.

| Artifact | SHA256 |
| --- | --- |
| [train-bb7c838.json](evidence/train-bb7c838.json) | `0100de2f92323a12ebd2af67f6b58d1b0838e8d763d2f3b84ab1fa60e92d5056` |
| [train-bb7c838.json.decision.json](evidence/train-bb7c838.json.decision.json) | `532fc2c927ee1f0b543fc02c13ba77510b63595d3057f9f65423362b99996608` |
| [train-bb7c838.json.started.json](evidence/train-bb7c838.json.started.json) | `13d48b035717db01aca5f07acf13b2a38a3e0ea012e6a5e7d3ca819a1289b9b4` |
| [train-bb7c838.log](evidence/train-bb7c838.log) | `8dccdb1e7b818eaa4346165f67eb67cefb865128a08cedee0cc52572c25da49d` |
| [holdout-bb7c838.json](evidence/holdout-bb7c838.json) | `366cfba4e5de8fda8b56fc14cd6a61c16e7d46a5d5d143f60e1bd190d13b2c51` |
| [holdout-bb7c838.json.started.json](evidence/holdout-bb7c838.json.started.json) | `2812e59d9d35de042e1f20ebc47d37f648b5c5add2d951bacb8791c132992148` |
| [holdout-bb7c838.log](evidence/holdout-bb7c838.log) | `9f96bb92ced62f4a825adc2de99728154da216cd9a500bed5211bad305f55360` |
