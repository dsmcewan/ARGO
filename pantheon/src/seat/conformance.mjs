// A row in the capability table is a CLAIM until executed. The routing matrix this project
// replaces self-flagged most of its rows unverified for 61 days and nothing noticed (evidence
// B10), so conformance runs the vendor's own --help and fails closed on any declared flag it
// cannot find. A run that checked nothing is not a pass, and the caller can tell the difference
// because `checked` and `checkedFlags` are reported alongside the mismatches.
import { execFile } from "node:child_process";
import { VENDORS } from "./argv.mjs";

const defaultHelp = cmd => new Promise((res, rej) =>
  execFile(cmd, ["--help"], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (e, so, se) =>
    (e && !so && !se ? rej(e) : res(`${so}\n${se}`))));

// Every flag this project claims the binary accepts. prompt_flag is included deliberately: it was
// missing from the plan's table altogether, which makes it exactly the kind of declaration that
// has to be checked against the binary rather than trusted.
function declaredFlags(v) {
  return [v.resume_flag, v.session_id_flag, v.model_flag, v.effort_flag, v.cwd_flag, v.prompt_flag]
    .filter(f => typeof f === "string" && f.startsWith("-"));
}

// A plain substring test is not good enough for short flags: `help.includes("-p")` is satisfied by
// `--print`, `--permission-mode`, or any other text containing that pair, so a declared flag could
// "conform" against something unrelated. Require the flag to appear as its own token - at a line
// start or after whitespace/(, and ending at whitespace, =, comma, ], ) or end of line.
export function listsFlag(help, flag) {
  const esc = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(\\[,])${esc}([\\s=,\\])]|$)`, "m").test(help);
}

export async function conformVendor(vendor, { helpFn } = {}) {
  const v = VENDORS[vendor];
  if (!v) throw new Error(`conformVendor: unknown vendor "${vendor}"`);
  let help;
  try {
    help = await (helpFn ? helpFn(v.cmd) : defaultHelp(v.cmd));
  } catch (e) {
    return { vendor, checked: 0, checkedFlags: [], mismatches: [`could not run "${v.cmd} --help": ${e.message}`] };
  }
  const flags = declaredFlags(v);
  const mismatches = [];
  for (const flag of flags) {
    if (!listsFlag(help, flag)) mismatches.push(`declares ${flag} but ${v.cmd} --help does not list it`);
  }
  return { vendor, checked: flags.length, checkedFlags: flags, mismatches };
}
