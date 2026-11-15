# Authored actor knowledge 1.0 and dialogue supplement 0.2

Status: Phase A contract candidate for coordinator review. This is an additive presentation contract. It neither changes the frozen campaign pack 0.1 or character-memory 1.0 schemas nor authorizes a runtime rollout.

An authored policy belongs to one actor. Melia may describe the lamp terms she offers; that description is not evidence that a traveler accepted, owes money, owns the lamp or acquired any knowledge. This first catalog profile supports only ordinary-item `offer_policy` entries with explicit loan terms. It does not encode global facts, observed memories, rumors, private impressions, referee secrets or contractual obligations. Additional kinds need a reviewed successor contract.

## Closed records and provenance

`knowledge.schema.json` is strict draft 2020-12. All records are closed and all fields required; nullable fields are explicit. `dialogue-knowledge-types.ts` mirrors the public definitions. Guards reject proxies without invoking traps, accessors, symbols, cycles, nonplain objects, sparse/decorated arrays, unsafe numbers, excessive depth, nodes or UTF-8 content before reading caller properties.

| Record | Meaning |
| --- | --- |
| `AuthoredSourceManifest` | Versioned allowlist of source IDs, repository-relative Markdown paths, complete document SHA-256, inclusive one-based line locators and excerpt SHA-256. |
| `AuthoredKnowledgeCatalog` | Curated actor-owned policies, bound to an exact campaign pack hash and source manifest hash. |
| `AuthoredKnowledgeActivation` | Persisted host binding: complete rights/world/branch scope, owner, catalog and manifest hashes, acquired sequence/head/world time, and allowed knowledge IDs. |
| `AuthoredKnowledgeDisclosure` | Current host grant: exact complete actor query, both source hashes, activation hash and selected IDs. Its literal basis declares host entitlement and ancestor-membership attestation. |
| `AuthoredKnowledgeRead` | Query plus nullable persisted activation and current disclosure. Missing either produces no knowledge. |
| `AuthoredKnowledgeView` | Exact selected policies and only their referenced source metadata, bound to the query, all trusted identities and activation/acquisition. |
| `DialogueSupplementV2` | `character-dialogue/0.2.0`: the existing actor and shared scene fields plus nullable, separately owned `actor_knowledge`. |

The bundled `authored-sources.json` pins QUICKSTART's lamp terms, ENCOUNTERS' cost lines and its exit/custody line. These files are outside the campaign pack, so `hash(pack)` alone cannot authenticate them. An entry references allowlisted source IDs; it never invents an authoritative event ID. Its honest provenance kind is `authored_actor_policy`.

`AuthoredLoanTerms` records fee, advance deposit, replacement value, actual-damage repair by explicit agreement and cap, borrower-supplied oil price/duration, explicitly agreed return checkpoint, and absence of compulsory service or oath. Repair cap cannot exceed replacement value. The initial Melia catalog must encode the authored zero fee/deposit, five-obol replacement/repair cap and one-obol oil lasting six exploration turns. No helper may infer acceptance or move custody.

## Trusted host boundary

These guards establish passive shape and exact bindings. JSON fields, matching hashes and the grant's `basis` string do **not** prove identity, entitlement, persistence or ancestry. The host authenticates its actor query and grant issuer, verifies the current journal prefix and supplies a previously persisted activation. A model, client or arbitrary repository document must never choose the trusted pins or issue its own grant.

`TrustedKnowledgeIdentity` supplies canonical SHA-256 of the exact reviewed catalog, manifest and pack. At runtime a campaign adapter must compare against fixed bundled reviewed assets, or content independently verified against trusted pins. Accepting attacker-chosen content and attacker-chosen pins together does not authenticate anything. No guard reads a file path; supplied paths identify allowlisted provenance only.

`assertAuthoredSourceBytes` verifies supplied UTF-8 document strings against an independently trusted manifest hash. It requires the exact set of referenced documents, rejects missing/extra/duplicate paths, and hashes both full documents and selected excerpts. The excerpt is `content.split('\n').slice(start_line - 1, end_line).join('\n')`: no appended newline or newline normalization. CRLF bytes remain part of each line. Source IDs are unique and multiple excerpts of one document must agree on its complete SHA.

## Activation and migration

Run `assertKnowledgeActivationRegistration` once with the verified **current** actor query. Activation's complete scope, owner and acquired cursor must match exactly. Persist this checked binding through trusted host storage before use. At new-world setup, a verified current sequence-zero cursor may register initial knowledge. Adding the catalog to an existing world acquires at that world's current sequence/head/time, never sequence zero or an earlier event. A source update requires a new reviewed identity and explicitly registered activation; reads must not rebuild or re-date either automatically.

Acquisition sequence and world time must both be no later than the read query. Equal-sequence reads require the entire cursor to match. For an older sequence, the current host disclosure attests that its recorded head is an ancestor of the exact query head; these contracts cannot derive ancestry from two hashes. Policy validity is a separate half-open interval `[from_tick, until_tick)`; `null` means no upper validity bound and does not waive acquisition limits.

This additional trusted host state is **not reconstructible from the existing journal alone**. Missing persisted activation, missing current grant or an empty selected-ID list means no authored knowledge; a nonempty view is rejected. Malformed supplied bindings are rejected, even if the other binding is absent. Revocation is represented by withholding/emptying the current grant, not deleting historical ledger data. The host must refresh disclosure on retries and after generation so a changed query, activation, content identity or selection suppresses late output.

## API and validation order

Import directly from `packages/contracts/src/dialogue-knowledge.ts` until the coordinator publishes the additive exports. The TypeScript records live in `dialogue-knowledge-types.ts`.

```ts
assertAuthoredKnowledgeContract(name, unknownValue)
assertKnowledgeCatalogIdentity(catalog, manifest, trustedPins)
assertKnowledgeActivationRegistration(catalog, manifest, trustedPins, activation, currentQuery)
assertKnowledgeReadBinding(catalog, manifest, trustedPins, read)
assertKnowledgeViewBinding(view, catalog, manifest, trustedPins, read)
assertAuthoredSourceBytes(manifest, suppliedDocuments, trustedManifestHash)
```

The generic assertion narrows to its named public type. Binding guards return `void`, do not mutate or freeze caller objects, and throw `ArgoError` on invalid data. Each exported entry point validates passive data before dereferencing inputs. `authoredKnowledgeSchema` is a deeply frozen schema export.

1. Verify authored source bytes during trusted bundle preparation or loading. Pin reviewed manifest/catalog/pack identities independently.
2. At registration, validate exact current activation; persist it once.
3. At read, validate the complete exact query and independently issued grant against pinned content and persisted activation. Selected IDs must exist, belong to the actor, be activated, and be valid at query time.
4. Build a view using selected catalog entries in **catalog order**, and referenced source definitions in **manifest order**. Verify that complete view with `assertKnowledgeViewBinding`. No unselected entry, source definition, invented text or changed term may appear.
5. Put the view in supplement 0.2's `actor_knowledge`, with identical complete query and pack hash. This field stays distinct from shared room descriptions and acquired character memories.

Shape validation of a standalone supplement or view is not a substitute for steps 1–4. Authored text is bounded content, never executable instructions. The generator must label it as the actor's offer policy, preserve source attribution and avoid converting an offer into accepted debt or canonical state.

## Limits and compatibility

Catalogs contain at most 64 policies; each policy has at most 2,048 Unicode code points of text and eight source references. A manifest has at most 32 sources. Activations select at most 64 policies; a current grant/view selects at most eight. Documents contain at most 131,072 Unicode code points. A guard argument is also bounded to 30,000 traversed values, 32 levels and 1 MiB of UTF-8 keys/string content. IDs are bounded safe ASCII identifiers; paths must be relative Markdown paths without traversal, URLs or backslashes.

Supplement 0.1 keeps its original exact field set and behavior; adding `actor_knowledge` to 0.1 remains invalid. A 0.2 supplement must explicitly include nullable `actor_knowledge`. No legacy object is silently upgraded. The subsequent runtime phase will use packet version 0.2 only when supplied the new supplement, preserve old 0.1 packets, include only selected actor-owned claims, and bind refresh/cache identity to that version. No campaign-private knowledge, referee notes, variants or sample dialogue are implicitly imported. Existing silence and post-ANOMALY cutoffs remain mandatory.

Dedicated tests cover source bytes, pins, closed records, exact registration/read/view bindings, owner/scope/cursor isolation, acquisition/validity, missing and empty grants, passive-data attacks and preservation of historical frozen profiles. Runtime helper integration and an injected-provider request showing Melia's actual terms are Phase B acceptance work, not claims made by this contract commit.
