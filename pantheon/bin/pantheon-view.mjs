#!/usr/bin/env node
// Launch the live view. The vendor SDKs are imported HERE, at the edge, and injected — so
// src/view/server.mjs stays importable in tests with no SDK installed and no credentials.
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { createViewServer } from "../src/view/server.mjs";
import { makeClient } from "../src/sdk/adapter.mjs";

const port = Number(process.argv[2] ?? process.env.PANTHEON_VIEW_PORT ?? 7777);

// Clients are built lazily, per seat, on first use. Building all four up front would refuse to
// start the whole view because one vendor's credential is missing — the operator should be able
// to watch the three that work and see the fourth report its own error in its own pane.
const cache = new Map();
const makeClientFor = vendor => {
  if (!cache.has(vendor)) cache.set(vendor, makeClient(vendor, { OpenAI, GoogleGenAI, Anthropic }));
  return cache.get(vendor);
};

const { listen } = createViewServer({ makeClientFor });
const addr = await listen(port);
console.log(`pantheon view  http://127.0.0.1:${addr.port}`);
console.log("bound to loopback only: this process holds four vendors' credentials.");
