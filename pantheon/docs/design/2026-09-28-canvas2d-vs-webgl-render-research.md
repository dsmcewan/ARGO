# Canvas 2D vs WebGL for the live-view render: research findings

> Filed by research-renderer (subagent, session-87417a23) in place of a team-chat message —
> the SendMessage tool was not available in this subagent's tool set this session. Read-only
> research; no product code touched. Assigned question and findings below; a live decision
> conflict is flagged at the end and needs an owner's call, not a subagent's.

## Assigned question

"At what point does Canvas2D stop holding 60fps for many continuously-redrawn, additively
blended, glowing line segments; what's the dominant cost; what's the cheap substitute; what
does raw WebGL cost to adopt; give a threshold." Sources fetched 2026-09-28.

## Findings, each with its source

**1. Plain (non-glow) line throughput, Canvas2D vs WebGL.**
> "Canvas 2D, Firefox | 46 ms | 416 ms | 4113 ms | 42,000 ms" vs "BatchDraw, Firefox | 3.9 ms |
> 5.3 ms | 20.8 ms | 185 ms" for 10k/100k/1M/10M lines.
— github.com/lragnarsson/WebGL-BatchDraw README (repo last pushed 2018-11-22, fetched
2026-09-28). No hardware disclosed — directional only. At 10k lines, plain Canvas2D stroke()
is already ~46ms/frame (≈21fps) with *no* glow applied yet.

**2. The dominant cost is `shadowBlur`, not stroke count or `globalCompositeOperation`.**
Measured, hardware-versioned:
> "Measured on an M-series Mac (DPR 2, 120 Hz, Chrome)... One `stroke()` per link. 6k to 60k
> strokes per frame. This is the JS cost (3 to 25 ms per frame)... `shadowBlur` on every node
> arc. Hundreds of shadowed fills per frame fall on the slow raster path... with `glow: 0` the
> same scenes run at 120 / 76 / 34 fps. This one dominates the frame rate."
— github.com/leonardocandiani/neurograph PR #1 (merged 2026-09-21, head `e06b5aa`), fetched
2026-09-28. Same PR after the fix: "1200 nodes, glow 1, 60 pulses, interactive | 60 (cap) |
5.4 ms | 114" strokes/frame (was 4fps before). Separately: "1100 nodes, glow 0.55... 7 fps and
19,099 strokes per frame before; 60 fps and 82 strokes after" via Path2D batching alone.
Corroborated qualitatively (no numbers) by two vendor docs: "Avoid `shadowBlur`... this
operation can be very expensive" (web.dev/articles/canvas-performance, fetched 2026-09-28) and
"Avoid the shadowBlur property whenever possible" (MDN Optimizing_canvas, fetched 2026-09-28).
Caveat: the neurograph numbers are one independent repo's own benchmark, not peer-reviewed —
good because it's hardware-disclosed and on-scenario (glowing nodes+links), weak because n=1.

**3. Cheap substitute in production use: a pre-rendered sprite, not `shadowBlur` and not a
full-canvas `ctx.filter` blur.**
> "Node glow as a sprite. A radial-gradient sprite per tone (16, cached...) drawn with
> `drawImage` + `globalAlpha`... `shadowBlur` stays only on the few pulses."
— same neurograph PR #1. Artefact noted: "at `glow: 1` the halo is slightly softer" than real
shadowBlur; visually indistinguishable at low glow. Trail/decay-by-alpha-fade is the standard
tutorial pattern (kirupa.com/canvas/creating_motion_trails.htm;
growingwiththeweb.com/2012/10/creating-trail-effect-with-canvas.html, fetched 2026-09-28,
both tutorial-grade, not spec docs). The "offscreen layer the size of the whole canvas" cost
claimed for `ctx.filter=blur()` in Chrome could not be pinned to a primary source in the
budget available — UNVERIFIED, flag for re-check before relying on it.

**4. Raw WebGL entry cost.** Width is the catch, not shader boilerplate:
> "for the majority of implementations the maximum width is 1" for `gl.lineWidth`
— webgl2fundamentals.org/webgl/lessons/webgl-points-lines-triangles.html, fetched 2026-09-28
(Greggman's WebGL fundamentals; practitioner-authoritative, not a spec page). Anything wider
needs hand-built triangle-strip geometry: "Everything in WebGL is built using triangles...
computing tangent vectors... calculating miter joins... Ideally, we would do most of these
calculations in a geometry shader... geometry shaders are only available in OpenGL, not WebGL."
— blog.scottlogic.com/2019/11/18/drawing-lines-with-webgl.html, fetched 2026-09-28. Real,
non-trivial vertex-shader work — but it buys real headroom (§1: ~150ms vs ~4000ms at 1M lines).

**5. Threshold.** Below roughly 5,000–10,000 continuously-glowing segments, Canvas2D is viable
*if* glow is done via a pre-rendered sprite/gradient + `drawImage` (not `shadowBlur`, not
`ctx.filter` blur) and strokes are batched into a few `Path2D` calls — the neurograph case hit
a 60fps cap at 1200 nodes + 60 pulses + glow with 5.4ms JS once `shadowBlur` was removed, and
separately dropped 19,099→82 strokes/frame via batching. Above roughly 50,000–100,000 segments,
plain stroke cost alone (ignoring glow) is already 400ms+/frame (§1), making Canvas2D not
viable regardless of glow technique.

**Confidence:** medium overall — high that `shadowBlur` (not composite mode or path count) is
the dominant cost and that sprite pre-render is the standard fix (two independent primary
sources agree, one hardware-versioned); low on the exact numeric threshold — no source measures
this project's precise scenario (short additively-blended seam segments with individually
decaying alpha, count rising over a session). I extrapolated from a nodes+links graph benchmark
and a plain-line throughput benchmark with undisclosed hardware.

**Unresolved:** (a) the `ctx.filter` full-canvas-offscreen-layer claim, unpinned; (b)
`globalCompositeOperation:'lighter'` cost, no benchmark found either way; (c) no source
measured this project's actual shape (masonry seam segments, per-segment decay) — validate any
fixed N with a real prototype before treating it as settled.

---

## What this means against the actual scale in this repo's own plan

The generic thresholds above are moot next to a number already committed in
`docs/plans/2026-09-28-live-view-section-3a-light-physics.md` and its sibling
`docs/plans/2026-09-27-live-view-section-2-stream-replay-camera.md` (Task 6 of the earlier
"Dead Reckoning" plan): the acceptance check is
> "Measure the 200-entity scene at 1600x900 and report p95 frame time; if above 16.7 ms, reduce
> trail density and retest once after the change."
200 entities is roughly a sixth of the 1200-node case that neurograph ran at a 60fps cap with
5.4ms of JS per frame, glow included. **On the performance evidence alone, Canvas2D has
headroom to spare at this project's stated scale, provided the glow uses the sprite/pre-render
technique (§3) rather than `shadowBlur` per element.** A WebGL rewrite is not required to hit
60fps at N=200; if one happens anyway, the justification has to be visual fidelity (real
refraction/transmission through the glass, true 3D bloom, depth) rather than throughput.

## A conflict this research surfaced, not resolved

While reading current plan documents for the scale number above, I found:

- `docs/plans/2026-09-27-live-view-section-2-stream-replay-camera.md` (the "Dead Reckoning UI"
  plan, status "Concrete proposal ready for review", baseline `3837eda`), Global Constraints:
  > "No new production dependency, WebGL engine, build system, or provider API integration."
  and Tech Stack: "React 18.3.1... SVG, Canvas 2D... No new production dependency."
- `docs/plans/2026-09-28-live-view-section-3a-light-physics.md`, Tech Stack:
  > "Node 24, `node:test`, ES modules, no dependency. Every formula is implemented here from
  > its source; nothing is vendored."
- `docs/design/2026-09-28-r3f-glass-demo.html` already exists on disk (newest file in
  `docs/design/`, written after the Canvas2D light-physics demo), explicitly labeled:
  > "DESIGN SPIKE, not product code... to answer four questions before the renderer plan is
  > written: (1) do React 19.3.0, three, Fiber 9, Drei 10 and the postprocessing pair load from
  > esm.sh through one import map with no bundler and no JSX... (2) does Drei's
  > MeshTransmissionMaterial give the faceted antique glass the brief asks for; (3) does Bloom
  > give the light's dissipation and Drei's Trail its wake; (4) does the motion module carry
  > over unchanged."
  It reuses `light-physics.mjs` verbatim and loads React 19.3.0 / three@0.186.1 /
  `@react-three/fiber@9.8.1` / `@react-three/drei@10.7.9` / `postprocessing@6.39.5` /
  `@react-three/postprocessing@3.1.3` all via esm.sh import-map URLs (no `package.json` entry,
  no bundler) — the same CDN-import pattern already accepted for React 18.3.1 elsewhere in
  this repo, but explicitly the "WebGL engine" the Dead Reckoning plan's constraint names.
- A headless Chromium (Playwright, SwiftShader software GL) was running on this machine at the
  time of this research (`ps aux`, PID 50354, started 00:41) — consistent with someone actively
  exercising that exact spike right now. I did not touch it or its output; I have no browser
  tool in this subagent invocation to run my own check, so I could not add a first-party fps
  measurement of the spike myself this session.
- The user's message mid-turn today proposes going further than the spike: adding
  `@react-three/drei`'s `Trail`/`Billboard`/`Html`, `@react-three/postprocessing`'s `Bloom`
  (both already in the spike) plus `three.quarks` (not yet spiked) as the production stack,
  and states plainly: "This would replace the planned Canvas 2D scene renderer."

That is a real, unresolved tension between a written, reviewed-status constraint ("No new
production dependency, WebGL engine...") and a direction the user is now actively pushing,
already partially spiked on disk. It is an architecture decision for whoever owns this
plan (the user / team-lead), not something I should resolve unilaterally as the performance
researcher — but the decision-maker should have it in view: the *performance* case for going
to WebGL at N≈200 is weak (Canvas2D clears it with margin per §5 above); if WebGL is adopted
it will be for the transmission-glass/bloom look, and that trade needs to be made on those
grounds, explicitly, against the plan text that currently forbids it.
