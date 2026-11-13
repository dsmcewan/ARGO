// One board: a content-addressed store, a set of mutable names, and the runtime chrome that must
// never be hashed into either.
import { openStore } from "./cas.mjs";
import { openRefs } from "./refs.mjs";
import { openRuntime } from "./runtime.mjs";

export function openBoard(root) {
  const store = openStore(root);
  const runtime = openRuntime(root);
  const refs = openRefs(root, { runtime, store }); // refs verify lease generations and diff commits themselves
  return { root, store, refs, runtime };
}

export * from "./canon.mjs";
export * from "./schema.mjs";
export * from "./dag.mjs";
export * from "./merge.mjs";
export * from "./project.mjs";
export * from "./controller.mjs";
export { REF_CLASSES, parseRef, maySwap, slotsAllowed } from "./refs.mjs";
