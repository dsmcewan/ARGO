
// Acceptance executes untrusted generated code. A copied directory is not a security boundary:
// use mandatory Linux namespaces and a minimal filesystem, or refuse without executing the shell.
import { realpathSync } from "node:fs";
import { spawnPromise } from "./spawn.mjs";

export const ACCEPTANCE_ISOLATION = "bwrap-v1";
export async function runAcceptance({ worktree, cmd, head = "", timeout = 600_000, launch = spawnPromise }) {
  if (process.platform !== "linux") throw new Error("acceptance isolation requires Linux Bubblewrap; no unsandboxed fallback");
  const cwd = realpathSync(worktree);
  const args = ["--unshare-user", "--unshare-all", "--disable-userns", "--assert-userns-disabled",
    "--cap-drop", "ALL", "--die-with-parent", "--new-session",
    "--ro-bind", "/usr", "/usr",
    "--dir", "/tools", "--ro-bind", realpathSync(process.execPath), "/tools/node",
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin",
    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home",
    "--bind", cwd, "/workspace", "--chdir", "/workspace", "--clearenv",
    "--setenv", "PATH", "/tools:/usr/bin:/bin", "--setenv", "HOME", "/tmp/home",
    "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8",
    "--setenv", "PANTHEON_HEAD", head, "--", "/bin/sh", "-c", cmd];
  let r;
  try {
    // Scrub the LAUNCHER too: LD_PRELOAD is evaluated before bwrap can clear the child's env.
    r = await launch("/usr/bin/bwrap", args, { cwd, timeout, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } });
  } catch (e) {
    throw new Error(`acceptance isolation unavailable; command not run without sandbox: ${e.message}`, { cause: e });
  }
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { exit: r.status ?? 1, out, isolation: ACCEPTANCE_ISOLATION };
}
