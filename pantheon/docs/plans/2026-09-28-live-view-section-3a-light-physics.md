# Live View, Section Three (a) — the physics of the lights

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. The one module here is a *ticket* for the seats with a human-written oracle committed first (`scripts/tickets/README.md`); the wiring into `lights.mjs` is *by hand*.

**Goal:** The lights move like something alive in air, not like markers on rails: a flight path that wavers off course fluidly and still arrives; an orbit around the block that swings close and fast and far and slow, precessing so no loop retraces; light that dissipates with distance the way real light does and cools with time; a glow that the glass picks up where the light passes. All of it a pure function of state and clock, so replay is exact and a scrub never breaks the motion.

**Architecture:** One pure module, `src/view/ui/light-physics.mjs`, exports seeded noise, a curl field, a wavering flight path, a Kepler orbit, and two attenuation curves. `lights.mjs` (Section Three) calls them: the out and back phases use the wavering flight path; the exploring phase uses the orbit; the head's glow and the trail use the attenuation; the block's rim glow is the attenuation applied along the rim. Nothing is integrated frame to frame; every position is computed from `t`, which is what keeps replay free.

**Tech Stack:** Node 24, `node:test`, ES modules, no dependency. Every formula is implemented here from its source; nothing is vendored.

**Spec:** `docs/specs/2026-09-27-live-view-design.md` §4 (Motion) and §8 (Lights). This section sharpens §4 from "a constant speed along the rim" to the motion below; the spec is amended by Step 6.

## Sources, and what each one contributes

| what | source | licence | what is taken |
|---|---|---|---|
| Smooth seeded randomness | Stefan Gustavson, *Simplex noise demystified* (2005); the 2D port in `josephg/noisejs` `perlin.js` | public domain (per the file header) | the 2D simplex algorithm: skew factors `F2`, `G2`, the three-corner contribution, the `70 ×` scaling to [−1, 1] |
| A reseedable permutation | `mikeascendx/aether` `js/perlin.js` | MIT | the Lehmer-shuffle seeding of the permutation table, so one seed gives one field |
| Fluid, divergence-free wander | Bridson, Hourihan, Nordenstam, *Curl-noise for procedural fluid flow* (SIGGRAPH 2007); the finite-difference form in `jettisonjoe/jettisonjoe.github.io` `sketches/curl_noise.js` and `mikeascendx/aether` `js/field.js` | paper; MIT | in 2D the velocity is the curl of a scalar potential: `v = (∂ψ/∂y, −∂ψ/∂x)`, by central differences with a small `ε` |
| Luminous persistent trails | `mikeascendx/aether` `js/field.js` | MIT | the technique, not the code: additive (`lighter`) strokes over a background that is refilled at a small alpha each frame, so light persists and fades |
| A flight path that wavers | Craig Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999); Daniel Shiffman, *The Nature of Code*, chapter 5, `wander()` in `nature-of-code/noc-book-2` | the concept | the wander target on a circle projected ahead of the mover, its angle jittered each step. Here the angle is a function of noise and time instead of a random walk, so the same `t` always gives the same point |
| An orbit with a real feel | Kepler's equation `E − e·sin E = M`, Newton's method as in `markbrown/keplersballs` `src/orbit.js` | the mathematics | `E ← E − (E − e·sin E − M) / (1 − e·cos E)`, seeded at `M` for `e < 0.8` and at `π` otherwise; position from `E`; speed follows vis-viva, fastest at periapsis |
| Light dissipation | Lagarde & de Rousiers, *Moving Frostbite to PBR* (SIGGRAPH 2014 course notes, p. 28–33), as collected in `Skittss/sumire` `shaders/includes/inc_light_attenuation.glsl`; lisyarus, *Point light attenuation* (2022) | the formulas | inverse square with a windowing term, `I = 1/max(d², s²) · saturate(1 − (d²/R²)²)²`, and the smooth no-cusp variant `A(1 − s²)²/(1 + F·s²)` with `s = d/R` |

## Global Constraints

- **Pure and memoryless.** Every export takes `t` (and a seed) and returns a value; none keeps state between calls. `Math.random` is never called.
- **Deterministic per seed.** Same seed and same `t` give the same numbers on every machine; a different seed gives a different path. Seeds are derived from the seat name, so the reviewer's light always wavers the reviewer's way.
- **Bounded.** Noise stays in [−1, 1]; a flight path ends exactly where it aims; an orbit stays between periapsis and apoapsis; attenuation is 1 at the source, 0 at the radius, and never negative.
- **Continuous.** Positions change by a bounded amount for a bounded change in `t` (no teleporting); attenuation reaches 0 with zero slope, so a glow never has a hard edge.
- **Cheap.** A light costs a few noise samples and one Newton solve per frame; a trail of 12 samples costs twelve of those.

## Review Focus

1. **A path that never arrives.** Wander added to an arc must vanish at both ends, or the light lands beside the block instead of on it (Task 1's endpoint test).
2. **A curl that is not a curl.** If the two finite differences are taken with different `ε`, or the sign is wrong, the field has sources and sinks and the wander clumps (Task 1's discrete-divergence test, which is exactly zero for a true curl).
3. **Kepler at high eccentricity.** Newton from `E₀ = M` diverges near `e → 1`; the seed must switch to `π` (Task 1's convergence grid up to `e = 0.95`).
4. **A glow with a hard edge.** The Frostbite window is squared so the derivative is zero at `R`; an implementation that forgets the square shows a visible ring (Task 1's derivative test at `R`).
5. **A scrub into the middle of an orbit.** Because position is a function of `t`, `orbitPoint` at `t = 37.2` after a seek must equal the value the live loop would have drawn (Task 1's determinism test evaluates out of order).

## File Structure

| file | responsibility |
|---|---|
| `src/view/ui/light-physics.mjs` | `makeNoise`, `curl`, `wander2`, `flightPoint`, `keplerE`, `orbitPoint`, `attenuation`, `attenuationSoft`, `rimGlow` (Task 1) |
| `tests/light-physics.test.mjs` | the oracle (Task 1) |
| `src/view/ui/lights.mjs` | uses them for out/back, exploring, glow and trail (Task 2) |
| `src/view/ui/stage.js` | draws the head from the attenuation curve and the trail additively (Task 2) |
| `docs/design/2026-09-28-light-physics-demo.html` | one block, one orbiting wavering light, so the motion can be seen before it is wired (Task 3) |

---

### Task 1: `light-physics.mjs`

*Ticket.*

**Interfaces.**
- `makeNoise(seed) → { simplex2(x, y), fbm2(x, y, octaves = 3) }` — Gustavson 2D simplex on a permutation shuffled from `seed`; `simplex2` in [−1, 1], `fbm2` in [−1, 1].
- `curl(psi, x, y, eps = 0.01) → [vx, vy]` — `[(ψ(x, y+ε) − ψ(x, y−ε)) / 2ε, −(ψ(x+ε, y) − ψ(x−ε, y)) / 2ε]`.
- `wander2(noise, t, freq, seed) → [nx, ny]` — two smooth channels in [−1, 1], `fbm2` sampled along a line in noise space that moves with `t`, offset by `seed`.
- `flightPoint(A, B, k, t, noise, { lift = 40, amp = 18, freq = 0.7, seed = 0 }) → [x, y]` — the quadratic arc from `A` to `B` at fraction `k`, plus a wander displacement scaled by `sin(πk)` so it is zero at both ends; the displacement is `wander2` projected on the arc's normal (amplitude `amp`) and along its tangent (amplitude `amp/3`).
- `keplerE(M, e) → E` — Newton on `E − e·sin E = M` to `|ΔM| < 1e-10`, at most 32 iterations, seed `M` if `e < 0.8` else `π`; `M` is reduced into [0, 2π).
- `orbitPoint({ cx, cy, a, e, omega, squash = 1, precession = 0 }, t, period) → { x, y, r, E }` — the focus at `(cx, cy)`; `M = 2π t / period`; `E = keplerE(M, e)`; in the orbital frame `x' = a(cos E − e)`, `y' = a√(1−e²) sin E`; rotated by `omega + precession·t`; `y` scaled by `squash`; `r = a(1 − e cos E)` is the unsquashed distance to the focus.
- `attenuation(d, R, size = R / 32) → 0..1` — Frostbite: `w = saturate(1 − (d²/R²)²)²`, `i = 1 / max(d², size²)`, returned as `i·w / (1/size²)` so it is 1 at `d = 0`.
- `attenuationSoft(d, R, F = 2) → 0..1` — lisyarus no-cusp: `s = d/R`, `(1 − s²)² / (1 + F s²)` for `s < 1`, else 0.
- `rimGlow(points, heads, R, tau) → Float64Array` — for each rim point, `max_j attenuation(|p − h_j|, R) · exp(−age_j / tau)` over `heads = [{ x, y, age }]`.

- [ ] **Step 1: Write the failing oracle**

```js
// file: tests/light-physics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeNoise, curl, wander2, flightPoint, keplerE, orbitPoint, attenuation, attenuationSoft, rimGlow } from "../src/view/ui/light-physics.mjs";
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b}`);

test("simplex noise is seeded, bounded, continuous, and not constant", () => {
  const n1 = makeNoise(7), n2 = makeNoise(7), n3 = makeNoise(8);
  let maxAbs = 0, maxStep = 0, sum = 0;
  for (let i = 0; i < 2000; i++) { const x = i * 0.013, y = Math.sin(i) * 3; const v = n1.simplex2(x, y);
    assert.equal(v, n2.simplex2(x, y), "same seed, same field"); maxAbs = Math.max(maxAbs, Math.abs(v)); sum += Math.abs(v - n3.simplex2(x, y));
    maxStep = Math.max(maxStep, Math.abs(n1.simplex2(x + 0.001, y) - v)); }
  assert.ok(maxAbs <= 1 && maxAbs > 0.3, `bounded and alive: ${maxAbs}`); assert.ok(maxStep < 0.02, `continuous: ${maxStep}`); assert.ok(sum / 2000 > 0.05, "a different seed is a different field");
  const f = n1.fbm2(0.3, 0.7, 4); assert.ok(f >= -1 && f <= 1);
});
test("the curl of a potential is divergence-free: the discrete divergence with the same stencil is zero", () => {
  const n = makeNoise(3); const psi = (x, y) => n.fbm2(x * 0.5, y * 0.5, 3); const eps = 0.01;
  for (const [x, y] of [[0.3, 0.9], [4.1, -2.2], [10.5, 7.7]]) {
    const [vx0, vy0] = curl(psi, x, y, eps); assert.ok(Number.isFinite(vx0) && Number.isFinite(vy0));
    const dvx = (curl(psi, x + eps, y, eps)[0] - curl(psi, x - eps, y, eps)[0]) / (2 * eps);
    const dvy = (curl(psi, x, y + eps, eps)[1] - curl(psi, x, y - eps, eps)[1]) / (2 * eps);
    near(dvx + dvy, 0, 1e-7, "divergence");
  }
  const sx = (x, y) => x * x;   // ψ = x²: curl = (0, −2x)
  const [a, b] = curl(sx, 3, 5, 1e-3); near(a, 0, 1e-9); near(b, -6, 1e-6, "−∂ψ/∂x");
});
test("wander is smooth in t, bounded, and seed-dependent", () => {
  const n = makeNoise(11); let maxStep = 0, diff = 0;
  for (let i = 0; i < 1000; i++) { const t = i * 0.01; const [ax, ay] = wander2(n, t, 0.7, 1), [bx, by] = wander2(n, t + 0.001, 0.7, 1), [cx] = wander2(n, t, 0.7, 2);
    assert.ok(Math.abs(ax) <= 1 && Math.abs(ay) <= 1); maxStep = Math.max(maxStep, Math.hypot(bx - ax, by - ay)); diff += Math.abs(ax - cx); }
  assert.ok(maxStep < 0.01, `smooth: ${maxStep}`); assert.ok(diff / 1000 > 0.05, "seeds differ");
});
test("a wavering flight path starts at A, ends at B, and wanders in between", () => {
  const n = makeNoise(5), A = [100, 400], B = [700, 120];
  const p0 = flightPoint(A, B, 0, 3, n, { seed: 9 }), p1 = flightPoint(A, B, 1, 3, n, { seed: 9 });
  near(p0[0], A[0], 1e-9); near(p0[1], A[1], 1e-9); near(p1[0], B[0], 1e-9); near(p1[1], B[1], 1e-9);
  const straight = flightPoint(A, B, 0.5, 3, n, { amp: 0 }), wavy = flightPoint(A, B, 0.5, 3, n, { amp: 18, seed: 9 });
  const dev = Math.hypot(wavy[0] - straight[0], wavy[1] - straight[1]); assert.ok(dev > 0.5 && dev <= 18 * Math.SQRT2 + 1e-9, `off course by ${dev}`);
  assert.deepEqual(flightPoint(A, B, 0.37, 12.5, n, { seed: 9 }), flightPoint(A, B, 0.37, 12.5, n, { seed: 9 }), "same t, same point");
});
test("Kepler's equation is solved to 1e-10 across eccentricities up to 0.95", () => {
  for (const e of [0, 0.1, 0.3, 0.6, 0.8, 0.95]) for (let i = 0; i < 24; i++) { const M = (i / 24) * 2 * Math.PI; const E = keplerE(M, e); near(E - e * Math.sin(E), M, 1e-9, `e=${e} M=${M.toFixed(3)}`); }
});
test("an orbit swings from periapsis to apoapsis, closes when it does not precess, and is fastest near the block", () => {
  const o = { cx: 480, cy: 262, a: 90, e: 0.4, omega: 0.7, squash: 1 }, T = 6;
  near(orbitPoint(o, 0, T).r, o.a * (1 - o.e), 1e-9, "periapsis at t=0"); near(orbitPoint(o, T / 2, T).r, o.a * (1 + o.e), 1e-9, "apoapsis at T/2");
  const p0 = orbitPoint(o, 0, T), pT = orbitPoint(o, T, T); near(p0.x, pT.x, 1e-6); near(p0.y, pT.y, 1e-6);
  const speed = t => { const a = orbitPoint(o, t, T), b = orbitPoint(o, t + 1e-3, T); return Math.hypot(b.x - a.x, b.y - a.y) / 1e-3; };
  assert.ok(speed(0) > 1.5 * speed(T / 2), `vis-viva: ${speed(0)} at periapsis vs ${speed(T / 2)} at apoapsis`);
  for (let i = 0; i < 60; i++) { const { r } = orbitPoint(o, i * 0.1, T); assert.ok(r >= o.a * (1 - o.e) - 1e-9 && r <= o.a * (1 + o.e) + 1e-9); }
  const pre = { ...o, precession: 0.3 }; const q0 = orbitPoint(pre, 0, T), qT = orbitPoint(pre, T, T); assert.ok(Math.hypot(q0.x - qT.x, q0.y - qT.y) > 1, "precession: the loop does not retrace");
  const sq = orbitPoint({ ...o, squash: 0.42 }, 1.3, T), un = orbitPoint(o, 1.3, T); near(sq.x, un.x, 1e-9); near(sq.y - o.cy, (un.y - o.cy) * 0.42, 1e-9, "squash scales y about the focus");
});
test("attenuation is 1 at the source, 0 at the radius with zero slope, monotone, and never negative", () => {
  const R = 50; near(attenuation(0, R), 1, 1e-12); assert.equal(attenuation(R, R), 0); assert.equal(attenuation(R * 2, R), 0);
  let prev = 1; for (let d = 0; d <= R; d += 0.5) { const v = attenuation(d, R); assert.ok(v >= 0 && v <= prev + 1e-12, `monotone at ${d}`); prev = v; }
  near((attenuation(R, R) - attenuation(R - 1e-3, R)) / 1e-3, 0, 1e-4, "zero slope at R");
  near(attenuationSoft(0, R), 1, 1e-12); assert.equal(attenuationSoft(R, R), 0); assert.ok(attenuationSoft(R / 2, R) > 0 && attenuationSoft(R / 2, R) < 1);
});
test("the rim glows under a passing light and cools with age", () => {
  const rim = [[0, 0], [10, 0], [100, 0]];
  const g = rimGlow(rim, [{ x: 0, y: 0, age: 0 }], 40, 10);
  near(g[0], 1, 1e-12); assert.ok(g[1] > 0 && g[1] < 1); assert.equal(g[2], 0);
  const old = rimGlow(rim, [{ x: 0, y: 0, age: 10 }], 40, 10); near(old[0], Math.exp(-1), 1e-12);
  const both = rimGlow(rim, [{ x: 0, y: 0, age: 10 }, { x: 10, y: 0, age: 0 }], 40, 10); near(both[1], 1, 1e-12, "the newest, nearest head wins");
});
```

Run: `node --test tests/light-physics.test.mjs` — Expected: import failure (the baseline).

- [ ] **Step 2: The reference module the oracle was written against**

```js
// file: src/view/ui/light-physics.mjs
// The physics of the lights: seeded noise, a curl field, a wavering flight path, a Kepler orbit and two
// attenuation curves. Pure and memoryless: every function is a value of t and a seed, so replay is exact.
//
//   noise        Gustavson, "Simplex noise demystified" (2005); the 2D port in josephg/noisejs (public domain).
//                Seeding after mikeascendx/aether js/perlin.js (MIT): a Lehmer shuffle of the permutation.
//   curl         Bridson, Hourihan, Nordenstam, "Curl-noise for procedural fluid flow" (SIGGRAPH 2007):
//                v = (∂ψ/∂y, −∂ψ/∂x) by central differences, the form used in aether's field.js.
//   wander       Reynolds, "Steering Behaviors for Autonomous Characters" (1999); Shiffman, The Nature of
//                Code ch. 5. The wander angle is a function of noise and time here, not a random walk.
//   orbit        Kepler's equation E − e sin E = M by Newton's method, seeded as in markbrown/keplersballs.
//   attenuation  Lagarde & de Rousiers, "Moving Frostbite to PBR" (SIGGRAPH 2014), windowed inverse square;
//                lisyarus, "Point light attenuation" (2022), the smooth no-cusp variant.

const TAU = Math.PI * 2;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

export function makeNoise(seed = 1337) {
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = ((seed >>> 0) % 2147483647) || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), gradP = new Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; gradP[i] = GRAD[perm[i] % 12]; }
  const corner = (g, x, y) => { let t = 0.5 - x * x - y * y; if (t < 0) return 0; t *= t; return t * t * (g[0] * x + g[1] * y); };
  function simplex2(xin, yin) {
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
    const x0 = xin - i + t, y0 = yin - j + t;
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const n0 = corner(gradP[ii + perm[jj]], x0, y0), n1 = corner(gradP[ii + i1 + perm[jj + j1]], x1, y1), n2 = corner(gradP[ii + 1 + perm[jj + 1]], x2, y2);
    return 70 * (n0 + n1 + n2);
  }
  function fbm2(x, y, octaves = 3) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += amp * simplex2(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  }
  return { simplex2, fbm2 };
}

export function curl(psi, x, y, eps = 0.01) {
  return [(psi(x, y + eps) - psi(x, y - eps)) / (2 * eps), -(psi(x + eps, y) - psi(x - eps, y)) / (2 * eps)];
}

// Two smooth channels of wander: a walk along a line in noise space that moves with t, far from the origin so
// two seeds never share a neighbourhood.
export function wander2(noise, t, freq, seed = 0) {
  const u = t * freq, o = seed * 97.13;
  return [noise.fbm2(u + o, 0.37 + o * 0.01, 3), noise.fbm2(0.91 - o * 0.01, u + o + 31.7, 3)];
}

// The quadratic arc from A to B, lifted, plus a wander that vanishes at both ends: off course in the middle,
// on target at arrival. Normal wander is the visible waver; tangential wander is a small change of pace.
export function flightPoint(A, B, k, t, noise, { lift = 40, amp = 18, freq = 0.7, seed = 0 } = {}) {
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2 - lift, u = 1 - k;
  const x = u * u * A[0] + 2 * u * k * mx + k * k * B[0], y = u * u * A[1] + 2 * u * k * my + k * k * B[1];
  if (amp === 0) return [x, y];
  const tx = 2 * u * (mx - A[0]) + 2 * k * (B[0] - mx), ty = 2 * u * (my - A[1]) + 2 * k * (B[1] - my), len = Math.hypot(tx, ty) || 1;
  const nx = -ty / len, ny = tx / len, [w1, w2] = wander2(noise, t + k * 2, freq, seed), env = Math.sin(Math.PI * k);
  return [x + env * (amp * w1 * nx + (amp / 3) * w2 * tx / len), y + env * (amp * w1 * ny + (amp / 3) * w2 * ty / len)];
}

export function keplerE(M, e) {
  M %= TAU; if (M < 0) M += TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 32; i++) { const f = E - e * Math.sin(E) - M; if (Math.abs(f) < 1e-10) break; E -= f / (1 - e * Math.cos(E)); }
  return E;
}

// A Kepler orbit with the focus at the block's centre, rotated by omega (plus precession·t so no loop
// retraces), squashed in y to sit in the block's perspective. r is the unsquashed distance to the focus.
export function orbitPoint({ cx, cy, a, e, omega = 0, squash = 1, precession = 0 }, t, period) {
  const E = keplerE(TAU * t / period, e), b = a * Math.sqrt(1 - e * e);
  const px = a * (Math.cos(E) - e), py = b * Math.sin(E), w = omega + precession * t, c = Math.cos(w), s = Math.sin(w);
  return { x: cx + px * c - py * s, y: cy + (px * s + py * c) * squash, r: a * (1 - e * Math.cos(E)), E };
}

// Frostbite: inverse square, clamped at the light's own size, windowed to reach zero at R with zero slope;
// normalised so the value at the source is 1.
export function attenuation(d, R, size = R / 32) {
  if (d >= R) return 0;
  const f = (d * d) / (R * R), w0 = Math.max(0, Math.min(1, 1 - f * f)), w = w0 * w0;
  return (size * size) / Math.max(d * d, size * size) * w;
}
export function attenuationSoft(d, R, F = 2) {
  const s = d / R; if (s >= 1) return 0; const q = 1 - s * s; return (q * q) / (1 + F * s * s);
}

// What the glass picks up: for each rim point, the brightest of the recent head positions, each dimmed by its
// distance (attenuation) and its age (exponential cooling).
export function rimGlow(points, heads, R, tau) {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let best = 0;
    for (const h of heads) { const v = attenuation(Math.hypot(points[i][0] - h.x, points[i][1] - h.y), R) * Math.exp(-h.age / tau); if (v > best) best = v; }
    out[i] = best;
  }
  return out;
}
```

- [ ] **Step 3: Ticket, launch, ship, commit.** `scripts/tickets/live-view-light-physics.json`: slot/path/source `src/view/ui/light-physics.mjs`, tests_file `tests/light-physics.test.mjs`, acceptance `node --test`, copy `["src","tests","scripts","bin","package.json",".agents"]`, goal = this task's Interfaces and the Sources table verbatim (the implementer writes the formulas from their statements; the oracle judges the properties, not the code). Before launching, `node --test` must fail only in `tests/light-physics.test.mjs`.

```bash
git add tests/light-physics.test.mjs src/view/ui/light-physics.mjs scripts/tickets/live-view-light-physics.json
git commit -m "light-physics: seeded simplex, curl, a wavering flight path, a Kepler orbit, Frostbite attenuation"
```

---

### Task 2: Wire it into the lights and the renderer

*By hand.* `lights.mjs` (Section Three) changes in three places; `stage.js` in two.

- [ ] **Step 1: `lights.mjs`** — replace `arc` with `flightPoint` and the rim walk with the orbit:

```js
import { makeNoise, flightPoint, orbitPoint, attenuation } from "./light-physics.mjs";
const NOISE = makeNoise(20260927);
const seedOf = seat => [...String(seat)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const ORBIT_PERIOD_S = 6;
export function orbitOf(block, seat, sub = false) {
  const s = seedOf(seat);
  const e = 0.28 + (s % 100) / 500;      // periapsis just outside the glass: a(1 − e) = 1.05 R (1.3 R for the subagent), apoapsis a(1 + e) swings wide
  return { cx: block.cx, cy: block.top + block.H / 2, a: block.R * (sub ? 1.3 : 1.05) / (1 - e), e, omega: (s % 360) * Math.PI / 180, squash: 0.62, precession: sub ? -0.22 : 0.15 };
}
```

In the `out` phase: `const [x, y] = flightPoint(A, B, (t - trip.start) / OUT_S, t, NOISE, { seed: seedOf(trip.seat) })`. In the `back` phase: the same with `B, A` and `(t - end) / BACK_S`. In the `exploring` phase, replace `onRim(b, d)` with:

```js
      const orb = orbitOf(b, trip.seat), { x, y } = orbitPoint(orb, t - trip.start - OUT_S, ORBIT_PERIOD_S), trail = [];
      for (let i = 1; i <= TRAIL_STEPS; i++) { const age = i * (TRAIL_S / TRAIL_STEPS), tt = t - age; if (tt < trip.start + OUT_S) break;
        const q = orbitPoint(orb, tt - trip.start - OUT_S, ORBIT_PERIOD_S); trail.push({ x: q.x, y: q.y, a: Math.exp(-3 * age / TRAIL_S) }); }
```

and the subagent's light uses `orbitOf(b, sub.seat, true)`. The tests in `tests/lights.test.mjs` that assert "on the reviewer's rim" become "within the reviewer's orbit": `r` between `a(1−e)` and `a(1+e)` of the block centre, unsquashed; the test file changes with the plan, before the code.

- [ ] **Step 2: `stage.js`** — the trail is a tapering ribbon through the recent positions (a stroked polyline, width and alpha falling with age), with beads only at the five freshest points; the head is drawn from the attenuation curve, not a linear gradient: build the radial gradient with five stops at `d/R ∈ {0, .25, .5, .75, 1}` from `attenuation(d, R)`, with `R = size × 2.4`; the trail discs keep `exp(−age/τ)` for alpha and take their radius from `attenuationSoft`. The glass canvas adds the rim glow: for the active block, `rimGlow(rimSamples, trailHeads, R, TRAIL_S / 3)` and a stroke along the top polygon segments whose alpha is the glow — the seam-lighting idea, now driven by the orbit.

- [ ] **Step 3: Run, look, commit** — `node --test`; open `/live?replay=streamThinking&t=60`: the reviewer's light swings around its block, close and fast on the near side, slow and far on the other, drifting off the arc on its way there and back; `window.__pantheonView.frameMs` stays under 3 ms.

```bash
git add src/view/ui/lights.mjs src/view/ui/stage.js tests/lights.test.mjs
git commit -m "lights: wavering flight paths, Kepler orbits with precession, Frostbite glow, rim glow"
```

---

### Task 3: See it before wiring it

*By hand.* A single file, `docs/design/2026-09-28-light-physics-demo.html`, zero dependencies: one glass block drawn as in the mockup, one light that flies in from the top on a wavering path, orbits with the parameters above, and flies back, with the Frostbite glow, the cooling trail and the rim glow; a seed field and a speed slider; the module inlined verbatim. Two screenshots go to the user, and the demo stays in `docs/design/` as the reference for Section Three's look.

---

### Step 6: Amend the spec

In `docs/specs/2026-09-27-live-view-design.md` §4 Motion, replace "runs the rim and facet edges of the block at a constant speed" with "orbits the block on a Kepler ellipse with the block at the focus, fastest at its closest pass, precessing so no loop retraces, and drifts off its arc on the way there and back on a noise-driven wander that vanishes at both ends"; in §8 Lights, name `light-physics.mjs` and the attenuation curve as the glow.

## Self-review

**Coverage.** Every motion the user named has a formula and a test: wavering off course (flightPoint), fluid (curl, divergence-free), orbit (Kepler with precession), light dissipation (attenuation, zero at R with zero slope; time decay), orbit glow (rimGlow). **Placeholders.** None. **Type consistency.** `orbitPoint` returns `{ x, y, r, E }` and `lights.mjs` reads `x`, `y`; `rimGlow` takes `[x, y]` pairs, which is what `topPolygon` returns. **Review Focus.** 1 → the endpoint test; 2 → the divergence test; 3 → the Kepler grid to 0.95; 4 → the zero-slope test; 5 → the same-t determinism test.

**Proof status.** Extracted verbatim from this document into a scratch tree and run under `node --test` on 2026-09-28: the eight tests pass. The first run failed one assertion because `rimGlow` returned single-precision floats and the oracle compared `e⁻¹` at 1e-12; the module now returns doubles, which is the right type for eight rim points anyway.
