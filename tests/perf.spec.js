// Keeping OBS light: a device's resting wobble never makes the overlay redraw, slow moves still show, and the
// 30 FPS draw rate halves the frames OBS has to composite while inputs move.
const { test, expect, readFixture } = require("./fixtures/app");

const VALID = JSON.parse(readFixture("valid.json"));
const pad = (id, axes, buttons) => ({ id, axes: Array(axes).fill(0), buttons });
const DEVICES = [pad("Dev (Vendor: 0001 Product: 0002)", 8, 32), pad("Dev (Vendor: 0001 Product: 0002)", 8, 32),
  pad("Thr (Vendor: 0003 Product: 0004)", 8, 32), { id: "T-Rudder (Vendor: 231d Product: 011f)", axes: [-1, -1, 0, 0, 0, 0], buttons: 0 }];

// Counts drawWidget calls, and drives every device from a timer with fn(t, slot, axis) -> value.
async function drive(page, fn) {
  await page.evaluate(src => {
    const f = new Function("t", "s", "i", "return " + src);
    window.__draws = 0; window.__frames = 0;
    const d = drawWidget; window.drawWidget = (...a) => { window.__draws++; return d(...a); };
    (function count() { window.__frames++; requestAnimationFrame(count); })();   // frames the browser actually ran
    let t = 0;
    window.__drive = setInterval(() => { t++; for (let s = 0; s < 4; s++) { const a = {}; for (let i = 0; i < 8; i++) a[i] = f(t, s, i); window.__fakeGP.set(s, { axes: a }); } }, 8);
  }, fn);
}
const drawsOver = async (page, ms) => { const a = await page.evaluate(() => window.__draws); await page.waitForTimeout(ms); return (await page.evaluate(() => window.__draws)) - a; };
// Draws per animation frame: a loaded test machine runs rAF under 60, which would otherwise blur a 60-vs-30 comparison.
const drawsPerFrame = async (page, ms) => { const a = await page.evaluate(() => [window.__draws, window.__frames]); await page.waitForTimeout(ms); const b = await page.evaluate(() => [window.__draws, window.__frames]); return (b[0] - a[0]) / (b[1] - a[1]); };

test("a device wobbling at rest is never redrawn, and the loop drops to idle polling", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "(s === 3 && i < 2 ? -1 : 0) + (Math.random() - 0.5) * 0.008");   // ±0.4%
  await page.waitForTimeout(1000);
  expect(await drawsOver(page, 2000)).toBe(0);
  expect(await page.evaluate(() => !!rafId), "requestAnimationFrame running").toBe(false);
});

test("a slow, steady move still draws, and lands exactly on the end", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "Math.min(1, t * 0.002)");   // 0.2% per tick, under the noise threshold each step
  await page.waitForTimeout(500);
  expect(await drawsOver(page, 1500)).toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  const shown = await page.evaluate(() => { const w = profile.widgets.find(o => o.id === "p1"); return runtime[w.id].root.textContent; });
  expect(shown).toContain("100%");
});

test("Draw rate 30 FPS halves the passes while inputs move, and is shared by every profile", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(800);
  const at60 = await drawsPerFrame(page, 2000);
  await page.evaluate(() => { profile.settings.fps = 30; save(); });
  await page.waitForTimeout(300);
  const at30 = await drawsPerFrame(page, 2000);
  expect(at30).toBeLessThan(at60 * 0.65);
  expect(at30).toBeGreaterThan(at60 * 0.3);
  await page.evaluate(() => { addBlankLayout(); });
  expect(await page.evaluate(() => profile.settings.fps)).toBe(30);
});

test("Draw rate 30 also steps Projector motion, which runs freely again at 60", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await page.evaluate(() => { for (const w of profile.widgets) w.holo = { on: true, tier: "subtle" }; save(); rebuildAll(); });
  const state = () => page.evaluate(() => document.getAnimations().filter(a => a.animationName === "holo-env").map(a => [a.playState, a.currentTime]));
  await page.waitForTimeout(200);
  const free = await state();
  expect(free.length).toBeGreaterThan(0);
  expect(free.every(([s]) => s === "running")).toBe(true);
  await page.evaluate(() => { profile.settings.fps = 30; save(); applySettings(); });
  await page.waitForTimeout(200);
  const a = await state();
  expect(a.every(([s]) => s === "paused")).toBe(true);
  await page.waitForTimeout(300);
  const b = await state();
  expect(b[0][1] - a[0][1]).toBeGreaterThan(200);   // still moving, a step at a time
  expect(b[0][1] - a[0][1]).toBeLessThan(400);
  // A rebuild makes new animations, which are paused on the next step.
  await page.evaluate(() => rebuildAll());
  await page.waitForTimeout(150);
  expect((await state()).every(([s]) => s === "paused")).toBe(true);
  await page.evaluate(() => { profile.settings.fps = 60; save(); applySettings(); });
  const c = await state();
  expect(c.every(([s]) => s === "running")).toBe(true);
  expect(await page.evaluate(() => stepT)).toBe(0);
});

// Smoothness Check: what the browser lets the overlay draw while inputs move, so a pilot can see a game starving OBS.
const checkText = page => page.evaluate(() => { setSelection([], "settings"); return document.querySelector("#frame-check").textContent; });

test("Smoothness Check waits for movement, then reports frames a second while inputs move", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?edit" });
  await page.waitForTimeout(600);   // the first paint after loading draws every widget, which is not movement
  expect(await checkText(page)).toMatch(/^Move a control/);
  expect(await page.evaluate(() => frameReport())).toBeNull();
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => frameReport());
  expect(r.fps).toBeGreaterThan(15);   // a loaded test machine (or a trace being recorded) runs below 60
  expect(r.fps).toBeLessThanOrEqual(r.best + 0.01);
  expect(r.slow).toBe(false);
  expect(await checkText(page)).toMatch(/frames a second, longest pause \d+ ms\. Best this session: \d+/);
  await expect(page.locator("#frame-check")).not.toHaveClass(/warn/);
  // At rest the loop polls on a timer, and those ticks are not frames OBS was asked for: nothing more is counted.
  await page.evaluate(() => clearInterval(window.__drive));
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => frameStats.buckets.reduce((n, b) => n + b.frames, 0));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => frameStats.buckets.reduce((n, b) => n + b.frames, 0))).toBe(before);
});

test("Smoothness Check warns when frames come far slower than the session's best", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?edit" });
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.waitForTimeout(2500);
  // Stand in for a starved browser: every frame now takes about 100 ms.
  await page.evaluate(() => { const spin = () => { const end = performance.now() + 95; while (performance.now() < end); window.__spin = requestAnimationFrame(spin); }; window.__spin = requestAnimationFrame(spin); });
  await page.waitForTimeout(6000);
  await page.evaluate(() => cancelAnimationFrame(window.__spin));
  const r = await page.evaluate(() => frameReport());
  expect(r.slow).toBe(true);
  expect(r.worst).toBeLessThan(r.best * 0.5);
  expect(r.longest).toBeGreaterThan(90);
  expect(await checkText(page)).toContain("holding OBS's browser back");
  await expect(page.locator("#frame-check")).toHaveClass(/warn/);
});

// Every change the page makes while inputs move lands in a draw pass: at Draw rate 30 nothing (not even a readout's
// text) is written to the page between two passes, since each frame with a change is a frame OBS has to take.
// A MutationObserver on the stage and the drawWidget hook stamp each change with the animation frame it came in.
test("Draw rate 30: readout text is written in the draw passes, never on a frame of its own", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  await page.evaluate(() => { profile.settings.fps = 30; save(); });
  await drive(page, "Math.sin(t / (20 + 7 * i + s))");
  await page.evaluate(() => {
    window.__drawn = new Set(); window.__written = new Set();
    new MutationObserver(() => window.__written.add(window.__frames)).observe(document.querySelector("#stage"), { subtree: true, childList: true, characterData: true, attributes: true });
    const d = window.drawWidget; window.drawWidget = (...a) => { window.__drawn.add(window.__frames); return d(...a); };
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__drawn.clear(); window.__written.clear(); window.__f0 = window.__frames; });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => ({ frames: window.__frames - window.__f0, drawn: window.__drawn.size, textOnly: [...window.__written].filter(f => !window.__drawn.has(f)).length }));
  expect(r.frames).toBeGreaterThan(60);
  expect(r.textOnly).toBeLessThanOrEqual(2);   // text used to land on about 15 frames a second of its own
  expect(r.drawn / r.frames).toBeLessThan(0.7);   // the passes themselves: every other frame, give or take a slow machine
  expect(r.drawn / r.frames).toBeGreaterThan(0.3);
  // The readouts still land on the final value right after the hands come off.
  await page.evaluate(() => { clearInterval(window.__drive); for (let s = 0; s < 4; s++) window.__fakeGP.set(s, { axes: { 0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5 } }); });
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() => runtime.s1.root.textContent + " " + runtime.t1.root.textContent);
  expect(shown).toContain("50%");   // the stick's X at 0.5
  expect(shown).toContain("25%");   // the throttle axis is inverted in this profile: 0.5 reads a quarter open
});

// The stick dot's glow (and, with 3D depth, its shadow) are blurred once into sprites, not with shadowBlur or a
// blur filter on every draw: those are a Gaussian pass per frame, and on the CPU they were most of a stick's draw.
test("a stick's glow and shadow are sprites painted once per widget, with no per-frame blur", async ({ app, page }) => {
  await app.open({ profile: VALID, devices: DEVICES, query: "?transparent" });
  const r = await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype, desc = Object.getOwnPropertyDescriptor(proto, "shadowBlur"), fdesc = Object.getOwnPropertyDescriptor(proto, "filter");
    let blurs = 0;
    Object.defineProperty(proto, "shadowBlur", { configurable: true, get: desc.get, set(v) { if (v) blurs++; desc.set.call(this, v); } });
    Object.defineProperty(proto, "filter", { configurable: true, get: fdesc.get, set(v) { if (v && v !== "none") blurs++; fdesc.set.call(this, v); } });
    const out = {};
    for (const id of ["s1", "s2"]) {
      const w = profile.widgets.find(o => o.id === id), rt = runtime[id], pad = { axes: [0, 0, 0, 0, 0, 0, 0, 0], buttons: [] };
      rt.sprites = null; blurs = 0;
      drawStick(w, rt, pad);
      const first = blurs, sprites = rt.sprites ? Object.values(rt.sprites) : [];
      for (let i = 1; i <= 30; i++) { pad.axes[0] = Math.sin(i / 5); pad.axes[1] = Math.cos(i / 7); drawStick(w, rt, pad); }
      out[id] = { depth: w.depth || 0, holo: !!rt.holo, firstDrawBlurs: first, laterBlurs: blurs - first, sprites: sprites.length, same: rt.sprites ? Object.values(rt.sprites).every((c, k) => c === sprites[k]) : true };
    }
    Object.defineProperty(proto, "shadowBlur", desc); Object.defineProperty(proto, "filter", fdesc);
    return out;
  });
  expect(r.s2.depth).toBeGreaterThan(0);
  expect(r.s2.sprites).toBe(1);               // shadow and glow in one sprite, painted on the first draw
  expect(r.s2.firstDrawBlurs).toBeGreaterThan(0);
  expect(r.s2.laterBlurs).toBe(0);            // thirty more draws, not one blur
  expect(r.s2.same).toBe(true);
  expect(r.s1.holo).toBe(true);
  expect(r.s1.laterBlurs).toBe(0);            // the projected path was sprite-based already
  // A rebuild starts the sprites over, since they are sized for the build's scale.
  const fresh = await page.evaluate(() => { const was = Object.values(runtime.s2.sprites)[0]; rebuildAll(); drawStick(profile.widgets.find(o => o.id === "s2"), runtime.s2, { axes: [0, 0], buttons: [] }); return Object.values(runtime.s2.sprites)[0] !== was; });
  expect(fresh).toBe(true);
});
