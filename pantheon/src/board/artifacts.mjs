
import { resolve, relative, join } from "node:path";
import { openStore } from "./cas.mjs";
import { treeSlots, entriesOfKind } from "./dag.mjs";
import { boardState, acceptanceStatus } from "./controller.mjs";
import { reviewAck, GATES } from "./integrate.mjs";
import { parseRef, openRefs } from "./refs.mjs";
import { canonicalize } from "./canon.mjs";
import { artifactPath, readArtifact } from "./artifact-files.mjs";
import { ACCEPTANCE_ISOLATION } from "./acceptance.mjs";

// A run summary is an index, not a trust anchor. Re-read hashes, shipping membership, bound
// reviews and isolated controller repros before offering bytes to apply (or completing a resume).
export function certifiedArtifacts(run, { repoRoot, outDir }) {
  if (run?.format !== 2 || run.shipped !== true || run.isolation !== ACCEPTANCE_ISOLATION) {
    throw new Error("no certified shipped manifest; legacy, refused and salvaged work must be rerun");
  }
  if (resolve(run.repo_root) !== resolve(repoRoot)) throw new Error("manifest belongs to a different repository");
  if (!Array.isArray(run.artifacts) || !run.artifacts.length || !Array.isArray(run.files)) throw new Error("incomplete artifact manifest");
  if (run.gates?.length !== GATES.length || !GATES.every(g => run.gates.some(row => row.gate === g && row.ok === true))) {
    throw new Error("shipping gates did not all pass");
  }
  const ref = run.certificate?.ref, commit = run.certificate?.commit;
  if (parseRef(ref).cls !== "board") throw new Error("certificate is not a shipping ref");
  const store = openStore(run.board, { readOnly: true });
  const refs = openRefs(run.board, { store, readOnly: true });
  if (refs.resolve(ref) !== commit) throw new Error("shipping ref no longer matches the certified commit");
  if (!["controller", "human"].includes(store.get(commit).author?.vendor)) throw new Error("shipping commit is not controller-owned");
  const slots = treeSlots(store, commit);
  const expected = Object.keys(slots).filter(s => s.startsWith("artifact:"));
  if (expected.length !== run.artifacts.length || run.files.length !== run.artifacts.length) throw new Error("artifact manifest omits a shipped slot");
  const state = boardState({ store, refs, ref });
  const seen = new Set();
  return run.artifacts.map(row => {
    if (seen.has(row.slot)) throw new Error("duplicate manifest slot");
    seen.add(row.slot);
    if (slots[`artifact:${row.slot}`] !== row.cid) throw new Error("artifact is not in the shipping commit");
    const art = store.get(row.cid), original = run.files.find(f => f.slot === row.slot);
    if (art.kind !== "artifact" || art.payload.path !== row.path || art.links.bytes !== row.bytes ||
        original?.artifactCid !== row.cid || original?.path !== row.path) throw new Error("artifact manifest does not match the board");
    const baseline = art.payload.baseline;
    if (typeof baseline?.exists !== "boolean" || typeof baseline.bytes !== "string" ||
        canonicalize(baseline) !== canonicalize(original.baseline)) throw new Error("no immutable destination baseline");
    store.get(baseline.bytes); // baseline is content-addressed too, including absent versus empty.
    if (!reviewAck(store, commit, art).ok ||
        !acceptanceStatus({ store, state, artifact: { ...art.payload, cid: row.cid, author: art.author }, from: commit }).ok) {
      throw new Error("artifact has no bound approving review and passing acceptance");
    }
    if (!entriesOfKind(store, commit, "repro").some(r => r.author.vendor === "controller" &&
        r.payload.exit === 0 && r.payload.isolation === ACCEPTANCE_ISOLATION && r.links.derived_from?.includes(row.cid))) {
      throw new Error("artifact lacks an isolated controller acceptance result");
    }
    const contents = store.get(row.bytes);
    const expectedPath = artifactPath(repoRoot, relative(repoRoot, join(outDir, "artifact", row.path)));
    if (resolve(row.copied_to) !== expectedPath) throw new Error("export path does not match its manifest");
    // Validate target aliases before returning any source bytes to the apply loop.
    artifactPath(repoRoot, row.path);
    return { ...row, baseline, contents, exported: readArtifact(repoRoot, relative(repoRoot, expectedPath)) };
  });
}
