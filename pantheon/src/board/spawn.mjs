// Await a child process instead of blocking the thread on it.
//
// WHY. The pipeline shells out twice -- the acceptance command the controller executes, and the
// Antigravity seat's Python subprocess -- and both used spawnSync. That is fine in a CLI, where the
// process has nothing else to do. It is wrong the moment the pipeline is called from a server: a
// synchronous wait pins the single-threaded event loop for the whole subprocess, so while one build
// runs its acceptance command the server answers nothing at all. Measured in review: two 3-second
// builds took 6 seconds and /builds could not be answered for 3010ms of it. Consequences were not
// theoretical -- the SSE progress stream went silent during exactly the stages worth watching, and
// LEXI's 10-second POST timeout would fire and tell the user "I couldn't reach Pantheon's build
// service" while Pantheon was healthy and mid-build.
//
// The shape deliberately mirrors spawnSync's return value ({ status, signal, stdout, stderr }) so
// the call sites read the same way they did before, and the same timeout/maxBuffer guarantees hold.
import { spawn } from "node:child_process";

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [o]
 * @param {string} [o.cwd]
 * @param {object} [o.env]
 * @param {number} [o.timeout] - ms. On expiry the child is killed and `signal` reports how.
 * @param {number} [o.maxBuffer] - bytes per stream. Exceeding it kills the child, as spawnSync does.
 * @returns {Promise<{status: number|null, signal: string|null, stdout: string, stderr: string}>}
 *   Resolves even when the child fails -- a non-zero exit is data here, not an exception, exactly as
 *   it was with spawnSync. Rejects only if the child could not be spawned at all.
 */
export function spawnPromise(cmd, args, { cwd, env, timeout, maxBuffer = 64 * 1024 * 1024, onStdoutLine } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }

    let stdout = "", stderr = "", pendingLine = "", killedFor = null, settled = false;
    const emitLine = line => { try { onStdoutLine?.(line); } catch { /* a display consumer cannot crash the child */ } };
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingLine) emitLine(pendingLine);
      resolve({ status, signal: killedFor ?? signal, stdout, stderr });
    };

    const timer = timeout
      ? setTimeout(() => { killedFor = "SIGTERM"; try { child.kill("SIGTERM"); } catch { /* already gone */ } }, timeout)
      : null;

    const cap = stream => text => {
      // Bounded, like spawnSync's maxBuffer: an unbounded read turns a chatty subprocess into this
      // process's memory problem.
      if (stream === "out") {
        if (stdout.length + text.length > maxBuffer) { killedFor = "SIGTERM"; try { child.kill("SIGTERM"); } catch { /* gone */ } return; }
        stdout += text;
        if (onStdoutLine) {
          pendingLine += text;
          let end;
          while ((end = pendingLine.indexOf("\n")) >= 0) {
            emitLine(pendingLine.slice(0, end));
            pendingLine = pendingLine.slice(end + 1);
          }
        }
      } else {
        if (stderr.length + text.length > maxBuffer) { killedFor = "SIGTERM"; try { child.kill("SIGTERM"); } catch { /* gone */ } return; }
        stderr += text;
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", cap("out"));
    child.stderr.on("data", cap("err"));
    child.on("error", e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
