# Pure shared authority ownership

`../rules.ts` exports only the frozen pure APIs: `initialWorldState`, `resolveWorld`, and `worldStateHash`. `../view.ts` exports `viewWorldActor`. The engine performs no persistence, clock reads, model work or callbacks. Its immutable outputs represent a valid deterministic transition, not evidence that a journal committed it.

Private journal integration lives in `ownership.ts`:

```ts
ownWorldGenesis(input: WorldGenesis): WorldGenesis;
withWorldHead(state: WorldState, head: string): WorldState;
```

Own genesis once in the journal/worker and retain that returned object. Raw mutable inputs undergo full contract validation, canonical detachment and deep freezing. Only the exact owned return is registered; the original input, a clone, a caller-frozen object or a matching claimed hash gains no trust. Public raw State input likewise undergoes the complete genesis-bound guard before an owned copy is registered. Shape/binding validation is not proof of signed current-prefix membership; the host/journal must supply that verified prefix.

`withWorldHead` requires an exact privately registered state. It accepts exactly 64 lowercase hexadecimal characters, changes only cursor.head, preserves the cached state hash (which omits head), and shares immutable subtrees/indexes. Sequence-zero head must remain the full shared genesis hash. It rejects unregistered states even if deeply frozen. No caller-supplied state hash, trust flag or registration function exists.

The engine privately indexes complete request/record history, NPC replies, acquired memory, latest impressions and offer/loan identities. Each successful transition derives new indexes without mutating old state or forks. No mutable cache Map/Set escapes. Read helpers expose only immutable records or booleans. Cache publication follows successful pure resolution; the storage lane must publish its authoritative state pointer only after its atomic COMMIT.

Owned immutable subtrees carry exact JSON byte/value/depth measurements. New State and complete Resolution growth still enforce the frozen 16 MiB, 500000-value and depth-32 budgets without rescanning old semantic history. State additionally reserves 64 bytes for a bounded snapshot RPC wrapper. Storage must separately check its actual complete encoded envelope before commit. Capacity failure never truncates memory, accepts half a loan or changes prior indexes. New state hashing remains O(history); cold repeated prefix replay remains potentially quadratic. A cached unchanged state hash is reusable, and warm views select bounded records from complete indexes.

Physical actions reconstruct mortal-v3 metadata from the single shared cursor, using its required internal mortal genesis head only at sequence zero. Loan acceptance constructs a lender transfer capability only from the exact live durable offer after borrower authorization; the outer principal/memory remains the borrower. Every action commits one compound memory. Loan fulfillment uses the restricted holder/lender/present-borrower policy, with third-party holder redaction in the view.

Mortal witnesses must stand at a relevant location before or after the transition. An actor struck unconscious/dead during that transition can retain it; an actor already nonstanding throughout cannot acquire later events merely by being referenced. Loan participant policies retain their separately frozen required-recipient rules. Knowledge activation records actual acquisition independently of authored validity; validity determines present context and new offer issuance, without withdrawing an already issued durable offer.
