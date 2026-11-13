
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { runAcceptance } from "../src/board/acceptance.mjs";

test("acceptance uses real filesystem/network isolation and still runs local tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "pantheon-sandbox-"));
  const worktree = join(root, "work");
  const { mkdirSync } = await import("node:fs"); mkdirSync(worktree);
  const secret = join(root, "host-secret"); writeFileSync(secret, "fixture-only");
  symlinkSync(secret, join(worktree, "host-link"));
  const server = createServer(socket => socket.end());
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  writeFileSync(join(worktree, "probe.mjs"), `import assert from "node:assert/strict";
    import {existsSync,writeFileSync} from "node:fs"; import {connect} from "node:net";
    assert.equal(process.env.PANTHEON_FIX_DUMMY,undefined);
    assert.equal(existsSync(${JSON.stringify(secret)}),false);
    assert.equal(existsSync("host-link"),false);
    assert.equal(existsSync("/home/colchis/.claude"),false);
    assert.throws(()=>writeFileSync("/usr/escape","bad"));
    writeFileSync("local-output","ok");
    await new Promise((resolve,reject)=>{const s=connect(${server.address().port},"127.0.0.1");
      s.on("connect",()=>{s.destroy();reject(Error("host network reachable"));});
      s.on("error",resolve);s.setTimeout(200,()=>{s.destroy();resolve();});});
    console.log("CONFINED");`);
  const old=process.env.PANTHEON_FIX_DUMMY;process.env.PANTHEON_FIX_DUMMY="not-a-real-secret";
  try {
    const r=await runAcceptance({worktree,cmd:"/usr/bin/node probe.mjs && /usr/bin/python3 -c 'print(123)'",head:"fixture-head"});
    assert.equal(r.exit,0,r.out);
    assert.match(r.out,/CONFINED/);
    assert.equal(readFileSync(join(worktree,"local-output"),"utf8"),"ok");
  } finally {
    if(old===undefined)delete process.env.PANTHEON_FIX_DUMMY;else process.env.PANTHEON_FIX_DUMMY=old;
    server.closeAllConnections?.();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});
  }
});

test("an unavailable isolation launcher fails closed without running the command", async () => {
  let called=false;
  await assert.rejects(()=>runAcceptance({worktree:"/tmp",cmd:"true",launch:async()=>{called=true;throw Object.assign(Error("missing"),{code:"ENOENT"});}}),/isolation|sandbox/i);
  assert.equal(called,true);
});

test("real nested-namespace denial never falls back to an ordinary shell", async () => {
  const worktree=mkdtempSync(join(tmpdir(),"pantheon-sandbox-denied-"));
  try {
    writeFileSync(join(worktree,"acceptance.mjs"),readFileSync(new URL("../src/board/acceptance.mjs",import.meta.url)));
    writeFileSync(join(worktree,"spawn.mjs"),readFileSync(new URL("../src/board/spawn.mjs",import.meta.url)));
    writeFileSync(join(worktree,"nested.mjs"),`import assert from "node:assert/strict";
      import {existsSync} from "node:fs";import {runAcceptance} from "./acceptance.mjs";
      const r=await runAcceptance({worktree:process.cwd(),cmd:"touch nested-command-ran"});
      assert.notEqual(r.exit,0,"nested user namespaces must be denied");
      assert.equal(existsSync("nested-command-ran"),false);`);
    const r=await runAcceptance({worktree,cmd:"/usr/bin/node nested.mjs"});
    assert.equal(r.exit,0,r.out);
    assert.equal(readFileSync(join(worktree,"nested.mjs"),"utf8").includes("nested-command-ran"),true);
  } finally {rmSync(worktree,{recursive:true,force:true});}
});

test("the delegated-code oracle uses the same boundary and preserves its legitimate control", async () => {
  const {verify}=await import("../scripts/delegate-run.mjs");
  const root=mkdtempSync(join(tmpdir(),"pantheon-delegated-boundary-")),host=join(root,"secret");
  writeFileSync(host,"host-only");
  const before=process.env.PANTHEON_FIX_DUMMY;process.env.PANTHEON_FIX_DUMMY="fixture-only";
  const code=`import {existsSync,writeFileSync} from "node:fs";
    if(process.env.PANTHEON_FIX_DUMMY || existsSync(${JSON.stringify(host)})) throw Error("host visible");
    try{writeFileSync(${JSON.stringify(host)},"escaped");throw Error("host writable");}catch(e){if(e.message==="host writable")throw e;}
    let tail=Promise.resolve();
    export async function withSeatLock(key,fn){let release;const prior=tail;
      tail=new Promise(r=>release=r);await prior;try{return await fn();}finally{release();}}`;
  try {
    const r=await verify({task:{id:"fixture"},code});
    assert.equal(r.ok,true,r.detail);
    assert.equal(readFileSync(host,"utf8"),"host-only");
    const abstained=await verify({task:{id:"other"},code:"export const anotherHelper=true;"});
    assert.equal(abstained.ok,null,"the pre-existing non-lock oracle contract remains");
  } finally {
    if(before===undefined)delete process.env.PANTHEON_FIX_DUMMY;else process.env.PANTHEON_FIX_DUMMY=before;
    rmSync(root,{recursive:true,force:true});
  }
});
