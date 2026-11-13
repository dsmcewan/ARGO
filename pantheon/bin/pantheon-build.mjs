#!/usr/bin/env node
// Launch the build API. The vendor SDKs are imported HERE, at the edge, and injected — so
// src/view/build-server.mjs and src/board/run-item.mjs both stay importable in tests with no SDK
// installed and no credentials.
//
//   source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh
//   node bin/pantheon-build.mjs
//
// Then POST a ticket to it, or let LEXI's companion do it for you:
//   curl -s localhost:7778/build -H 'content-type: application/json' \
//     -d '{"ticket": { ...same shape as scripts/tickets/*.json... }}'
//   curl -N localhost:7778/events        # watch it happen
//   curl -s localhost:7778/builds        # what is running right now
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import { homedir } from "node:os";
import { createBuildServer, MAX_CONCURRENT_BUILDS } from "../src/view/build-server.mjs";
import { makeClient } from "../src/sdk/adapter.mjs";

const port = Number(process.argv[2] ?? process.env.PANTHEON_BUILD_PORT ?? 7778);
// Every ticket's repo_root must resolve inside this. Overridable, because a ticket targeting a
// project outside ~/Projects is a deliberate decision, not a default.
const allowedRoot = process.env.PANTHEON_BUILD_ROOT ?? join(homedir(), "Projects");

// Clients are built lazily, per seat, on first use: one missing credential should not refuse to
// start the server, it should surface as that seat's own error inside the run that needed it.
const cache = new Map();
const makeClientFor = vendor => {
  if (!cache.has(vendor)) cache.set(vendor, makeClient(vendor, { OpenAI, GoogleGenAI, Anthropic }));
  return cache.get(vendor);
};

// A build runs for minutes and spends real money. An operator's ^C should stop the server, and
// should say plainly that it is NOT rolling anything back: whatever a running build already wrote
// to its board and its output directory stays there, to be resumed or read.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n${sig}: stopping the build server. Any in-flight build keeps what it already wrote;`);
    console.log("nothing is rolled back. Resume a board with: node scripts/open-items-run.mjs --resume <board dir>");
    process.exit(0);
  });
}

const { listen } = createBuildServer({ makeClientFor, allowedRoot });
const addr = await listen(port);
console.log(`pantheon build  http://127.0.0.1:${addr.port}`);
console.log(`  tickets may build anything under: ${allowedRoot}`);
console.log(`  at most ${MAX_CONCURRENT_BUILDS} build(s) at a time; a third is refused, not queued.`);
console.log("bound to loopback only: this process holds four vendors' credentials and spends them.");
