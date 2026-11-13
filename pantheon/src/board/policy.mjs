// Slot policies, in their own module so both merge.mjs (the resolver) and refs.mjs (the gate on the
// shipping ref) can read them without importing each other.
export const POLICIES = new Set(["ours", "union", "slot-wise", "bound-review", "record-split"]);

/** Which resolver governs a slot. Longest matching prefix wins. */
export const DEFAULT_POLICY = [
  ["artifact:", "bound-review"],
  ["decision:", "record-split"],
  // A critique slot is per author (`critique:<slot>@<vendor>`), so two reviewers never contend for
  // one slot and collecting a verdict is a plain slot-wise take. Leaving this class unclassified was
  // caught by the strict default below refusing to merge an approval at all -- which is the default
  // behaving correctly: an unrecognised slot class gets refused, not waved through.
  ["critique:", "slot-wise"],
  ["hypothesis:", "union"],
  ["item:", "slot-wise"],
  ["plan", "slot-wise"],
  ["ticket", "ours"],
];

export const policyFor = (slot, table = DEFAULT_POLICY) => {
  let best = null;
  for (const [prefix, policy] of table) {
    if (slot === prefix || slot.startsWith(prefix)) {
      if (!best || prefix.length > best[0].length) best = [prefix, policy];
    }
  }
  // An unrecognised slot gets the strictest resolver, not the most convenient one. A default of
  // "take theirs" would let a slot class nobody classified move the shipping ref.
  return best ? best[1] : "record-split";
};

/** The slots only ship() may land on a board ref: those the DEFAULT table marks bound-review. Judged
 *  against the default table and never the caller's, or a caller could reclassify its way in. */
export const shipOnlySlots = slots => slots.filter(s => policyFor(s, DEFAULT_POLICY) === "bound-review");
